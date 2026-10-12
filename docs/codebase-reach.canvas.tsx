import {
  BarChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  Select,
  computeDAGLayout,
  useCanvasAction,
  useCanvasState,
  useHostTheme,
  useMemo,
} from "cursor/canvas";

type Band = "cross-cutting" | "shared" | "nearby" | "screen" | "contained" | "shell" | "test" | "tooling";

type FileRec = {
  path: string;
  domain: string;
  area: string;
  band: Band;
  direct: number;
  blast: number;
  fanout: number;
  areas: number;
};

const FILES: FileRec[] = [{"path":"packages/measure/src/scale.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":2,"blast":128,"fanout":0,"areas":20},{"path":"packages/measure/src/measure.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":4,"blast":127,"fanout":1,"areas":20},{"path":"packages/measure/src/fill.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":1,"blast":124,"fanout":1,"areas":20},{"path":"packages/measure/src/rasterSearch.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":1,"blast":124,"fanout":0,"areas":20},{"path":"packages/measure/src/snap.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":1,"blast":124,"fanout":1,"areas":20},{"path":"packages/measure/src/visualSearch.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":1,"blast":124,"fanout":1,"areas":20},{"path":"packages/measure/src/index.ts","domain":"measure","area":"@nb/measure","band":"cross-cutting","direct":29,"blast":123,"fanout":6,"areas":20},{"path":"packages/sheets/src/types.ts","domain":"sheets","area":"@nb/sheets","band":"cross-cutting","direct":4,"blast":114,"fanout":0,"areas":23},{"path":"packages/markup/src/model.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":24,"blast":113,"fanout":6,"areas":19},{"path":"packages/markup/src/style.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":10,"blast":113,"fanout":3,"areas":19},{"path":"packages/markup/src/types.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":9,"blast":113,"fanout":2,"areas":19},{"path":"packages/markup/src/arc.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":6,"blast":113,"fanout":0,"areas":19},{"path":"packages/markup/src/stamp.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":5,"blast":113,"fanout":1,"areas":19},{"path":"packages/markup/src/hatches.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":4,"blast":113,"fanout":0,"areas":19},{"path":"packages/markup/src/bookmarks.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":3,"blast":113,"fanout":1,"areas":19},{"path":"packages/sheets/src/detect.ts","domain":"sheets","area":"@nb/sheets","band":"cross-cutting","direct":2,"blast":112,"fanout":1,"areas":23},{"path":"packages/sheets/src/links.ts","domain":"sheets","area":"@nb/sheets","band":"cross-cutting","direct":1,"blast":111,"fanout":2,"areas":23},{"path":"packages/sheets/src/search.ts","domain":"sheets","area":"@nb/sheets","band":"cross-cutting","direct":1,"blast":111,"fanout":1,"areas":23},{"path":"packages/sheets/src/index.ts","domain":"sheets","area":"@nb/sheets","band":"cross-cutting","direct":17,"blast":110,"fanout":4,"areas":23},{"path":"packages/markup/src/viewports.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":5,"blast":95,"fanout":2,"areas":19},{"path":"packages/markup/src/columns.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":4,"blast":94,"fanout":0,"areas":19},{"path":"packages/markup/src/textSelect.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":4,"blast":94,"fanout":1,"areas":19},{"path":"packages/markup/src/callout.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":3,"blast":94,"fanout":1,"areas":19},{"path":"packages/markup/src/geometry.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":5,"blast":93,"fanout":8,"areas":19},{"path":"packages/markup/src/bluebeam.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":5,"blast":92,"fanout":5,"areas":19},{"path":"packages/markup/src/digest.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":3,"blast":91,"fanout":1,"areas":19},{"path":"packages/markup/src/legend.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":3,"blast":91,"fanout":3,"areas":19},{"path":"packages/markup/src/ownership.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":91,"fanout":1,"areas":19},{"path":"packages/markup/src/pages.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":91,"fanout":1,"areas":19},{"path":"packages/markup/src/spaces.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":91,"fanout":3,"areas":19},{"path":"packages/markup/src/pdfValue.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":90,"fanout":1,"areas":19},{"path":"packages/markup/src/render.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":90,"fanout":9,"areas":19},{"path":"packages/markup/src/store.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":90,"fanout":9,"areas":19},{"path":"packages/markup/src/export.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":9,"blast":89,"fanout":19,"areas":19},{"path":"packages/markup/src/import.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":3,"blast":76,"fanout":6,"areas":18},{"path":"packages/markup/src/pdfExtras.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":2,"blast":75,"fanout":3,"areas":18},{"path":"packages/markup/src/arrange.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":1,"blast":74,"fanout":2,"areas":18},{"path":"packages/markup/src/edits.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":1,"blast":74,"fanout":3,"areas":18},{"path":"packages/markup/src/offset.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":1,"blast":74,"fanout":1,"areas":18},{"path":"packages/markup/src/toolchest.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":1,"blast":74,"fanout":5,"areas":18},{"path":"packages/markup/src/index.ts","domain":"markup","area":"@nb/markup","band":"cross-cutting","direct":38,"blast":73,"fanout":23,"areas":18},{"path":"apps/web/src/desktop/host.ts","domain":"bridge","area":"Desktop","band":"cross-cutting","direct":23,"blast":49,"fanout":0,"areas":11},{"path":"packages/pdf-core/src/protocol.ts","domain":"pdf","area":"@nb/pdf-core","band":"cross-cutting","direct":3,"blast":49,"fanout":0,"areas":12},{"path":"packages/pdf-core/src/engine.ts","domain":"pdf","area":"@nb/pdf-core","band":"cross-cutting","direct":1,"blast":47,"fanout":1,"areas":12},{"path":"packages/pdf-core/src/index.ts","domain":"pdf","area":"@nb/pdf-core","band":"cross-cutting","direct":10,"blast":46,"fanout":2,"areas":12},{"path":"packages/stitch/src/affine.ts","domain":"stitch","area":"@nb/stitch","band":"cross-cutting","direct":4,"blast":41,"fanout":0,"areas":10},{"path":"packages/stitch/src/matchLines.ts","domain":"stitch","area":"@nb/stitch","band":"cross-cutting","direct":3,"blast":40,"fanout":2,"areas":10},{"path":"packages/stitch/src/align.ts","domain":"stitch","area":"@nb/stitch","band":"cross-cutting","direct":2,"blast":39,"fanout":2,"areas":10},{"path":"packages/stitch/src/layout.ts","domain":"stitch","area":"@nb/stitch","band":"cross-cutting","direct":1,"blast":38,"fanout":4,"areas":10},{"path":"packages/stitch/src/index.ts","domain":"stitch","area":"@nb/stitch","band":"cross-cutting","direct":3,"blast":37,"fanout":4,"areas":10},{"path":"apps/web/src/settings/settings.ts","domain":"features","area":"Settings","band":"cross-cutting","direct":16,"blast":34,"fanout":0,"areas":7},{"path":"apps/web/src/documents/incremental.ts","domain":"documents","area":"Documents","band":"cross-cutting","direct":7,"blast":31,"fanout":0,"areas":4},{"path":"apps/web/src/studio/crypto/keys.ts","domain":"studio","area":"Studio crypto","band":"cross-cutting","direct":6,"blast":29,"fanout":0,"areas":7},{"path":"apps/web/src/columns/formula.ts","domain":"features","area":"Columns","band":"cross-cutting","direct":2,"blast":28,"fanout":0,"areas":7},{"path":"apps/web/src/columns/listColumns.ts","domain":"features","area":"Columns","band":"cross-cutting","direct":9,"blast":27,"fanout":4,"areas":7},{"path":"apps/web/src/viewer/affine.ts","domain":"viewer","area":"Viewer","band":"cross-cutting","direct":1,"blast":27,"fanout":1,"areas":6},{"path":"apps/web/src/viewer/gestures.ts","domain":"viewer","area":"Viewer","band":"cross-cutting","direct":1,"blast":27,"fanout":0,"areas":6},{"path":"apps/web/src/viewer/layout.ts","domain":"viewer","area":"Viewer","band":"cross-cutting","direct":1,"blast":27,"fanout":0,"areas":6},{"path":"apps/web/src/viewer/TileViewer.ts","domain":"viewer","area":"Viewer","band":"cross-cutting","direct":6,"blast":26,"fanout":5,"areas":6},{"path":"apps/web/src/studio/drive/DriveApi.ts","domain":"studio","area":"Studio drive","band":"cross-cutting","direct":15,"blast":24,"fanout":0,"areas":6},{"path":"apps/web/src/markup/MarkupTools.ts","domain":"features","area":"Markup tools","band":"cross-cutting","direct":11,"blast":21,"fanout":3,"areas":5},{"path":"apps/web/src/documents/taggedContent.ts","domain":"documents","area":"Documents","band":"cross-cutting","direct":3,"blast":21,"fanout":0,"areas":3},{"path":"apps/web/src/desktop/tokens.ts","domain":"bridge","area":"Desktop","band":"shared","direct":3,"blast":19,"fanout":1,"areas":6},{"path":"apps/web/src/offline/network.ts","domain":"storage","area":"Offline","band":"shared","direct":7,"blast":18,"fanout":0,"areas":6},{"path":"apps/web/src/storage/localCrypto.ts","domain":"storage","area":"Storage","band":"shared","direct":3,"blast":18,"fanout":3,"areas":4},{"path":"apps/web/src/workspace/profiles.ts","domain":"features","area":"Workspace","band":"shared","direct":10,"blast":17,"fanout":3,"areas":4},{"path":"apps/web/src/studio/protocol.ts","domain":"studio","area":"Studio","band":"shared","direct":8,"blast":17,"fanout":0,"areas":5},{"path":"apps/web/src/documents/process.ts","domain":"documents","area":"Documents","band":"shared","direct":5,"blast":16,"fanout":2,"areas":3},{"path":"apps/web/src/studio/drive/cloudLog.ts","domain":"studio","area":"Studio drive","band":"shared","direct":3,"blast":16,"fanout":0,"areas":5},{"path":"apps/web/src/studio/drive/idle.ts","domain":"studio","area":"Studio drive","band":"shared","direct":3,"blast":16,"fanout":0,"areas":5},{"path":"apps/web/src/studio/drive/notices.ts","domain":"studio","area":"Studio drive","band":"shared","direct":3,"blast":16,"fanout":1,"areas":5},{"path":"apps/web/src/storage/fileStore.ts","domain":"storage","area":"Storage","band":"shared","direct":9,"blast":15,"fanout":1,"areas":4},{"path":"apps/web/src/desktop/printImages.ts","domain":"bridge","area":"Desktop","band":"shared","direct":1,"blast":15,"fanout":3,"areas":4},{"path":"apps/web/src/components/AskText.tsx","domain":"ui","area":"Components","band":"shared","direct":7,"blast":14,"fanout":0,"areas":2},{"path":"apps/web/src/documents/printPdf.ts","domain":"documents","area":"Documents","band":"shared","direct":5,"blast":14,"fanout":3,"areas":3},{"path":"apps/web/src/studio/types.ts","domain":"studio","area":"Studio","band":"shared","direct":6,"blast":13,"fanout":2,"areas":5},{"path":"apps/web/src/documents/pageSizes.ts","domain":"documents","area":"Documents","band":"shared","direct":4,"blast":13,"fanout":0,"areas":3},{"path":"apps/web/src/commands/keys.ts","domain":"features","area":"Commands","band":"shared","direct":3,"blast":13,"fanout":0,"areas":2},{"path":"apps/web/src/studio/drive/onedrive.ts","domain":"studio","area":"Studio drive","band":"shared","direct":10,"blast":12,"fanout":6,"areas":5},{"path":"apps/web/src/studio/local.ts","domain":"studio","area":"Studio","band":"shared","direct":6,"blast":12,"fanout":1,"areas":5},{"path":"apps/web/src/commands/shortcuts.ts","domain":"features","area":"Commands","band":"shared","direct":5,"blast":12,"fanout":2,"areas":2},{"path":"apps/web/src/documents/digitalIds.ts","domain":"documents","area":"Documents","band":"shared","direct":5,"blast":11,"fanout":0,"areas":3},{"path":"apps/web/src/storage/sets.ts","domain":"storage","area":"Storage","band":"shared","direct":5,"blast":11,"fanout":0,"areas":3},{"path":"apps/web/src/components/HatchSwatch.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":11,"fanout":1,"areas":2},{"path":"apps/web/src/documents/pageTools.ts","domain":"documents","area":"Documents","band":"shared","direct":2,"blast":11,"fanout":2,"areas":3},{"path":"apps/web/src/studio/drive/google.ts","domain":"studio","area":"Studio drive","band":"shared","direct":7,"blast":10,"fanout":6,"areas":4},{"path":"apps/web/src/signatures/signatures.ts","domain":"features","area":"Signatures","band":"shared","direct":4,"blast":10,"fanout":1,"areas":3},{"path":"apps/web/src/components/PageToolsDialog.tsx","domain":"ui","area":"Components","band":"shared","direct":3,"blast":10,"fanout":3,"areas":2},{"path":"apps/web/src/components/ShapeGeometry.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":10,"fanout":2,"areas":2},{"path":"apps/web/src/components/StampsDialog.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":10,"fanout":2,"areas":2},{"path":"apps/web/src/documents/pki.ts","domain":"documents","area":"Documents","band":"shared","direct":2,"blast":10,"fanout":1,"areas":3},{"path":"apps/web/src/components/ComboField.tsx","domain":"ui","area":"Components","band":"shared","direct":1,"blast":10,"fanout":0,"areas":2},{"path":"apps/web/src/components/ToolBar.tsx","domain":"ui","area":"Components","band":"shared","direct":6,"blast":9,"fanout":8,"areas":2},{"path":"apps/web/src/compare/diff.ts","domain":"features","area":"Compare","band":"shared","direct":5,"blast":9,"fanout":0,"areas":2},{"path":"apps/web/src/documents/headerFooter.ts","domain":"documents","area":"Documents","band":"shared","direct":3,"blast":9,"fanout":3,"areas":3},{"path":"apps/web/src/storage/fileGroups.ts","domain":"storage","area":"Storage","band":"shared","direct":3,"blast":9,"fanout":0,"areas":3},{"path":"apps/web/src/documents/pdfSign.ts","domain":"documents","area":"Documents","band":"shared","direct":2,"blast":9,"fanout":4,"areas":3},{"path":"apps/web/src/components/InlineName.tsx","domain":"ui","area":"Components","band":"shared","direct":6,"blast":8,"fanout":0,"areas":1},{"path":"apps/web/src/help/whatsNew.ts","domain":"features","area":"Help","band":"shared","direct":4,"blast":8,"fanout":0,"areas":3},{"path":"apps/web/src/components/DigitalSignatures.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":8,"fanout":4,"areas":2},{"path":"apps/web/src/components/HeaderFooterDialog.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":8,"fanout":2,"areas":2},{"path":"apps/desktop/src/assistant/message.ts","domain":"electron","area":"Electron assistant","band":"shared","direct":4,"blast":7,"fanout":0,"areas":1},{"path":"apps/web/src/studio/crypto/store.ts","domain":"studio","area":"Studio crypto","band":"shared","direct":4,"blast":7,"fanout":2,"areas":3},{"path":"apps/web/src/compare/affine.ts","domain":"features","area":"Compare","band":"shared","direct":3,"blast":7,"fanout":2,"areas":2},{"path":"apps/web/src/components/BatchDialog.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":7,"fanout":11,"areas":2},{"path":"apps/web/src/documents/formScripts.ts","domain":"documents","area":"Documents","band":"shared","direct":2,"blast":7,"fanout":0,"areas":3},{"path":"apps/web/src/documents/slipSheet.ts","domain":"documents","area":"Documents","band":"shared","direct":2,"blast":7,"fanout":0,"areas":3},{"path":"apps/web/src/components/ContextMenu.tsx","domain":"ui","area":"Components","band":"shared","direct":5,"blast":6,"fanout":0,"areas":1},{"path":"apps/web/src/commands/appCommands.ts","domain":"features","area":"Commands","band":"shared","direct":4,"blast":6,"fanout":5,"areas":2},{"path":"apps/web/src/compare/pairing.ts","domain":"features","area":"Compare","band":"shared","direct":4,"blast":6,"fanout":1,"areas":2},{"path":"apps/web/src/documents/forms.ts","domain":"documents","area":"Documents","band":"shared","direct":4,"blast":6,"fanout":3,"areas":3},{"path":"apps/web/src/sheetsync/table.ts","domain":"features","area":"Sheetsync","band":"shared","direct":4,"blast":6,"fanout":1,"areas":2},{"path":"apps/web/src/studio/crypto/sealedDrive.ts","domain":"studio","area":"Studio crypto","band":"shared","direct":3,"blast":6,"fanout":3,"areas":3},{"path":"apps/web/src/studio/drive/rooms.ts","domain":"studio","area":"Studio drive","band":"shared","direct":2,"blast":6,"fanout":2,"areas":3},{"path":"apps/web/src/studio/projects/local.ts","domain":"studio","area":"Studio projects","band":"shared","direct":4,"blast":5,"fanout":2,"areas":2},{"path":"apps/web/src/components/studio/chrome.tsx","domain":"ui","area":"Components","band":"shared","direct":3,"blast":5,"fanout":0,"areas":1},{"path":"apps/web/src/desktop/assistantFlag.ts","domain":"bridge","area":"Desktop","band":"shared","direct":3,"blast":5,"fanout":0,"areas":2},{"path":"apps/web/src/components/sessions/AccessEditor.tsx","domain":"ui","area":"Components","band":"shared","direct":2,"blast":5,"fanout":1,"areas":1},{"path":"apps/web/src/offline/icons.ts","domain":"storage","area":"Offline","band":"shared","direct":2,"blast":5,"fanout":0,"areas":2},{"path":"apps/web/src/offline/install.ts","domain":"storage","area":"Offline","band":"shared","direct":2,"blast":5,"fanout":2,"areas":2},{"path":"apps/web/src/compare/compare.worker.ts","domain":"features","area":"Compare","band":"shared","direct":1,"blast":5,"fanout":1,"areas":2},{"path":"apps/web/src/sheetsync/xlsx.ts","domain":"features","area":"Sheetsync","band":"shared","direct":1,"blast":5,"fanout":1,"areas":2},{"path":"apps/desktop/src/assistant/endpoint.ts","domain":"electron","area":"Electron assistant","band":"nearby","direct":4,"blast":4,"fanout":0,"areas":1},{"path":"apps/web/src/compare/compare.ts","domain":"features","area":"Compare","band":"nearby","direct":3,"blast":4,"fanout":5,"areas":2},{"path":"apps/web/src/components/sessions/SessionDialogs.tsx","domain":"ui","area":"Components","band":"nearby","direct":3,"blast":4,"fanout":7,"areas":1},{"path":"apps/web/src/sheets/regions.ts","domain":"features","area":"Sheets","band":"nearby","direct":3,"blast":4,"fanout":2,"areas":2},{"path":"apps/web/src/studio/projects/model.ts","domain":"studio","area":"Studio projects","band":"nearby","direct":3,"blast":4,"fanout":0,"areas":2},{"path":"apps/web/src/studio/projects/Project.ts","domain":"studio","area":"Studio projects","band":"nearby","direct":3,"blast":4,"fanout":5,"areas":2},{"path":"apps/web/src/components/ComparePagePicker.tsx","domain":"ui","area":"Components","band":"nearby","direct":2,"blast":4,"fanout":2,"areas":1},{"path":"apps/web/src/documents/ocr.ts","domain":"documents","area":"Documents","band":"nearby","direct":2,"blast":4,"fanout":3,"areas":2},{"path":"apps/web/src/offline/manifest.ts","domain":"storage","area":"Offline","band":"nearby","direct":2,"blast":4,"fanout":1,"areas":2},{"path":"apps/web/src/sheets/indexer.ts","domain":"features","area":"Sheets","band":"nearby","direct":2,"blast":4,"fanout":5,"areas":3},{"path":"apps/web/src/sheetsync/targets.ts","domain":"features","area":"Sheetsync","band":"nearby","direct":2,"blast":4,"fanout":5,"areas":2},{"path":"apps/web/src/spelling/spell.ts","domain":"features","area":"Spelling","band":"nearby","direct":2,"blast":4,"fanout":0,"areas":2},{"path":"apps/web/src/studio/drive/folder.ts","domain":"studio","area":"Studio drive","band":"nearby","direct":2,"blast":4,"fanout":2,"areas":3},{"path":"apps/web/src/desktop/clients.ts","domain":"bridge","area":"Desktop","band":"nearby","direct":1,"blast":4,"fanout":0,"areas":2},{"path":"apps/web/src/desktop/record.ts","domain":"bridge","area":"Desktop","band":"nearby","direct":1,"blast":4,"fanout":0,"areas":3},{"path":"apps/web/src/offline/ocrCache.ts","domain":"storage","area":"Offline","band":"nearby","direct":1,"blast":4,"fanout":0,"areas":2},{"path":"apps/web/src/offline/storage.ts","domain":"storage","area":"Offline","band":"nearby","direct":1,"blast":4,"fanout":0,"areas":2},{"path":"apps/web/src/summary/bcf.ts","domain":"features","area":"Summary","band":"nearby","direct":1,"blast":4,"fanout":1,"areas":2},{"path":"apps/desktop/src/allowlist.ts","domain":"electron","area":"Electron","band":"nearby","direct":3,"blast":3,"fanout":0,"areas":0},{"path":"apps/desktop/src/dev.ts","domain":"electron","area":"Electron","band":"nearby","direct":3,"blast":3,"fanout":0,"areas":0},{"path":"apps/desktop/src/atomic.ts","domain":"electron","area":"Electron","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":0},{"path":"apps/desktop/src/navigation.ts","domain":"electron","area":"Electron","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":0},{"path":"apps/web/src/components/MenuBar.tsx","domain":"ui","area":"Components","band":"nearby","direct":2,"blast":3,"fanout":6,"areas":1},{"path":"apps/web/src/components/menuIcons.tsx","domain":"ui","area":"Components","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":1},{"path":"apps/web/src/components/ScaleControl.tsx","domain":"ui","area":"Components","band":"nearby","direct":2,"blast":3,"fanout":2,"areas":1},{"path":"apps/web/src/desktop/assistant.ts","domain":"bridge","area":"Desktop","band":"nearby","direct":2,"blast":3,"fanout":2,"areas":1},{"path":"apps/web/src/desktop/assistantConfirm.ts","domain":"bridge","area":"Desktop","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":2},{"path":"apps/web/src/documents/docInfo.ts","domain":"documents","area":"Documents","band":"nearby","direct":2,"blast":3,"fanout":1,"areas":2},{"path":"apps/web/src/documents/layers.ts","domain":"documents","area":"Documents","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":2},{"path":"apps/web/src/documents/security.ts","domain":"documents","area":"Documents","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":2},{"path":"apps/web/src/jobs/jobs.ts","domain":"features","area":"Jobs","band":"nearby","direct":2,"blast":3,"fanout":0,"areas":2},{"path":"apps/web/src/search/sources.ts","domain":"features","area":"Search","band":"nearby","direct":2,"blast":3,"fanout":6,"areas":2},{"path":"apps/web/src/sheetsync/useSheetSync.ts","domain":"features","area":"Sheetsync","band":"nearby","direct":2,"blast":3,"fanout":5,"areas":2},{"path":"apps/web/src/storage/diskHandles.ts","domain":"storage","area":"Storage","band":"nearby","direct":2,"blast":3,"fanout":3,"areas":2},{"path":"apps/web/src/studio/projects/queue.ts","domain":"studio","area":"Studio projects","band":"nearby","direct":2,"blast":3,"fanout":1,"areas":2},{"path":"apps/web/src/studio/projects/store.ts","domain":"studio","area":"Studio projects","band":"nearby","direct":2,"blast":3,"fanout":8,"areas":2},{"path":"apps/web/src/summary/exportSummary.ts","domain":"features","area":"Summary","band":"nearby","direct":2,"blast":3,"fanout":3,"areas":2},{"path":"apps/web/src/toolchest/toolSets.ts","domain":"features","area":"Toolchest","band":"nearby","direct":2,"blast":3,"fanout":2,"areas":2},{"path":"apps/web/src/workspace/profileBackup.ts","domain":"features","area":"Workspace","band":"nearby","direct":2,"blast":3,"fanout":4,"areas":2},{"path":"apps/desktop/src/pdf-args.ts","domain":"electron","area":"Electron","band":"nearby","direct":1,"blast":3,"fanout":0,"areas":0},{"path":"apps/web/src/components/AccessPrefs.tsx","domain":"ui","area":"Components","band":"nearby","direct":1,"blast":3,"fanout":4,"areas":1},{"path":"apps/web/src/components/FilterBuilderDialog.tsx","domain":"ui","area":"Components","band":"nearby","direct":1,"blast":3,"fanout":1,"areas":1},{"path":"apps/web/src/components/McpPrefs.tsx","domain":"ui","area":"Components","band":"nearby","direct":1,"blast":3,"fanout":3,"areas":1},{"path":"apps/web/src/components/OfflinePrefs.tsx","domain":"ui","area":"Components","band":"nearby","direct":1,"blast":3,"fanout":5,"areas":1},{"path":"apps/web/src/documents/perspective.ts","domain":"documents","area":"Documents","band":"nearby","direct":1,"blast":3,"fanout":0,"areas":2},{"path":"apps/web/src/studio/crypto/sessionCrypto.ts","domain":"studio","area":"Studio crypto","band":"nearby","direct":1,"blast":3,"fanout":1,"areas":2},{"path":"apps/web/src/studio/record.ts","domain":"studio","area":"Studio","band":"nearby","direct":1,"blast":3,"fanout":2,"areas":2},{"path":"apps/desktop/src/capabilities.ts","domain":"electron","area":"Electron","band":"nearby","direct":2,"blast":2,"fanout":0,"areas":0},{"path":"apps/desktop/src/launch.ts","domain":"electron","area":"Electron","band":"nearby","direct":2,"blast":2,"fanout":2,"areas":0},{"path":"apps/web/src/help/logs.ts","domain":"features","area":"Help","band":"screen","direct":2,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/offline/updates.ts","domain":"storage","area":"Offline","band":"screen","direct":2,"blast":2,"fanout":0,"areas":1},{"path":"apps/desktop/src/assistant/server.ts","domain":"electron","area":"Electron assistant","band":"nearby","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/desktop/src/loopback.ts","domain":"electron","area":"Electron","band":"nearby","direct":1,"blast":2,"fanout":0,"areas":0},{"path":"apps/desktop/src/pkce.ts","domain":"electron","area":"Electron","band":"nearby","direct":1,"blast":2,"fanout":0,"areas":0},{"path":"apps/desktop/src/version.ts","domain":"electron","area":"Electron","band":"nearby","direct":1,"blast":2,"fanout":0,"areas":0},{"path":"apps/web/src/compare/batch.ts","domain":"features","area":"Compare","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/ApplyRedactionsDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/AssistantConfirmDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/BookmarksPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/CalibrateDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/CameraDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/ChangeColoursDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/ColumnsDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/CombineDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/CommandPalette.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/CommentDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/CompareDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":5,"areas":1},{"path":"apps/web/src/components/CompareResultsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/DocumentPropertiesDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/ExportDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/FieldEditor.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/FormsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/HyperlinkDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/InstallDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/JobsBar.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/LabelRegionsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/LayersPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/Library.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":5,"areas":1},{"path":"apps/web/src/components/LinksPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/MarkupList.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":10,"areas":1},{"path":"apps/web/src/components/MultiplyDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/NewPdfDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/OcrDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/PageNav.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/PagesPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/PreferencesDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":7,"areas":1},{"path":"apps/web/src/components/PrintDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/ProcessDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/ProfilesDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":8,"areas":1},{"path":"apps/web/src/components/ProjectsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":13,"areas":1},{"path":"apps/web/src/components/PropertiesPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/PublishDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/RevisionsDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/ScaleRegionsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/SearchPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/SecurityDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/sessions/InviteDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/SessionsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":10,"areas":1},{"path":"apps/web/src/components/SetsPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/SheetSyncDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/components/ShortcutsDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/SignaturesPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/SketchBar.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/SlipSheetDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/SoundDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/components/SpacesPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/SpellCheckDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/components/StatusBar.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":6,"areas":1},{"path":"apps/web/src/components/StepUpDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/TextEditor.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":3,"areas":1},{"path":"apps/web/src/components/TileDiagnostics.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/ToolChest.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":8,"areas":1},{"path":"apps/web/src/components/UndoHistoryDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/VisualSearchPanel.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/components/WhatsNewDialog.tsx","domain":"ui","area":"Components","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/desktop/installAssistant.ts","domain":"bridge","area":"Desktop","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/documents/archiveFonts.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/documents/batchLink.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/documents/fieldDetect.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/documents/imagePdf.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/documents/overlay.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/documents/pageImages.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/documents/pdfa.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/documents/zip.ts","domain":"documents","area":"Documents","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"apps/web/src/markup/hooks.ts","domain":"features","area":"Markup tools","band":"screen","direct":1,"blast":2,"fanout":4,"areas":1},{"path":"apps/web/src/markup/pickImage.ts","domain":"features","area":"Markup tools","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"apps/web/src/offline/launch.ts","domain":"storage","area":"Offline","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/studio/drive/DriveSession.ts","domain":"studio","area":"Studio drive","band":"screen","direct":1,"blast":2,"fanout":10,"areas":1},{"path":"apps/web/src/studio/report.ts","domain":"studio","area":"Studio","band":"screen","direct":1,"blast":2,"fanout":2,"areas":1},{"path":"apps/web/src/studio/roundtrip.ts","domain":"studio","area":"Studio","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"packages/markup/src/bax.ts","domain":"markup","area":"@nb/markup","band":"screen","direct":1,"blast":2,"fanout":1,"areas":1},{"path":"packages/markup/src/summary.ts","domain":"markup","area":"@nb/markup","band":"screen","direct":1,"blast":2,"fanout":0,"areas":1},{"path":"packages/markup/src/xfdf.ts","domain":"markup","area":"@nb/markup","band":"screen","direct":1,"blast":2,"fanout":6,"areas":1},{"path":"apps/desktop/src/assistant/argv.ts","domain":"electron","area":"Electron assistant","band":"screen","direct":1,"blast":1,"fanout":0,"areas":1},{"path":"apps/desktop/src/assistant/client.ts","domain":"electron","area":"Electron assistant","band":"nearby","direct":1,"blast":1,"fanout":2,"areas":0},{"path":"apps/desktop/src/assistant/page.ts","domain":"electron","area":"Electron assistant","band":"screen","direct":1,"blast":1,"fanout":1,"areas":1},{"path":"apps/desktop/src/assistant/service.ts","domain":"electron","area":"Electron assistant","band":"screen","direct":1,"blast":1,"fanout":2,"areas":1},{"path":"apps/desktop/src/assistant/stdio.ts","domain":"electron","area":"Electron assistant","band":"nearby","direct":1,"blast":1,"fanout":1,"areas":0},{"path":"apps/desktop/src/auth.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":3,"areas":0},{"path":"apps/desktop/src/folderDrive.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":0,"areas":0},{"path":"apps/desktop/src/graph.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":0,"areas":0},{"path":"apps/desktop/src/paths.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":5,"areas":0},{"path":"apps/desktop/src/print.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":1,"areas":0},{"path":"apps/desktop/src/protocol.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":0,"areas":0},{"path":"apps/desktop/src/security.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":2,"areas":0},{"path":"apps/desktop/src/updater.ts","domain":"electron","area":"Electron","band":"screen","direct":1,"blast":1,"fanout":1,"areas":0},{"path":"apps/web/src/App.tsx","domain":"shell","area":"App shell","band":"shell","direct":1,"blast":1,"fanout":155,"areas":0},{"path":"apps/web/src/components/MeasurementsPanel.tsx","domain":"ui","area":"Components","band":"nearby","direct":1,"blast":1,"fanout":3,"areas":0},{"path":"apps/web/src/desktop/bridge.ts","domain":"bridge","area":"Desktop","band":"screen","direct":1,"blast":1,"fanout":2,"areas":1},{"path":"apps/web/src/security/csp.ts","domain":"features","area":"Security","band":"nearby","direct":1,"blast":1,"fanout":0,"areas":1},{"path":"apps/desktop/scripts/fetch-assistant-node.mjs","domain":"electron","area":"Electron","band":"contained","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/desktop/src/allowlist.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/assistant/mcp-cli.ts","domain":"electron","area":"Electron assistant","band":"contained","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/desktop/src/assistant/message.test.ts","domain":"electron","area":"Electron assistant","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/desktop/src/assistant/server.test.ts","domain":"electron","area":"Electron assistant","band":"test","direct":0,"blast":0,"fanout":5,"areas":0},{"path":"apps/desktop/src/atomic.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/auth.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/folderDrive.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/graph.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/loopback.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/main.ts","domain":"electron","area":"Electron","band":"shell","direct":0,"blast":0,"fanout":16,"areas":0},{"path":"apps/desktop/src/navigation.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/pdf-args.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/src/preload.ts","domain":"electron","area":"Electron","band":"contained","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/desktop/src/version.test.ts","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/desktop/test/resolve-ts.mjs","domain":"electron","area":"Electron","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/src/columns/filters.test.ts","domain":"features","area":"Columns","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/columns/formula.test.ts","domain":"features","area":"Columns","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/commands/keys.test.ts","domain":"features","area":"Commands","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/compare/affine.test.ts","domain":"features","area":"Compare","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/compare/batch.test.ts","domain":"features","area":"Compare","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/compare/diff.test.ts","domain":"features","area":"Compare","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/components/SidePanels.tsx","domain":"ui","area":"Components","band":"contained","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/desktop/assistant.test.ts","domain":"bridge","area":"Desktop","band":"test","direct":0,"blast":0,"fanout":4,"areas":0},{"path":"apps/web/src/desktop/record.test.ts","domain":"bridge","area":"Desktop","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/batchLink.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/documents/documents.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/documents/fieldDetect.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/forms.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/formScripts.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/headerFooter.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/incremental.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/layers.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/ocr.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/overlay.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/pageTools.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/documents/pdfa.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/documents/pdfSign.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":9,"areas":0},{"path":"apps/web/src/documents/perspective.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/pki.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/documents/print.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/process.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/documents/security.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/documents/slipSheet.test.ts","domain":"documents","area":"Documents","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/main.tsx","domain":"shell","area":"App shell","band":"shell","direct":0,"blast":0,"fanout":11,"areas":0},{"path":"apps/web/src/markup/MarkupTools.test.ts","domain":"features","area":"Markup tools","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/offline/offline.test.ts","domain":"storage","area":"Offline","band":"test","direct":0,"blast":0,"fanout":7,"areas":0},{"path":"apps/web/src/security/csp.test.ts","domain":"features","area":"Security","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/sheets/regions.test.ts","domain":"features","area":"Sheets","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/sheetsync/sheetsync.test.ts","domain":"features","area":"Sheetsync","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"apps/web/src/spelling/nspell.d.ts","domain":"features","area":"Spelling","band":"contained","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/src/spelling/spell.test.ts","domain":"features","area":"Spelling","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/storage/sets.test.ts","domain":"storage","area":"Storage","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/studio/crypto/keys.test.ts","domain":"studio","area":"Studio crypto","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/studio/drive/cloudLog.test.ts","domain":"studio","area":"Studio drive","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/studio/drive/DriveSession.test.ts","domain":"studio","area":"Studio drive","band":"test","direct":0,"blast":0,"fanout":7,"areas":0},{"path":"apps/web/src/studio/drive/idle.test.ts","domain":"studio","area":"Studio drive","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/studio/drive/onedrive.test.ts","domain":"studio","area":"Studio drive","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/studio/projects/Project.test.ts","domain":"studio","area":"Studio projects","band":"test","direct":0,"blast":0,"fanout":4,"areas":0},{"path":"apps/web/src/studio/projects/queue.test.ts","domain":"studio","area":"Studio projects","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/studio/protocol.test.ts","domain":"studio","area":"Studio","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/studio/report.test.ts","domain":"studio","area":"Studio","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"apps/web/src/summary/bcf.test.ts","domain":"features","area":"Summary","band":"test","direct":0,"blast":0,"fanout":5,"areas":0},{"path":"apps/web/src/viewer/gestures.test.ts","domain":"viewer","area":"Viewer","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/viewer/rotation.test.ts","domain":"viewer","area":"Viewer","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/viewer/spread.test.ts","domain":"viewer","area":"Viewer","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/src/workspace/profiles.test.ts","domain":"features","area":"Workspace","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"apps/web/test/browser/csp.cjs","domain":"shell","area":"Web config","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/test/browser/offline.cjs","domain":"shell","area":"Web config","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/test/browser/touch.cjs","domain":"shell","area":"Web config","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/test/browser/updates.cjs","domain":"shell","area":"Web config","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/test/resolve-ts.mjs","domain":"shell","area":"Web config","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"apps/web/vite.config.ts","domain":"shell","area":"Web config","band":"contained","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"packages/markup/src/arcs.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":5,"areas":0},{"path":"packages/markup/src/arrange.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/attach.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":5,"areas":0},{"path":"packages/markup/src/bax.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/markup/src/bluebeam.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":6,"areas":0},{"path":"packages/markup/src/bookmarks.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"packages/markup/src/edits.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":5,"areas":0},{"path":"packages/markup/src/hatches.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":4,"areas":0},{"path":"packages/markup/src/import.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/legend.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/offset.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/ownership.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/markup/src/pages.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/markup/src/shapes.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":6,"areas":0},{"path":"packages/markup/src/spaces.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/stamp.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"packages/markup/src/store.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/textSelect.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/markup/src/toolchest.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/markup/src/tools.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":9,"areas":0},{"path":"packages/markup/src/types.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":6,"areas":0},{"path":"packages/markup/src/viewports.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":4,"areas":0},{"path":"packages/markup/src/xfdf.test.ts","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"packages/markup/test/resolve-ts.mjs","domain":"markup","area":"@nb/markup","band":"test","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"packages/measure/src/fill.test.ts","domain":"measure","area":"@nb/measure","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/measure/src/measure.test.ts","domain":"measure","area":"@nb/measure","band":"test","direct":0,"blast":0,"fanout":3,"areas":0},{"path":"packages/measure/src/rasterSearch.test.ts","domain":"measure","area":"@nb/measure","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/measure/src/visualSearch.test.ts","domain":"measure","area":"@nb/measure","band":"test","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/pdf-core/src/assets.d.ts","domain":"pdf","area":"@nb/pdf-core","band":"contained","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"packages/pdf-core/src/worker.ts","domain":"pdf","area":"@nb/pdf-core","band":"contained","direct":0,"blast":0,"fanout":1,"areas":0},{"path":"packages/sheets/src/detect.test.ts","domain":"sheets","area":"@nb/sheets","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/sheets/src/links.test.ts","domain":"sheets","area":"@nb/sheets","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/sheets/src/search.test.ts","domain":"sheets","area":"@nb/sheets","band":"test","direct":0,"blast":0,"fanout":2,"areas":0},{"path":"packages/stitch/src/stitch.test.ts","domain":"stitch","area":"@nb/stitch","band":"test","direct":0,"blast":0,"fanout":4,"areas":0},{"path":"reference_data/bluebeam-compat-harness/harness.mjs","domain":"tooling","area":"Reference data","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"reference_data/bluebeam-compat-harness/hooks.mjs","domain":"tooling","area":"Reference data","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/desktop.mjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/electronegativity-gate.mjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/lib.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/01-getting-started.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/02-viewing.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/03-markup-tools.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/04-editing.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/05-measure.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/06-markups-list.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/07-tool-library.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/08-pages-documents.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/09-sets-revisions.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/10-forms-signatures.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/11-batch.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/12-share-export.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/13-together.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/sections/14-customise-help.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/help/shots.cjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0},{"path":"scripts/third-party-notices.mjs","domain":"tooling","area":"Scripts","band":"tooling","direct":0,"blast":0,"fanout":0,"areas":0}];
const EDGES: Array<[number, number]> = [[273,140],[256,122],[256,101],[274,256],[274,122],[274,259],[275,255],[275,122],[275,101],[257,101],[276,256],[276,122],[276,101],[276,173],[276,258],[173,101],[258,122],[258,173],[259,101],[277,142],[278,175],[260,142],[260,174],[260,175],[279,261],[280,262],[170,140],[170,161],[281,174],[282,255],[282,122],[282,257],[282,258],[282,260],[282,262],[282,261],[282,140],[282,169],[282,141],[282,170],[282,263],[282,264],[282,265],[282,266],[282,267],[283,143],[263,140],[263,142],[263,141],[263,170],[263,143],[284,161],[264,169],[266,141],[266,143],[267,176],[286,176],[268,44],[268,40],[268,6],[268,58],[268,232],[268,60],[268,246],[268,71],[268,249],[268,59],[268,85],[268,78],[268,79],[268,66],[268,75],[268,199],[268,201],[268,221],[268,111],[268,154],[268,73],[268,52],[268,112],[268,102],[268,230],[268,233],[268,223],[268,184],[268,191],[268,210],[268,207],[268,50],[268,54],[268,65],[268,86],[268,231],[268,247],[268,226],[268,234],[268,103],[268,228],[268,236],[268,213],[268,182],[268,178],[268,33],[268,150],[268,171],[268,98],[268,180],[268,194],[268,208],[268,227],[268,224],[268,88],[268,87],[268,100],[268,209],[268,204],[268,188],[268,242],[268,109],[268,225],[268,214],[268,220],[268,217],[268,99],[268,81],[268,96],[268,193],[268,192],[268,110],[268,104],[268,82],[268,95],[268,189],[268,196],[268,152],[268,235],[268,92],[268,108],[268,77],[268,80],[268,107],[268,187],[268,202],[268,183],[268,145],[268,125],[268,229],[268,186],[268,222],[268,89],[268,203],[268,185],[268,190],[268,241],[268,149],[268,197],[268,215],[268,18],[268,106],[268,159],[268,181],[268,146],[268,206],[268,216],[268,153],[268,144],[268,205],[268,212],[268,219],[268,211],[268,157],[268,156],[268,114],[268,127],[268,126],[268,124],[268,218],[268,251],[268,198],[268,200],[268,131],[268,63],[268,172],[268,195],[268,155],[268,41],[268,148],[268,237],[268,179],[268,116],[268,147],[268,248],[268,129],[268,123],[268,177],[268,67],[268,84],[268,239],[268,74],[268,94],[268,90],[268,253],[268,245],[268,250],[268,158],[268,240],[268,244],[268,238],[268,254],[268,252],[268,243],[268,151],[288,40],[288,6],[288,54],[289,53],[289,54],[54,40],[54,6],[54,18],[54,53],[108,104],[108,41],[108,50],[108,60],[108,92],[290,77],[80,65],[80,77],[291,103],[103,49],[103,93],[292,177],[177,109],[123,44],[123,93],[123,120],[123,109],[123,103],[120,93],[293,93],[293,123],[109,106],[162,68],[162,85],[162,41],[162,64],[179,148],[104,71],[104,82],[104,95],[104,67],[104,94],[104,81],[104,86],[104,40],[104,76],[104,100],[104,99],[180,97],[181,50],[181,6],[182,166],[184,40],[184,53],[184,54],[184,65],[186,108],[186,80],[187,50],[188,71],[188,82],[188,123],[188,109],[188,128],[128,103],[128,93],[189,123],[189,93],[99,81],[99,96],[99,86],[99,73],[190,44],[190,149],[190,76],[191,40],[191,54],[191,158],[192,110],[192,58],[163,54],[193,110],[193,105],[83,40],[100,94],[100,87],[194,40],[194,128],[195,119],[196,152],[197,18],[197,125],[198,150],[198,73],[199,82],[199,95],[199,71],[199,97],[199,107],[200,40],[200,18],[201,40],[201,6],[201,18],[201,65],[201,73],[201,50],[201,107],[201,163],[201,145],[201,92],[164,135],[164,116],[164,41],[269,60],[269,80],[269,50],[144,108],[144,80],[144,41],[144,119],[144,60],[144,92],[202,6],[203,76],[204,74],[204,50],[165,41],[165,129],[165,63],[165,137],[165,138],[206,44],[206,18],[206,6],[206,146],[87,74],[87,76],[87,84],[207,50],[207,133],[207,73],[207,162],[207,164],[207,165],[207,41],[208,74],[209,67],[209,87],[210,40],[210,54],[210,60],[210,160],[210,65],[210,97],[210,144],[210,92],[211,59],[211,78],[211,114],[211,126],[211,127],[211,156],[211,41],[211,134],[211,157],[211,73],[211,124],[211,115],[211,63],[212,6],[212,60],[212,54],[212,83],[213,74],[214,71],[146,6],[146,50],[215,18],[215,6],[215,125],[216,18],[216,153],[217,151],[117,66],[124,78],[124,52],[124,102],[124,66],[124,75],[124,117],[124,115],[219,85],[219,78],[219,79],[219,66],[219,75],[219,117],[219,115],[219,41],[219,63],[219,124],[220,71],[220,82],[220,97],[88,40],[88,6],[221,132],[221,154],[222,108],[222,77],[222,65],[294,40],[294,269],[223,40],[223,86],[223,73],[223,107],[224,40],[224,6],[224,60],[224,50],[225,71],[227,40],[227,6],[227,97],[228,40],[228,44],[228,50],[228,133],[89,40],[89,65],[229,6],[229,58],[229,50],[229,63],[229,41],[229,116],[230,98],[230,70],[230,78],[231,40],[231,50],[231,58],[232,58],[92,40],[92,6],[92,60],[92,91],[92,83],[92,88],[92,89],[92,80],[233,40],[233,60],[233,159],[233,65],[233,107],[233,50],[233,97],[233,92],[234,40],[235,6],[236,98],[295,40],[295,147],[295,148],[295,135],[147,40],[147,6],[270,41],[270,62],[237,147],[237,41],[72,44],[72,41],[72,62],[296,136],[62,41],[297,18],[297,239],[239,18],[149,51],[298,149],[298,241],[298,76],[299,240],[300,110],[110,33],[110,51],[110,105],[301,105],[302,94],[94,61],[94,51],[94,33],[303,51],[304,150],[305,129],[129,33],[129,61],[129,51],[306,242],[242,33],[242,67],[243,44],[307,84],[307,245],[84,33],[84,51],[308,244],[308,33],[308,40],[309,81],[309,96],[309,51],[309,110],[309,94],[309,129],[309,149],[309,84],[309,67],[96,33],[96,51],[96,81],[96,90],[310,166],[311,81],[311,96],[311,90],[90,81],[312,74],[74,41],[74,67],[74,72],[313,33],[313,40],[313,67],[67,61],[67,51],[314,151],[315,106],[315,84],[316,270],[316,41],[316,171],[316,64],[316,71],[316,85],[316,69],[316,78],[316,172],[316,160],[316,268],[246,40],[246,6],[246,18],[246,60],[317,40],[317,58],[317,60],[60,6],[60,50],[60,58],[247,40],[119,41],[119,98],[248,155],[248,130],[130,118],[318,118],[318,130],[318,119],[318,138],[318,172],[318,248],[318,137],[153,44],[153,40],[153,18],[153,110],[153,131],[153,71],[319,271],[131,44],[131,40],[131,18],[131,49],[131,35],[320,18],[320,125],[125,18],[125,6],[321,121],[321,111],[321,132],[111,54],[132,59],[132,85],[132,78],[132,111],[132,121],[154,59],[154,85],[154,78],[154,132],[154,111],[121,111],[86,40],[323,133],[155,41],[155,136],[155,62],[71,64],[64,40],[64,41],[64,52],[324,82],[325,52],[112,59],[112,79],[112,52],[167,102],[102,79],[102,52],[326,68],[326,70],[327,40],[327,66],[327,59],[327,249],[327,52],[327,167],[327,102],[249,40],[249,66],[249,79],[249,168],[249,75],[249,59],[249,113],[249,52],[249,167],[249,102],[134,41],[134,59],[85,59],[85,68],[85,69],[85,70],[85,41],[85,63],[328,69],[70,59],[329,59],[329,78],[78,59],[78,41],[78,63],[78,68],[78,69],[78,70],[113,40],[113,59],[79,75],[114,112],[114,79],[330,40],[330,59],[330,127],[330,112],[127,40],[127,59],[127,113],[127,75],[127,114],[331,59],[331,156],[156,59],[157,59],[157,78],[157,127],[157,114],[157,41],[157,134],[157,112],[157,126],[332,66],[168,40],[168,66],[333,250],[333,66],[250,40],[250,66],[75,40],[75,66],[334,40],[334,6],[334,18],[334,54],[334,158],[139,40],[158,40],[158,54],[158,139],[159,40],[159,65],[55,49],[335,56],[336,55],[337,57],[58,44],[58,50],[58,55],[58,57],[58,56],[160,85],[160,78],[160,59],[160,65],[338,65],[65,40],[65,54],[65,60],[344,118],[344,130],[344,271],[345,6],[345,33],[345,36],[345,23],[345,8],[346,36],[346,8],[36,11],[36,8],[347,33],[347,23],[347,34],[347,8],[347,31],[348,252],[252,24],[349,24],[349,33],[349,34],[349,35],[349,32],[349,8],[24,6],[24,20],[24,8],[24,9],[24,19],[350,33],[350,34],[350,8],[14,8],[22,8],[25,8],[351,37],[351,23],[351,26],[351,8],[351,32],[37,8],[37,23],[37,10],[33,6],[33,23],[33,11],[33,22],[33,21],[33,26],[33,12],[33,10],[33,8],[33,31],[33,13],[33,9],[33,32],[33,14],[33,19],[33,24],[33,20],[33,25],[33,30],[23,11],[23,6],[23,22],[23,21],[23,8],[23,10],[23,13],[23,9],[352,33],[352,23],[352,13],[352,8],[353,34],[353,8],[34,18],[34,6],[34,8],[34,25],[34,9],[34,19],[40,8],[40,10],[40,9],[40,20],[40,32],[40,27],[40,23],[40,11],[40,22],[40,38],[40,12],[40,19],[40,29],[40,26],[40,21],[40,36],[40,31],[40,34],[40,25],[40,37],[40,24],[40,28],[40,39],[354,26],[354,8],[26,6],[26,8],[26,10],[8,6],[8,11],[8,10],[8,12],[8,14],[8,9],[355,38],[355,8],[38,8],[356,27],[27,8],[357,28],[28,8],[35,24],[35,30],[35,33],[30,24],[31,6],[31,29],[31,23],[31,8],[31,10],[31,26],[31,12],[31,13],[31,9],[358,11],[358,33],[358,23],[358,34],[358,8],[358,22],[359,8],[359,29],[29,6],[29,23],[29,8],[360,33],[360,8],[360,12],[12,8],[361,32],[361,8],[32,6],[32,18],[32,20],[32,8],[32,27],[32,28],[32,14],[32,19],[32,10],[9,8],[9,10],[9,13],[362,21],[21,8],[363,39],[363,8],[39,8],[39,34],[39,35],[39,12],[39,9],[364,6],[364,33],[364,23],[364,34],[364,8],[364,31],[364,32],[364,10],[364,254],[365,6],[365,33],[365,23],[365,34],[365,8],[365,10],[10,8],[10,9],[366,6],[366,33],[366,8],[366,19],[19,6],[19,8],[367,8],[367,33],[367,254],[254,11],[254,33],[254,34],[254,8],[254,21],[254,9],[369,2],[369,1],[2,1],[6,0],[6,1],[6,4],[6,2],[6,5],[6,3],[370,0],[370,1],[370,4],[1,0],[371,3],[4,1],[372,5],[5,1],[43,42],[44,43],[44,42],[374,42],[375,15],[375,7],[15,7],[18,7],[18,15],[18,16],[18,17],[376,16],[376,7],[16,15],[16,7],[377,17],[377,7],[17,7],[47,45],[47,46],[49,45],[49,46],[49,47],[49,48],[48,18],[48,45],[48,47],[48,46],[46,18],[46,45],[378,18],[378,45],[378,48],[378,46],[398,383]];
const DOMAIN_EDGES: Array<{ from: string; to: string; n: number }> = [{"from":"ui","to":"shell","n":72},{"from":"features","to":"ui","n":61},{"from":"features","to":"shell","n":27},{"from":"documents","to":"ui","n":24},{"from":"studio","to":"ui","n":23},{"from":"documents","to":"shell","n":21},{"from":"storage","to":"ui","n":21},{"from":"studio","to":"shell","n":20},{"from":"markup","to":"ui","n":19},{"from":"measure","to":"ui","n":13},{"from":"storage","to":"shell","n":12},{"from":"bridge","to":"ui","n":12},{"from":"markup","to":"features","n":11},{"from":"measure","to":"markup","n":10},{"from":"studio","to":"features","n":9},{"from":"bridge","to":"shell","n":7},{"from":"sheets","to":"ui","n":6},{"from":"markup","to":"documents","n":6},{"from":"markup","to":"studio","n":6},{"from":"markup","to":"shell","n":5},{"from":"sheets","to":"features","n":5},{"from":"bridge","to":"storage","n":5},{"from":"measure","to":"features","n":4},{"from":"viewer","to":"ui","n":4},{"from":"bridge","to":"studio","n":4},{"from":"pdf","to":"features","n":3},{"from":"pdf","to":"ui","n":3},{"from":"ui","to":"features","n":2},{"from":"stitch","to":"features","n":2},{"from":"documents","to":"features","n":2},{"from":"bridge","to":"documents","n":2},{"from":"storage","to":"studio","n":2},{"from":"sheets","to":"markup","n":2},{"from":"sheets","to":"stitch","n":2}];

const BAND_LABEL: Record<Band, string> = {
  "cross-cutting": "Cross-cutting",
  shared: "Shared",
  nearby: "Nearby",
  screen: "Shell-only",
  contained: "Contained",
  shell: "Shell",
  test: "Test",
  tooling: "Tooling",
};

const BANDS: Band[] = ["cross-cutting", "shared", "nearby", "screen", "contained", "shell", "test", "tooling"];

type DomainInfo = {
  id: string;
  label: string;
  library: boolean;
  drawFiles: boolean;
  blurb: string;
};

const DOMAINS: DomainInfo[] = [
  { id: "measure", label: "@nb/measure", library: true, drawFiles: true, blurb: "Scale, snap, and measurement math. The package barrel re-exports it, so a change here reaches most of the app." },
  { id: "sheets", label: "@nb/sheets", library: true, drawFiles: true, blurb: "Shared sheet types. Markup and stitch both build on this package." },
  { id: "pdf", label: "@nb/pdf-core", library: true, drawFiles: true, blurb: "PDFium wrapper used by the viewer, documents, and compare." },
  { id: "stitch", label: "@nb/stitch", library: true, drawFiles: true, blurb: "Page stitching and layout. Depends on sheets." },
  { id: "markup", label: "@nb/markup", library: true, drawFiles: true, blurb: "Annotation model. The largest shared package, and the one the UI imports most often." },
  { id: "viewer", label: "Viewer", library: false, drawFiles: true, blurb: "Tile viewer and input gestures." },
  { id: "documents", label: "Documents", library: false, drawFiles: true, blurb: "Page operations: OCR, print, overlay, headers, images." },
  { id: "studio", label: "Studio", library: false, drawFiles: true, blurb: "Projects, cloud drives, and session crypto." },
  { id: "storage", label: "Storage", library: false, drawFiles: true, blurb: "Local file store and the offline cache." },
  { id: "bridge", label: "Desktop bridge", library: false, drawFiles: true, blurb: "Web side of the Electron host. The desktop process does not import these files; they meet over IPC." },
  { id: "ui", label: "UI components", library: false, drawFiles: false, blurb: "React panels and dialogs. Most are shell-only: App.tsx mounts them and no other module does. A few are shared across features." },
  { id: "features", label: "Feature modules", library: false, drawFiles: false, blurb: "Smaller web modules grouped only because each folder is small: commands, compare, columns, markup tools, settings, sheets, and the rest. They are not one component." },
  { id: "shell", label: "App shell", library: false, drawFiles: true, blurb: "App.tsx and main.tsx. They wire the product together. Little else imports them." },
  { id: "electron", label: "Electron", library: false, drawFiles: true, blurb: "The desktop process. It does not import the web app, and the web app does not import it." },
  { id: "tooling", label: "Tooling", library: false, drawFiles: false, blurb: "Scripts and reference-data harnesses. They are outside the running app." },
];

const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

const IMPORTED_BY: number[][] = FILES.map(() => []);
const IMPORTS_OF: number[][] = FILES.map(() => []);
for (const [importer, imported] of EDGES) {
  IMPORTED_BY[imported].push(importer);
  IMPORTS_OF[importer].push(imported);
}
for (let i = 0; i < FILES.length; i++) {
  IMPORTED_BY[i].sort((a, b) => FILES[b].blast - FILES[a].blast || FILES[a].path.localeCompare(FILES[b].path));
  IMPORTS_OF[i].sort((a, b) => FILES[b].blast - FILES[a].blast || FILES[a].path.localeCompare(FILES[b].path));
}

function countBand(band: Band, productionOnly: boolean): number {
  let n = 0;
  for (const file of FILES) {
    if (file.band !== band) continue;
    if (productionOnly && (file.band === "test" || file.band === "tooling")) continue;
    n++;
  }
  return n;
}

function fileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

function rowTone(band: Band): "danger" | "warning" | "info" | "success" | "neutral" {
  if (band === "cross-cutting") return "danger";
  if (band === "shared" || band === "shell") return "warning";
  if (band === "nearby") return "info";
  if (band === "screen" || band === "contained") return "success";
  return "neutral";
}

function bandHelp(file: FileRec): string {
  if (file.band === "cross-cutting") {
    return "A change can reach " + file.blast + " other production files" + (file.areas > 0 ? ", across " + file.areas + " other areas" : "") + ". " + file.direct + " of those name this file directly. Treat the diff as serious.";
  }
  if (file.band === "shared") {
    return "Downstream of this file: " + file.blast + " production files, " + file.direct + " of them direct. Check those callers.";
  }
  if (file.band === "nearby") {
    return "Only " + file.blast + " production file" + (file.blast === 1 ? " sits" : "s sit") + " downstream. The change usually stays in this feature.";
  }
  if (file.band === "screen") {
    return "Only the app shell imports this (App.tsx, main.tsx, or the Electron main process). Other modules do not, so the change stays on that path.";
  }
  if (file.band === "contained") {
    return "No other production file imports this. The change stays in this file" + (file.fanout > 0 ? ", which itself imports " + file.fanout + " production files" : "") + ".";
  }
  if (file.band === "shell") {
    const inbound = file.blast === 0 ? "Nothing else imports this file" : "Only " + file.blast + " production file" + (file.blast === 1 ? " imports" : "s import") + " this file";
    return inbound + ", and it imports " + file.fanout + ". It is where those pieces are wired together, so a behavior change can show up across the screens it composes.";
  }
  if (file.band === "test") return "Test file. Production code does not import it, and it does not ship.";
  return "Script or harness outside the running app.";
}

function FlowGraph(props: {
  nodes: Array<{ id: string; title: string; detail: string; library: boolean }>;
  edges: Array<{ from: string; to: string; n: number }>;
  selected: string;
  onSelect: (id: string) => void;
  nodeWidth: number;
  nodeHeight: number;
}) {
  const theme = useHostTheme();
  const layout = useMemo(
    () =>
      computeDAGLayout({
        nodes: props.nodes.map((n) => ({ id: n.id })),
        edges: props.edges.map((e) => ({ from: e.from, to: e.to })),
        direction: "horizontal",
        nodeWidth: props.nodeWidth,
        nodeHeight: props.nodeHeight,
        rankGap: 64,
        nodeGap: 14,
        padding: 16,
      }),
    [props.nodes, props.edges, props.nodeWidth, props.nodeHeight],
  );
  const placed = new Map(layout.nodes.map((n) => [n.id, n]));
  const meta = new Map(props.nodes.map((n) => [n.id, n]));
  const weight = new Map(props.edges.map((e) => [e.from + ">" + e.to, e.n]));
  const neighbors = new Set<string>();
  if (props.selected) {
    neighbors.add(props.selected);
    for (const edge of props.edges) {
      if (edge.from === props.selected || edge.to === props.selected) {
        neighbors.add(edge.from);
        neighbors.add(edge.to);
      }
    }
  }
  return (
    <div style={{ overflowX: "auto", background: theme.bg.editor, border: "1px solid " + theme.stroke.tertiary, borderRadius: theme.radius.lg }}>
      <svg width={layout.width} height={layout.height} role="img" aria-label="Import flow, left to right">
        {layout.edges.map((edge, i) => {
          const n = weight.get(edge.from + ">" + edge.to) || 1;
          const hot = !props.selected || edge.from === props.selected || edge.to === props.selected;
          const mx = (edge.sourceX + edge.targetX) / 2;
          const d = "M " + edge.sourceX + " " + edge.sourceY + " C " + mx + " " + edge.sourceY + ", " + mx + " " + edge.targetY + ", " + edge.targetX + " " + edge.targetY;
          return (
            <path
              key={edge.from + "-" + edge.to + "-" + i}
              d={d}
              fill="none"
              stroke={hot && props.selected ? theme.accent.primary : theme.stroke.secondary}
              strokeWidth={Math.min(4, 0.8 + Math.log2(n))}
              strokeDasharray={edge.isBackEdge ? "4 3" : undefined}
              opacity={hot ? 0.9 : 0.15}
            />
          );
        })}
        {props.nodes.map((node) => {
          const box = placed.get(node.id);
          if (!box) return null;
          const info = meta.get(node.id);
          const on = props.selected === node.id;
          const dim = props.selected !== "" && !neighbors.has(node.id);
          const fill = on ? theme.accent.primary : theme.fill.tertiary;
          const stroke = on ? theme.accent.primary : info && info.library ? theme.accent.primary : theme.stroke.primary;
          const titleFill = on ? theme.text.onAccent : theme.text.primary;
          const detailFill = on ? theme.text.onAccent : theme.text.secondary;
          return (
            <g key={node.id} opacity={dim ? 0.35 : 1} style={{ cursor: "pointer" }} onClick={() => props.onSelect(node.id)}>
              <title>{node.id + " — " + node.detail}</title>
              <rect x={box.x} y={box.y} width={props.nodeWidth} height={props.nodeHeight} rx={6} fill={fill} stroke={stroke} strokeWidth={info && info.library && !on ? 1.5 : 1} />
              <text x={box.x + 10} y={box.y + 22} fill={titleFill} fontSize={12} fontWeight={600} fontFamily={theme.typography.fontFamily}>
                {node.title.length > 22 ? node.title.slice(0, 21) + "…" : node.title}
              </text>
              <text x={box.x + 10} y={box.y + 40} fill={detailFill} fontSize={11} fontFamily={theme.typography.fontFamily}>
                {node.detail}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function domainNodes() {
  return DOMAINS.filter((d) => d.id !== "electron" && d.id !== "tooling").map((d) => {
    let prod = 0;
    let wide = 0;
    for (const file of FILES) {
      if (file.domain !== d.id || file.band === "test" || file.band === "tooling") continue;
      prod++;
      if (file.band === "cross-cutting") wide++;
    }
    const detail = wide > 0 ? prod + " files, " + wide + " wide" : prod + " files";
    return { id: d.id, title: d.label, detail, library: d.library };
  });
}

function FileList(props: { indexes: number[]; empty: string; onOpen: (path: string) => void }) {
  const shown = props.indexes.filter((i) => i >= 0).slice(0, 24);
  const rest = props.indexes.length - shown.length;
  if (shown.length === 0) {
    return <Text tone="secondary" size="small">{props.empty}</Text>;
  }
  return (
    <Stack gap={4}>
      {shown.map((i) => (
        <Row key={FILES[i].path} gap={8} align="center">
          <Button variant="ghost" onClick={() => props.onOpen(FILES[i].path)}>{fileName(FILES[i].path)}</Button>
          <Text size="small" tone="tertiary">{BAND_LABEL[FILES[i].band]} · {FILES[i].blast} reached</Text>
        </Row>
      ))}
      {rest > 0 ? <Text size="small" tone="tertiary">{rest} more</Text> : null}
    </Stack>
  );
}

export default function CodebaseReach() {
  const dispatch = useCanvasAction();
  const [band, setBand] = useCanvasState<string>("band", "all");
  const [domain, setDomain] = useCanvasState<string>("domain", "all");
  const [query, setQuery] = useCanvasState("query", "");
  const [selected, setSelected] = useCanvasState("selected", "");

  const productionBands: Band[] = ["cross-cutting", "shared", "nearby", "screen", "contained", "shell"];
  const nodes = useMemo(() => domainNodes(), []);
  const selectedFile = FILES.find((f) => f.path === selected) || null;
  const selectedDomain = DOMAIN_BY_ID.get(domain);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FILES.filter((file) => {
      if (band !== "all" && file.band !== band) return false;
      if (domain !== "all" && file.domain !== domain) return false;
      if (!q) return true;
      return file.path.toLowerCase().includes(q) || file.area.toLowerCase().includes(q);
    });
  }, [band, domain, query]);

  const shown = matches.slice(0, 40);

  const fileGraph = useMemo(() => {
    if (!selectedDomain || !selectedDomain.drawFiles) return null;
    const members = FILES.filter((f) => f.domain === domain && f.band !== "test" && f.band !== "tooling");
    if (members.length === 0 || members.length > 40) return null;
    const ids = new Set(members.map((f) => f.path));
    const local: Array<{ from: string; to: string; n: number }> = [];
    const seen = new Set<string>();
    for (const [importer, imported] of EDGES) {
      const a = FILES[imported].path;
      const b = FILES[importer].path;
      if (!ids.has(a) || !ids.has(b)) continue;
      if (FILES[importer].band === "test" || FILES[imported].band === "test") continue;
      const key = a + ">" + b;
      if (seen.has(key)) continue;
      seen.add(key);
      local.push({ from: a, to: b, n: 1 });
    }
    return {
      nodes: members.map((f) => ({
        id: f.path,
        title: fileName(f.path),
        detail: BAND_LABEL[f.band] + " · " + f.blast,
        library: false,
      })),
      edges: local,
    };
  }, [domain, selectedDomain]);

  return (
    <Stack gap={20}>
      <Stack gap={8}>
        <H1>Where a change can spread</H1>
        <Text>
          {FILES.length} source files and {EDGES.length} internal imports, scanned from the repo on 12 Oct 2026.
          Reach is the number of other production files that import a file, directly or through any chain.
          That is a better split than core versus ancillary: a dialog can matter to the product and still be safe to edit when no other module imports it.
        </Text>
      </Stack>

      <Grid columns={4} gap={16}>
        <Stat value={countBand("cross-cutting", true)} label="Cross-cutting files" tone="danger" />
        <Stat value={countBand("shared", true)} label="Shared files" tone="warning" />
        <Stat value={countBand("nearby", true)} label="Nearby files" tone="info" />
        <Stat value={countBand("screen", true)} label="Shell-only files" tone="success" />
      </Grid>
      <Text size="small" tone="secondary">
        {countBand("contained", true)} contained files have no production callers. {countBand("shell", true)} shell files wire the app together. {countBand("test", false)} tests and {countBand("tooling", false)} tooling files do not ship.
      </Text>

      <Callout tone="info" title="How to read reach">
        Package index files re-export their siblings, so a file that only the barrel imports can still show a large reach. Type-only imports count. The Electron process and the web app do not import each other; they meet through the desktop bridge at runtime, which this import map cannot draw.
      </Callout>

      <Stack gap={8}>
        <H2>How areas connect</H2>
        <Text>
          Left is the file that would change. The arrow points at the area that imports it, which is the direction a bug or a behavior change travels. Thicker arrows are more import statements. An arrow with only one import is hidden. A dashed arrow is a cycle. Accent borders are the shared packages.
        </Text>
        <FlowGraph
          nodes={nodes}
          edges={DOMAIN_EDGES}
          selected={domain === "all" ? "" : domain}
          onSelect={(id) => setDomain(domain === id ? "all" : id)}
          nodeWidth={168}
          nodeHeight={52}
        />
        <Text size="small" tone="tertiary">
          Source: static import and require scan of apps/ and packages/ · 12 Oct 2026. Horizontal axis is dependency depth (libraries on the left, the app shell on the right). Vertical position only separates neighbors.
        </Text>
        {selectedDomain ? <Text>{selectedDomain.blurb}</Text> : <Text tone="secondary">Select an area to filter the file list. Select it again to clear.</Text>}
      </Stack>

      {fileGraph ? (
        <Stack gap={8}>
          <H2>Files inside {selectedDomain ? selectedDomain.label : "this area"}</H2>
          <Text>
            Production files only. An arrow still means the file on the left is imported by the file on the right. Select a box to open that file below.
          </Text>
          <FlowGraph
            nodes={fileGraph.nodes}
            edges={fileGraph.edges}
            selected={selected}
            onSelect={(id) => setSelected(selected === id ? "" : id)}
            nodeWidth={156}
            nodeHeight={48}
          />
        </Stack>
      ) : null}

      <Stack gap={8}>
        <H2>What each band means</H2>
        <Grid columns="1.15fr 0.85fr" gap={24}>
          <Table
            headers={["Band", "Downstream production files", "How to treat a change"]}
            columnAlign={["left", "left", "left"]}
            rowTone={["danger", "warning", "info", "success", "success", "warning", "neutral", "neutral"]}
            rows={[
              ["Cross-cutting", "20 or more", "Serious. Read the direct importers before merging."],
              ["Shared", "5 to 19", "Check every file that imports it."],
              ["Nearby", "1 to 4, outside the shell", "Usually one feature. Flow-on is limited."],
              ["Shell-only", "Only the app shell", "Other modules do not import it. The change stays on the path the shell already mounts."],
              ["Contained", "None", "Stays in this file."],
              ["Shell", "At most 1, but it imports 10 or more", "Composition root. Types do not ripple out, but behavior can span the screens it wires up."],
              ["Test", "Not shipped", "No production flow-on."],
              ["Tooling", "Scripts and harnesses", "Outside the running app."],
            ]}
            striped
          />
          <Stack gap={8}>
            <H3>Production files in each band</H3>
            <BarChart
              horizontal
              height={260}
              categories={productionBands.map((b) => BAND_LABEL[b])}
              series={[{ name: "Production source files", data: productionBands.map((b) => countBand(b, true)) }]}
              showValues
            />
            <Text size="small" tone="tertiary">
              Horizontal axis: production source files (count). Vertical axis: reach band. Tests and tooling are excluded. Source: same import scan, 12 Oct 2026.
            </Text>
          </Stack>
        </Grid>
      </Stack>

      <Divider />

      <Stack gap={8}>
        <H2>Look up a file</H2>
        <Text>
          Sorted by files reached. Select a file to walk its importers. {matches.length} match{matches.length === 1 ? "" : "es"}.
          {matches.length > shown.length ? " Showing the first 40." : ""}
        </Text>
        <Row gap={8} align="center" wrap>
          <TextInput value={query} onChange={setQuery} placeholder="Filter by path or area" style={{ minWidth: 220 }} />
          <Select
            value={domain}
            onChange={setDomain}
            options={[{ value: "all", label: "All areas" }, ...DOMAINS.map((d) => ({ value: d.id, label: d.label }))]}
            style={{ minWidth: 180 }}
          />
        </Row>
        <Row gap={6} wrap>
          <Pill active={band === "all"} onClick={() => setBand("all")}>All bands</Pill>
          {BANDS.map((b) => (
            <Pill key={b} active={band === b} onClick={() => setBand(band === b ? "all" : b)}>{BAND_LABEL[b]}</Pill>
          ))}
        </Row>
      </Stack>

      {selectedFile ? (
        <Card>
          <CardHeader trailing={<Pill active size="sm">{BAND_LABEL[selectedFile.band]}</Pill>}>
            {selectedFile.path}
          </CardHeader>
          <CardBody>
            <Stack gap={12}>
              <Text>{bandHelp(selectedFile)}</Text>
              <Row gap={8} align="center">
                <Text size="small" tone="secondary">{selectedFile.area}</Text>
                <Button
                  variant="secondary"
                  onClick={() => dispatch({ type: "openFile", path: selectedFile.path })}
                >
                  Open file
                </Button>
              </Row>
              <Grid columns={2} gap={16}>
                <Stack gap={6}>
                  <H3>Imported by</H3>
                  <FileList
                    indexes={IMPORTED_BY[FILES.indexOf(selectedFile)] || []}
                    empty="No file in this repo imports it."
                    onOpen={setSelected}
                  />
                </Stack>
                <Stack gap={6}>
                  <H3>Imports</H3>
                  <FileList
                    indexes={IMPORTS_OF[FILES.indexOf(selectedFile)] || []}
                    empty="No internal imports."
                    onOpen={setSelected}
                  />
                </Stack>
              </Grid>
            </Stack>
          </CardBody>
        </Card>
      ) : null}

      <Table
        headers={["File", "Area", "Band", "Direct importers", "Files reached"]}
        columnAlign={["left", "left", "left", "right", "right"]}
        rowTone={shown.map((f) => rowTone(f.band))}
        striped
        stickyHeader
        rows={shown.map((file) => [
          <Button key={file.path} variant="ghost" onClick={() => setSelected(selected === file.path ? "" : file.path)}>{file.path}</Button>,
          file.area,
          BAND_LABEL[file.band],
          String(file.direct),
          String(file.blast),
        ])}
        emptyMessage="No files match this filter."
      />
    </Stack>
  );
}

