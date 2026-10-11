/**
 * Open and Save As go through native dialogs. The File System Access pickers exist in Electron 37
 * (the spike saw showOpenFilePicker, showSaveFilePicker and showDirectoryPicker, and
 * navigator.storage.persist() resolved true), but a picker file has no path. Open file location
 * needs one main already recorded.
 *
 * Print mode is from the same spike. A hidden PDF window's print-to-PDF was 812 bytes and did not
 * contain the page text. An HTML page printed to 15 KB, so the desktop app draws pages to images
 * and prints that. `verb` remains the fallback when drawing fails.
 */
export const NATIVE_OPEN_SAVE = true;

export type PrintMode = 'viewer' | 'verb' | 'images';

export const PRINT_MODE: PrintMode = 'images';
