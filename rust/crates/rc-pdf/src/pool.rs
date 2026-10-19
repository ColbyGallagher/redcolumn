//! The app side of the PDFium worker pool.
//!
//! One queue holds every job. Each worker process has a thread here that takes the most urgent
//! job it can (preferring pages its PDFium has parsed already, since parsing a heavy sheet can
//! take longer than drawing it), sends it, and turns the answer into an [`Event`]. A worker that
//! dies is restarted; the job it was running fails with a message instead of hanging.

use crate::protocol::*;
use crate::shm::{self, Shared};
use crossbeam_channel::{Receiver, Sender, unbounded};
use rc_scene::PageContent;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

pub type JobId = u64;

/// Generation for jobs that cancelling a view must never stop (extraction, annotations).
pub const NEVER_CANCEL: u64 = u64::MAX;

#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Render(RenderRequest),
    Extract { doc: DocId, page: u32 },
    Annotations { doc: DocId, page: u32 },
    Text { doc: DocId, page: u32 },
    Pages { doc: DocId },
}

impl Job {
    pub fn doc(&self) -> DocId {
        match self {
            Job::Render(r) => r.doc,
            Job::Extract { doc, .. } | Job::Annotations { doc, .. } | Job::Text { doc, .. } | Job::Pages { doc } => {
                *doc
            }
        }
    }

    pub fn page(&self) -> Option<u32> {
        match self {
            Job::Render(r) => Some(r.page),
            Job::Extract { page, .. } | Job::Annotations { page, .. } | Job::Text { page, .. } => Some(*page),
            Job::Pages { .. } => None,
        }
    }

    fn generation(&self) -> u64 {
        match self {
            Job::Render(r) => r.generation,
            _ => NEVER_CANCEL,
        }
    }

    fn request(&self) -> Request {
        match self.clone() {
            Job::Render(r) => Request::Render(r),
            Job::Extract { doc, page } => Request::Extract { doc, page },
            Job::Annotations { doc, page } => Request::Annotations { doc, page },
            Job::Text { doc, page } => Request::Text { doc, page },
            Job::Pages { doc } => Request::Pages { doc },
        }
    }
}

#[derive(Debug)]
pub enum JobResult {
    /// RGBA rows, `width * 4` bytes each.
    Rendered { width: u32, height: u32, rgba: Vec<u8>, timing: Timing },
    Extracted { content: Box<PageContent>, timing: Timing },
    Annotations(Vec<AnnotInfo>),
    Text(Vec<TextRun>),
    Pages(Vec<PageInfo>),
    Cancelled,
    PasswordRequired,
    Failed(String),
}

#[derive(Debug)]
pub struct Event {
    pub id: JobId,
    pub job: Job,
    pub result: JobResult,
    pub worker: usize,
    /// From the job being queued to its result arriving.
    pub total_ms: f64,
}

#[derive(Clone, Debug)]
pub struct PoolOptions {
    pub workers: usize,
    /// The program to run for a worker, and the arguments that make it one.
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The PDFium library the workers load.
    pub pdfium: PathBuf,
}

impl PoolOptions {
    /// Workers run as this executable with `--rc-pdfium-worker`, one per core but one, at least
    /// one, at most `cap`.
    pub fn current_exe(cap: usize) -> std::io::Result<Self> {
        Ok(Self {
            workers: default_workers(cap),
            program: std::env::current_exe()?,
            args: vec!["--rc-pdfium-worker".into()],
            pdfium: crate::worker::default_library_path(),
        })
    }
}

/// Physical cores minus one for the interface, between 1 and `cap`.
pub fn default_workers(cap: usize) -> usize {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    n.saturating_sub(1).clamp(1, cap.max(1))
}

struct Queued {
    id: JobId,
    job: Job,
    priority: i64,
    queued: Instant,
}

#[derive(Default)]
struct State {
    queue: Vec<Queued>,
    docs: HashMap<DocId, (PathBuf, Option<String>)>,
    /// Per worker: documents to close before its next job.
    closing: Vec<Vec<DocId>>,
    /// Per worker: closes still to be done (for `close_and_wait`).
    shutdown: bool,
}

struct Shared_ {
    state: Mutex<State>,
    wake: Condvar,
    /// Signalled when a worker finishes closing documents.
    closed: Condvar,
    controls: Vec<Mutex<Option<Arc<Shared>>>>,
    waker: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

pub struct Pool {
    shared: Arc<Shared_>,
    next_id: AtomicU64,
    events: Receiver<Event>,
    threads: Vec<std::thread::JoinHandle<()>>,
    stopped: Arc<AtomicBool>,
    pub workers: usize,
}

impl Pool {
    pub fn new(opts: PoolOptions) -> anyhow::Result<Self> {
        let n = opts.workers.max(1);
        let shared = Arc::new(Shared_ {
            state: Mutex::new(State { closing: vec![Vec::new(); n], ..Default::default() }),
            wake: Condvar::new(),
            closed: Condvar::new(),
            controls: (0..n).map(|_| Mutex::new(None)).collect(),
            waker: Mutex::new(None),
        });
        let (tx, rx) = unbounded();
        let stopped = Arc::new(AtomicBool::new(false));
        let mut threads = Vec::new();
        for i in 0..n {
            let shared = shared.clone();
            let tx = tx.clone();
            let opts = opts.clone();
            let stopped = stopped.clone();
            threads.push(
                std::thread::Builder::new()
                    .name(format!("pdfium-{i}"))
                    .spawn(move || worker_thread(i, opts, shared, tx, stopped))?,
            );
        }
        Ok(Self { shared, next_id: AtomicU64::new(1), events: rx, threads, stopped, workers: n })
    }

    /// Called after each event is sent (for example, to ask the interface to repaint).
    pub fn set_waker(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.shared.waker.lock().unwrap() = Some(Arc::new(f));
    }

    /// Registers a document. Workers open it before their first job on it.
    pub fn open(&self, doc: DocId, path: PathBuf, password: Option<String>) {
        self.shared.state.lock().unwrap().docs.insert(doc, (path, password));
    }

    /// Closes a document in every worker and drops its queued jobs, without waiting.
    pub fn close(&self, doc: DocId) {
        let mut st = self.shared.state.lock().unwrap();
        st.docs.remove(&doc);
        st.queue.retain(|q| q.job.doc() != doc);
        for c in st.closing.iter_mut() {
            c.push(doc);
        }
        drop(st);
        self.shared.wake.notify_all();
    }

    /// Closes a document in every worker and waits until none has the file mapped (needed before
    /// replacing the file on Windows). Waits for running jobs on it to finish.
    pub fn close_and_wait(&self, doc: DocId) {
        self.close(doc);
        let mut st = self.shared.state.lock().unwrap();
        while st.closing.iter().any(|c| c.contains(&doc)) && !st.shutdown {
            st = self.shared.closed.wait(st).unwrap();
        }
    }

    pub fn submit(&self, job: Job, priority: i64) -> JobId {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.shared.state.lock().unwrap().queue.push(Queued { id, job, priority, queued: Instant::now() });
        self.shared.wake.notify_one();
        id
    }

    /// Changes a queued job's priority (no effect once it has started).
    pub fn reprioritize(&self, id: JobId, priority: i64) {
        if let Some(q) = self.shared.state.lock().unwrap().queue.iter_mut().find(|q| q.id == id) {
            q.priority = priority;
        }
    }

    /// Drops queued render jobs older than `generation` and stops running ones.
    pub fn cancel_below(&self, generation: u64) {
        self.shared.state.lock().unwrap().queue.retain(|q| q.job.generation() >= generation);
        for c in &self.shared.controls {
            if let Some(c) = c.lock().unwrap().as_ref() {
                c.set_cancel_generation(generation);
            }
        }
    }

    /// Drops a queued job. Returns false when it already started (its result still arrives).
    pub fn cancel(&self, id: JobId) -> bool {
        let mut st = self.shared.state.lock().unwrap();
        let before = st.queue.len();
        st.queue.retain(|q| q.id != id);
        st.queue.len() != before
    }

    pub fn queued(&self) -> usize {
        self.shared.state.lock().unwrap().queue.len()
    }

    pub fn events(&self) -> &Receiver<Event> {
        &self.events
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.shared.state.lock().unwrap().shutdown = true;
        self.shared.wake.notify_all();
        self.shared.closed.notify_all();
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

/// A running worker process.
struct Proc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    control: Arc<Shared>,
    payloads: Option<Shared>,
    open: HashSet<DocId>,
    /// Recently parsed pages, most recent last.
    recent: VecDeque<(DocId, u32)>,
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.control.path);
        if let Some(p) = &self.payloads {
            let _ = std::fs::remove_file(&p.path);
        }
    }
}

fn spawn(opts: &PoolOptions) -> anyhow::Result<Proc> {
    let control_path = shm::temp_path("control");
    let control = Arc::new(Shared::create(&control_path, shm::CONTROL_SIZE)?);
    let mut cmd = Command::new(&opts.program);
    cmd.args(&opts.args)
        .arg("--pdfium")
        .arg(&opts.pdfium)
        .arg("--control")
        .arg(&control_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("cannot start PDFium worker {}: {e}", opts.program.display()))?;
    let stdin = child.stdin.take().unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    Ok(Proc { child, stdin, stdout, control, payloads: None, open: HashSet::new(), recent: VecDeque::new() })
}

impl Proc {
    fn call(&mut self, req: &Request) -> anyhow::Result<Response> {
        let mut line = serde_json::to_string(req)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()?;
        let mut answer = String::new();
        if self.stdout.read_line(&mut answer)? == 0 {
            anyhow::bail!("the PDFium worker stopped");
        }
        Ok(serde_json::from_str(answer.trim_end())?)
    }

    fn payload(&mut self, p: &Payload) -> anyhow::Result<&[u8]> {
        if self.payloads.as_ref().is_none_or(|s| s.path != p.file) {
            if let Some(old) = self.payloads.take() {
                // The worker moved to a larger file. Unmap the old one before deleting it: Windows
                // refuses to delete a mapped file, so the worker's own delete may have failed.
                let path = old.path.clone();
                drop(old);
                let _ = std::fs::remove_file(path);
            }
            self.payloads = Some(Shared::open(&p.file)?);
        }
        let s = self.payloads.as_ref().unwrap();
        s.bytes().get(..p.len as usize).ok_or_else(|| anyhow::anyhow!("payload larger than its file"))
    }
}

fn worker_thread(index: usize, opts: PoolOptions, shared: Arc<Shared_>, tx: Sender<Event>, stopped: Arc<AtomicBool>) {
    let mut proc: Option<Proc> = None;
    let mut failures = 0u32;
    loop {
        // Take closes and the next job under the lock.
        let (closes, next) = {
            let mut st = shared.state.lock().unwrap();
            loop {
                if st.shutdown {
                    return;
                }
                let closes = std::mem::take(&mut st.closing[index]);
                if !closes.is_empty() {
                    break (closes, None);
                }
                if let Some(i) = pick(&st.queue, proc.as_ref()) {
                    let q = st.queue.swap_remove(i);
                    let doc = st.docs.get(&q.job.doc()).cloned();
                    break (Vec::new(), Some((q, doc)));
                }
                st = shared.wake.wait(st).unwrap();
            }
        };
        if !closes.is_empty() {
            if let Some(p) = proc.as_mut() {
                for doc in &closes {
                    if p.open.remove(doc) {
                        let _ = p.call(&Request::Close { doc: *doc });
                    }
                    p.recent.retain(|(d, _)| d != doc);
                }
            }
            let _st = shared.state.lock().unwrap();
            shared.closed.notify_all();
            continue;
        }
        let Some((q, doc)) = next else { continue };
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        let result = match doc {
            None => JobResult::Failed("the document is closed".into()),
            Some((path, password)) => {
                if proc.is_none() {
                    match spawn(&opts) {
                        Ok(p) => {
                            *shared.controls[index].lock().unwrap() = Some(p.control.clone());
                            proc = Some(p);
                        }
                        Err(e) => {
                            failures += 1;
                            let _ = tx.send(Event {
                                id: q.id,
                                job: q.job,
                                result: JobResult::Failed(format!("{e:#}")),
                                worker: index,
                                total_ms: 0.0,
                            });
                            if failures > 3 {
                                std::thread::sleep(std::time::Duration::from_millis(500));
                            }
                            continue;
                        }
                    }
                }
                let p = proc.as_mut().unwrap();
                match run_job(p, &q.job, &path, password) {
                    Ok(r) => {
                        failures = 0;
                        r
                    }
                    Err(e) => {
                        // The process is gone or confused: start a fresh one for the next job.
                        proc = None;
                        *shared.controls[index].lock().unwrap() = None;
                        JobResult::Failed(format!("{e:#}"))
                    }
                }
            }
        };
        if let (Some(p), Some(page)) = (proc.as_mut(), q.job.page()) {
            let key = (q.job.doc(), page);
            p.recent.retain(|k| *k != key);
            p.recent.push_back(key);
            if p.recent.len() > 6 {
                p.recent.pop_front();
            }
        }
        let total_ms = q.queued.elapsed().as_secs_f64() * 1000.0;
        if tx.send(Event { id: q.id, job: q.job, result, worker: index, total_ms }).is_err() {
            return;
        }
        if let Some(w) = shared.waker.lock().unwrap().clone() {
            w();
        }
    }
}

/// The job this worker should run next: the most urgent, with a bonus for pages it has parsed
/// (so tiles of one heavy sheet go to the workers that have it, rather than every worker parsing
/// it), oldest first among equals.
fn pick(queue: &[Queued], proc: Option<&Proc>) -> Option<usize> {
    const AFFINITY: i64 = 2;
    queue
        .iter()
        .enumerate()
        .max_by_key(|(_, q)| {
            let warm = proc
                .zip(q.job.page())
                .is_some_and(|(p, page)| p.recent.contains(&(q.job.doc(), page)));
            (q.priority + if warm { AFFINITY } else { 0 }, std::cmp::Reverse(q.id))
        })
        .map(|(i, _)| i)
}

fn run_job(p: &mut Proc, job: &Job, path: &std::path::Path, password: Option<String>) -> anyhow::Result<JobResult> {
    let doc = job.doc();
    if !p.open.contains(&doc) {
        match p.call(&Request::Open { doc, path: path.to_path_buf(), password })? {
            Response::Opened { .. } => {
                p.open.insert(doc);
            }
            Response::PasswordRequired => return Ok(JobResult::PasswordRequired),
            Response::Error { message } => return Ok(JobResult::Failed(message)),
            other => anyhow::bail!("unexpected answer to open: {other:?}"),
        }
    }
    Ok(match p.call(&job.request())? {
        Response::Rendered { width, height, payload, timing } => {
            let rgba = p.payload(&payload)?.to_vec();
            JobResult::Rendered { width, height, rgba, timing }
        }
        Response::Extracted { payload, timing } => {
            let content = rc_scene::wire::decode(p.payload(&payload)?)?;
            JobResult::Extracted { content: Box::new(content), timing }
        }
        Response::Annotations { annots } => JobResult::Annotations(annots),
        Response::Text { runs } => JobResult::Text(runs),
        Response::Pages { pages, .. } => JobResult::Pages(pages),
        Response::Cancelled => JobResult::Cancelled,
        Response::PasswordRequired => JobResult::PasswordRequired,
        Response::Error { message } => JobResult::Failed(message),
        other => anyhow::bail!("unexpected answer: {other:?}"),
    })
}
