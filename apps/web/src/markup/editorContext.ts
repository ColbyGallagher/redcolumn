import type { EditorContext, MarkupStore } from '@nb/markup';

/**
 * The context every document this app opens shares: who is making changes (Preferences › name)
 * and the app's hooks. Stores read it at each use, so a change made here applies to every open
 * document at once.
 */
export const editorContext: EditorContext<MarkupStore> = { actor: { id: null, name: '' }, onAdded: null, onFileRestored: null };
