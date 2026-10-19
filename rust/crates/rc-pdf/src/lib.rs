//! PDFium for redcolumn: a pool of worker processes that parse, render and extract pages.
//!
//! PDFium is not thread-safe, so parallel work needs several PDFium instances, and keeping them
//! in separate processes also means a PDF that crashes PDFium crashes one worker, not the app.
//! - [`pool`]: the app side. Jobs go into one priority queue; each worker takes the most urgent
//!   job it can, preferring pages it already has parsed.
//! - [`worker`]: the worker process's side.
//! - [`extract`]: page content through PDFium's page object API.

pub(crate) mod extract;
pub mod pool;
pub mod protocol;
pub mod shm;
pub mod worker;

pub use pool::{Event, Job, JobId, JobResult, Pool, PoolOptions};
pub use protocol::*;
