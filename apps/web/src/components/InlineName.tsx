import { useState } from 'react';

/** Inline name field for creating or renaming something; Enter or blur commits, Escape cancels. */
export function InlineName({ initial, placeholder, onDone }: { initial: string; placeholder?: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="group-name-input"
      autoFocus
      value={value}
      placeholder={placeholder ?? 'Name'}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue('');
          onDone(null);
        }
      }}
    />
  );
}
