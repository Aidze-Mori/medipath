import { Children, isValidElement, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './Select.css';

type Option = { value: string; label: string; disabled?: boolean };
type Props = { value: string; onChange: (value: string) => void; options: Option[]; 'aria-label'?: string; id?: string; disabled?: boolean; className?: string };
export function Select({ value, onChange, options, 'aria-label': label, id, disabled, className = '' }: Props) {
  const uid = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useRef({ text: '', at: 0 });
  const selected = options.findIndex(option => option.value === value);
  function close() { menu.current?.hidePopover(); setOpen(false); }
  function show(index = Math.max(0, selected)) {
    if (!button.current || !menu.current || disabled) return;
    const rect = button.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const height = Math.min(280, Math.max(below, rect.top - 12));
    Object.assign(menu.current.style, { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`, width: `${Math.min(rect.width, window.innerWidth - 16)}px`, maxHeight: `${height}px`, top: below >= Math.min(220, options.length * 44) ? `${rect.bottom + 6}px` : 'auto', bottom: below >= Math.min(220, options.length * 44) ? 'auto' : `${window.innerHeight - rect.top + 6}px` });
    setActive(index); menu.current.showPopover(); setOpen(true);
    requestAnimationFrame(() => menu.current?.querySelector(`#${CSS.escape(`${uid}-${index}`)}`)?.scrollIntoView({ block: 'nearest' }));
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value); close(); button.current?.focus();
  }
  return <span className={`select-control ${className}`}>
    <button type="button" id={id} ref={button} role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${uid}-list`} aria-haspopup="listbox" aria-activedescendant={open ? `${uid}-${active}` : undefined} disabled={disabled} className="select-trigger" onClick={() => open ? close() : show()} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') { close(); return; }
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (open) choose(active); else show(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const direction = event.key === 'ArrowUp' ? -1 : 1;
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : open ? (active + direction + options.length) % options.length : Math.max(0, selected);
        for (let i = 0; i < options.length && options[next]?.disabled; i++) next = (next + direction + options.length) % options.length;
        show(next); return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        search.current = { text: (Date.now() - search.current.at < 650 ? search.current.text : '') + event.key.toLocaleLowerCase('ru'), at: Date.now() };
        const next = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase('ru').startsWith(search.current.text));
        if (next >= 0) show(next);
      }
    }}><span>{options[selected]?.label ?? 'Выберите вариант'}</span><ChevronDown size={17} aria-hidden="true" /></button>
    <div ref={menu} id={`${uid}-list`} role="listbox" aria-label="Варианты выбора" popover="auto" className="select-menu" onToggle={event => setOpen(event.newState === 'open')}>
      {options.map((option, index) => <div role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} id={`${uid}-${index}`} data-value={option.value} className={`select-option${index === active ? ' is-active' : ''}`} key={option.value} onPointerMove={() => setActive(index)} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(index); }}><span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true" />}</div>)}
    </div>
  </span>;
}

// Adapter keeps existing form handlers while all menus share the same accessible control.
export function StyledSelect({ children, onChange, value, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options: Option[] = [];
  function collect(nodes: ReactNode) {
    Children.forEach(nodes, child => {
      if (!isValidElement<{ children?: ReactNode; value?: string; disabled?: boolean }>(child)) return;
      if (child.type === 'option') {
        const label = Children.toArray(child.props.children).join('');
        options.push({ value: child.props.value ?? label, label, disabled: child.props.disabled });
      } else collect(child.props.children);
    });
  }
  collect(children);
  return <Select value={String(value ?? '')} options={options} disabled={props.disabled} className={props.className} id={props.id} aria-label={props['aria-label']} onChange={next => onChange?.({ target: { value: next }, currentTarget: { value: next } } as ChangeEvent<HTMLSelectElement>)} />;
}
