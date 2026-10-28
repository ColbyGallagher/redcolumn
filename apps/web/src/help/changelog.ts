/**
 * What's new, shown beside the tip on the start screen. Newest first. Add an entry per release;
 * keep each line to one short, user-facing sentence.
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date of the release. */
  date: string;
  items: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.1.16',
    date: '2026-10-28',
    items: [
      'Sign with smart cards and USB tokens',
      'Signed PDFs stay valid when saved',
      'Signatures use PAdES by default',
      'Card certificate chains completed automatically',
      'Smart card prompts no longer freeze the window',
      'Bulk Redact: remove the same boxes across many pages',
      'Bulk Insert PDFs from the Document menu and Bulk ribbon',
      'Mac shortcuts shown as ⌘⌥⇧, Ctrl+click works as right-click',
    ],
  },
  {
    version: '0.1.15',
    date: '2026-10-25',
    items: [
      'Custom line styles: create and edit your own line types',
      'Fill colour and formatting options for markups',
      'Sync to Excel now runs on local Windows Excel',
    ],
  },
  {
    version: '0.1.14',
    date: '2026-10-24',
    items: [
      'Revu import and export: tool sets, stamps, profiles and bookmark templates',
      'AI-assisted takeoff proposals and a Comments table',
      'Link previews, connector bends and scripts',
      'Windows ARM64 build with auto-update',
    ],
  },
  {
    version: '0.1.13',
    date: '2026-10-20',
    items: [
      'Geospatial PDFs: convert a model and show latitude/longitude',
      'Manual stitching (Experimental)',
      'Fixed copy and paste of pages',
    ],
  },
  {
    version: '0.1.11',
    date: '2026-10-17',
    items: [
      'Ribbon toolbar view',
      'Offset drawing tool',
      'Takeoff assemblies',
      'Faster rendering of very heavy PDFs',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-10-15',
    items: [
      'Update check at launch, with in-place updates on Windows',
      'Dock side panels on the left or right',
      'Markups shown on page thumbnails',
      'Menu bar moved into the title bar',
      'New PDF templates and tips on the start screen',
    ],
  },
  {
    version: '0.1.9',
    date: '2026-10-15',
    items: [
      'AutoCAD-style snapping and tracking',
      'Scale to Length and dimension text editing',
      'Undo for page operations and file edits',
      'Split a document by file size',
    ],
  },
  {
    version: '0.1.8',
    date: '2026-10-13',
    items: [
      'Revu profiles',
      'Navy ribbon theme and toolbar groups with search',
      'Unsaved changes prompt',
      'macOS build',
    ],
  },
];
