import { readLocal, writeLocal } from '../local';

/** Small per-browser memory for Projects: the ones opened here, and which library files came from one. */

const KNOWN = 'nb.projects.known';
const LINKS = 'nb.projects.links';

export interface KnownProject {
  /** The share ID the Project is opened by. */
  id: string;
  name: string;
}

/** Projects this browser has made or opened, most recent first. */
export const knownProjects = (): KnownProject[] => readLocal<KnownProject[]>(KNOWN, []);

export function rememberProject(p: KnownProject) {
  writeLocal(KNOWN, [p, ...knownProjects().filter((x) => x.id !== p.id)].slice(0, 40));
}

export function forgetProject(id: string) {
  writeLocal(KNOWN, knownProjects().filter((x) => x.id !== id));
  const links = projectLinks();
  const kept = Object.fromEntries(Object.entries(links).filter(([, l]) => l.projectId !== id));
  writeLocal(LINKS, kept);
}

const SEATS = 'nb.projects.seats';

/** This browser's seat for a Project's live markups (its own markup files in the folder), if it has one. */
export const rememberedProjectSeat = (projectId: string): string | null => readLocal<Record<string, string>>(SEATS, {})[projectId] ?? null;

export function rememberProjectSeat(projectId: string, seatId: string) {
  writeLocal(SEATS, { ...readLocal<Record<string, string>>(SEATS, {}), [projectId]: seatId });
}

/** A library file opened from a Project: which file and revision it is. */
export interface ProjectLink {
  projectId: string;
  fileId: string;
  rev: number;
  name: string;
}

export const projectLinks = (): Record<string, ProjectLink> => readLocal<Record<string, ProjectLink>>(LINKS, {});
export const linkOf = (libraryId: string): ProjectLink | null => projectLinks()[libraryId] ?? null;

export function setLink(libraryId: string, link: ProjectLink | null) {
  const all = { ...projectLinks() };
  if (link) all[libraryId] = link;
  else delete all[libraryId];
  writeLocal(LINKS, all);
}

/** The library copy of a Project file, if there is one. */
export const libraryCopyOf = (projectId: string, fileId: string): string | null =>
  Object.entries(projectLinks()).find(([, l]) => l.projectId === projectId && l.fileId === fileId)?.[0] ?? null;

/** A link that opens the app and the Project: `?project=` and the Project's share ID. */
export function projectInviteLink(id: string): string {
  const url = new URL(typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('project', id);
  return url.href;
}
