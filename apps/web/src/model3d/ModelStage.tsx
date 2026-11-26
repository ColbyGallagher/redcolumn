import { useEffect, useRef } from 'react';
import type { ModelView } from '../documents/openTabs';

/**
 * Shows a model's 3D view over the pane's stage while its tab is in front. The view keeps its own
 * element (and WebGL context) between tab switches, so coming back to a model is instant; it only
 * stops drawing while it is not shown.
 */
export function ModelStage({ view }: { view: ModelView }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.appendChild(view.element);
    view.setVisible(true);
    return () => {
      view.setVisible(false);
      if (view.element.parentNode === host) host.removeChild(view.element);
    };
  }, [view]);
  return <div className="model-stage" ref={ref} />;
}
