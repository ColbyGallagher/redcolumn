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
    version: '0.1.19',
    date: '2026-11-09',
    items: [
      'Open DWG and DXF drawings, converted to vector PDF',
      'Group box with rotate and scale handles; nested Markups list rows',
      'Select by window or crossing with a right-to-left box or lasso',
      'Ctrl-drag duplicates a markup; Shift-drag locks it to an axis',
      'Curve segments and edit measurement vertices with Ctrl, Shift and Alt clicks',
      'Resume a count, polylength or polyline; drag a rectangle with Area and Volume tools',
      'Installed fonts in markups, embedded in exported PDFs',
      'Blend modes for images, shapes and lines',
      'Subject, Label and Layer for the selection and active tool',
      'Markup Format tab comes forward on selection, with grouped controls',
      'The PDF renderer restarts itself if it crashes or hangs',
    ],
  },
  {
    version: '0.1.18',
    date: '2026-11-05',
    items: [
      'AI Compare: semantic document comparison through the local assistant',
      'Compare results zoom both revisions and turn to the result page',
      'Scale checks, and viewports named from view titles',
      'Justified text alignment and line spacing for text boxes and callouts',
      'Arrow keys nudge selected markups; Center, Same Size and Distribute commands',
      'Step through search results with Up and Down arrows',
      'CJK markup text no longer exports as question marks',
      'Active tool name shown in the status bar',
    ],
  },
  {
    version: '0.1.17',
    date: '2026-11-03',
    items: [
      'Drawing standards: teach Redcolumn your client title blocks, marks and chainage links',
      'Selectable themes: Navy, Graphite, Light, or match the system',
      'New column logo as the app and taskbar icon',
      'Import and export markups as FDF',
      'Duplicate pages with Ctrl+C / Ctrl+V in the thumbnails',
      'Snapshot with a polygon selection and picture colour swap',
      'Progress bar and Cancel for Bulk Redact and other long tools',
      'Fixed-height ribbon with a contextual Markup Format tab',
      'Text on rotated sheets reads the way it is shown',
      'Assemblies: round-up multiples, formula editor and examples by discipline',
      'Tab stays inside dialogs; optional background autosave',
    ],
  },
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
