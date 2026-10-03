export interface WhatsNewSection {
  title: string;
  items: string[];
}

/** One release. Version and date are required, so every entry shown in the dialog carries both. */
export interface WhatsNewRelease {
  /** Version number, e.g. '1.0.0'. */
  version: string;
  /** Release date as YYYY-MM-DD. */
  date: string;
  sections: WhatsNewSection[];
}

/** Help › Learn What's New: releases, newest first. Add a new entry at the top for each release. */
export const WHATS_NEW: WhatsNewRelease[] = [
  {
    version: '1.0.0',
    date: '2026-10-03',
    sections: [
      {
        title: 'Viewing and markup',
        items: [
          'Side-by-Side and Continuous Side-by-Side layouts, with Show Cover Page.',
          'Split Horizontal, and Synchronise Document / Page to keep split panes on the same view.',
          'Dark Mode for pages, the Dimmer, Disable Line Weights, Full Screen and the Magnifier.',
          'Zoom and Dynamic Zoom tools, a zoom box, and Back / Forward in the page bar.',
          'Dimension, File Attachment, Flag, Replace Text and Sound markups; Snapshot to the clipboard; paste pictures.',
          'Rotate markups freely, add and remove vertices, hide markups, and flag them for follow-up.',
          'Check Spelling, Undo History, a Checkmark column type and punch list columns.',
        ],
      },
      {
        title: 'Forms, security and signatures',
        items: [
          'Fill in, create and calculate PDF form fields; import and export form data.',
          'Password-protected copies with AES-256 encryption and permissions.',
          'Digital IDs: sign, certify and validate PDF signatures.',
        ],
      },
      {
        title: 'Live Sessions',
        items: ['Session end dates, save-copy and invite permissions, Markup Alerts, document updates, Session Reports and finishing with chosen attendees.'],
      },
      {
        title: 'Revisions and sets',
        items: ['Compare Documents, Overlay Pages, Slip Sheet, Sets and the Batch menu with Auto-Link Sheets.'],
      },
    ],
  },
];

/** Formats a release's YYYY-MM-DD date for display, e.g. "3 October 2026". Falls back to the raw string. */
export function formatReleaseDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Where the documentation, discussion and issues live. */
export const PROJECT_URL = 'https://github.com/ColbyGallagher/redcolumn';
