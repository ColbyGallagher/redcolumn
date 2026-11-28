import type { EditorContext } from '@nb/markup';
import type { AppDocument } from '../review/facets';

/**
 * The context every document this app opens shares: who is making changes (Preferences › name)
 * and the app's hooks. Stores read it at each use, so a change made here applies to every open
 * document at once.
 */
export const editorContext: EditorContext<AppDocument> = { actor: { id: null, name: '' }, onAdded: null, onFileRestored: null };
