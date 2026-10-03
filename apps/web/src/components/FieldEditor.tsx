import { useEffect, useRef, useState } from 'react';
import type { FieldWidget, FormField } from '../documents/forms';
import type { TileViewer } from '../viewer/TileViewer';

interface Props {
  field: FormField;
  widget: FieldWidget;
  viewer: TileViewer;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Fills in a text or choice field in place, over its widget on the page. Enter (or leaving the
 * field) keeps the value; Escape cancels. Tab keeps it too and moves on (handled by the caller).
 */
export function FieldEditor({ field, widget, viewer, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(field.value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current && 'select' in ref.current && field.type === 'text') ref.current.select();
  }, [field.type]);

  const r = widget.rect;
  const a = viewer.pageToClient([r.x, r.y], widget.pageIndex);
  const b = viewer.pageToClient([r.x + r.w, r.y + r.h], widget.pageIndex);
  const style = {
    left: Math.min(a[0], b[0]),
    top: Math.min(a[1], b[1]),
    width: Math.max(60, Math.abs(b[0] - a[0])),
    height: Math.max(20, Math.abs(b[1] - a[1])),
    fontSize: Math.max(12, Math.min(28, Math.abs(b[1] - a[1]) * (field.multiline || field.type === 'list' ? 0.25 : 0.6))),
  };
  const finish = (v: string, keep = true) => {
    if (done.current) return;
    done.current = true;
    if (keep && v !== field.value) onCommit(v);
    else onCancel();
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') finish(field.value, false);
    else if (e.key === 'Enter' && !(field.multiline && !e.ctrlKey)) {
      e.preventDefault();
      finish(value);
    }
  };

  if (field.type === 'dropdown' || field.type === 'list') {
    const multiple = field.type === 'list';
    return (
      <select
        ref={ref}
        className="field-editor"
        style={style}
        multiple={multiple}
        size={multiple ? Math.max(2, Math.min(field.options.length, 8)) : undefined}
        value={multiple ? value.split('\n').filter(Boolean) : value}
        onChange={(e) => {
          const v = multiple ? [...e.target.selectedOptions].map((o) => o.value).join('\n') : e.target.value;
          setValue(v);
          // A drop-down is done once something is picked.
          if (!multiple) finish(v);
        }}
        onBlur={() => finish(value)}
        onKeyDown={keys}
      >
        {!multiple && <option value="">—</option>}
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const common = {
    className: 'field-editor',
    style,
    value,
    maxLength: field.maxLength ?? undefined,
    placeholder: field.tooltip || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onBlur: () => finish(value),
    onKeyDown: keys,
  };
  return field.multiline ? <textarea ref={ref} {...common} /> : <input ref={ref} {...common} />;
}
