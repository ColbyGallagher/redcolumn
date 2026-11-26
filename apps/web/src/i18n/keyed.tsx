import { Fragment, type ReactNode } from 'react';

/**
 * Rich translated text for JSX: `keyed(msgParts('Press {key} to stop', { key: <kbd>Esc</kbd> }))`.
 * Gives each part a key so React can render the list.
 */
export function keyed(parts: unknown[]): ReactNode {
  return parts.map((p, i) => <Fragment key={i}>{p as ReactNode}</Fragment>);
}
