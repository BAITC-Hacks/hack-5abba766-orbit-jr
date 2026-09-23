"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function CatalogSelect({ value, onChange, options, label = "Тип активности", disabled = false }: {
  label?: string;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex(([key]) => key === value));
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function choose(index: number) {
    if (!options[index] || disabled) return;
    onChange(options[index][0]);
    setOpen(false);
    trigger.current?.focus();
  }
  return <div className="catalog-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span id={`${id}-label`} className="catalog-select-label">{label}</span>
    <button ref={trigger} type="button" disabled={disabled || !options.length} role="combobox" aria-labelledby={`${id}-label`}
      aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox"
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => { setActive(selected); setOpen(!open); }}
      onKeyDown={event => {
        if (!options.length) return;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !open ? selected : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === "Enter" || event.key === " ") && open) {
          event.preventDefault(); choose(active);
        } else if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }
        else if (event.key.length === 1 && event.key !== " ") {
          const match = options.findIndex(([, label]) => label.toLocaleLowerCase("ru").startsWith(event.key.toLocaleLowerCase("ru")));
          if (match >= 0) { event.preventDefault(); setOpen(true); setActive(match); }
        }
      }}>
      <span id={`${id}-value`}>{options[selected]?.[1] ?? "Нет доступных вариантов"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
      {options.map(([key, label], index) => <li key={key} id={`${id}-${index}`} role="option" aria-selected={value === key}
        className={active === index ? "active" : ""} onPointerMove={() => setActive(index)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {label}{value === key && <Check size={16} aria-hidden="true" />}
      </li>)}
    </ul>}
  </div>;
}
