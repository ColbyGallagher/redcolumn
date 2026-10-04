import { DriveAuthError } from '../drive/DriveApi';
import { OneDrive, microsoftUser, parseOneDriveInvite, signInWithMicrosoft } from '../drive/onedrive';
import { Project, type ProjectDrive, type ProjectOptions } from './Project';
import { forgetProject, rememberProject } from './local';
import type { Person } from './model';

/**
 * The Projects open in this browser. Kept outside React so they survive switching side panels,
 * and polled while anything is watching.
 */

const POLL_MS = 15_000;

let shared: ProjectDrive | null = null;
// OneDrive implements `remove`, which Projects need.
const drive = (): ProjectDrive => (shared ??= new OneDrive() as ProjectDrive);

const opts: ProjectOptions = { authorize: async () => void (await signInWithMicrosoft()) };

const open = new Map<string, { project: Project; off: () => void }>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function changed() {
  version++;
  for (const l of listeners) l();
}

function person(name: string): Person {
  return { name, email: microsoftUser()?.email ?? null };
}

function track(project: Project) {
  open.get(project.id)?.off();
  const off = project.subscribe(changed);
  open.set(project.id, { project, off });
  rememberProject({ id: project.id, name: project.getSnapshot().manifest.name });
  changed();
  for (const l of openedListeners) l(project);
}

const openedListeners = new Set<(project: Project) => void>();

/** Calls `listener` with each Project as it opens here (without polling, unlike `subscribeProjects`). */
export function onProjectOpened(listener: (project: Project) => void): () => void {
  openedListeners.add(listener);
  return () => openedListeners.delete(listener);
}

/** Which Project and folder the panel shows, kept so switching panels does not lose the place. */
let view: { projectId: string | null; folderId: string | null } = { projectId: null, folderId: null };
export const projectView = () => view;
export function setProjectView(projectId: string | null, folderId: string | null = null) {
  view = { projectId, folderId };
  changed();
}

/** The version number changes whenever a Project or the list of open Projects does. */
export const projectsVersion = () => version;
export const openProjects = (): Project[] => [...open.values()].map((o) => o.project);
export const projectById = (id: string) => open.get(id)?.project ?? null;

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    for (const { project } of open.values()) project.poll().catch(() => {});
  }, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Shows a Project made elsewhere (a drive other than OneDrive, or a test) as open. */
export function adoptProject(project: Project) {
  track(project);
  setProjectView(project.id);
}

export async function createProject(name: string, me: string): Promise<Project> {
  const project = await Project.create(drive(), name, person(me), opts);
  track(project);
  setProjectView(project.id);
  return project;
}

/**
 * Opens a Project by its ID, or by what someone pasted (this app's `?project=` link, a share ID,
 * or the OneDrive sharing link). With `interactive` (a click) it signs in, and again asks for more
 * access when opening someone else's folder needs it.
 */
export async function openProject(idOrLink: string, me: string, interactive: boolean): Promise<Project> {
  const id = idFromText(idOrLink);
  if (!id) throw new Error('That is not a Project link. Paste the link the owner sent, or the OneDrive link to the Project folder.');
  const existing = open.get(id)?.project;
  if (existing) {
    setProjectView(id);
    return existing;
  }
  const attempt = () => Project.open(drive(), id, person(me), { ...opts, interactive });
  let project: Project;
  try {
    project = await attempt();
  } catch (err) {
    if (!(err instanceof DriveAuthError) || !interactive) throw err;
    // Someone else's folder can need more access (once or twice): ask, and try again.
    await signInWithMicrosoft();
    try {
      project = await attempt();
    } catch (again) {
      if (!(again instanceof DriveAuthError)) throw again;
      await signInWithMicrosoft();
      project = await attempt();
    }
  }
  track(project);
  setProjectView(project.id);
  return project;
}

/** Stops showing a Project here (the Project itself is untouched). */
export function closeProject(id: string) {
  open.get(id)?.off();
  open.get(id)?.project.close();
  open.delete(id);
  forgetProject(id);
  if (view.projectId === id) view = { projectId: null, folderId: null };
  changed();
}

export function idFromText(text: string): string | null {
  const t = text.trim();
  try {
    const param = new URL(t).searchParams.get('project');
    if (param && /^u![\w-]{8,}$/.test(param)) return param;
  } catch {
    // Not a link.
  }
  return parseOneDriveInvite(t);
}
