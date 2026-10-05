import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
export function Explanation({
  children,
  label = 'Почему этот шаг?',
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="explanation"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        className="explanation-toggle"
        type="button"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <CircleHelp size={18} />
        {label}
      </button>
      <div className={`explanation-body ${open ? 'is-open' : ''}`}>{children}</div>
    </div>
  );
}
