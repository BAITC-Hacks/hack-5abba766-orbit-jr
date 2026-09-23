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
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex(([key]) => key === value));
  const expanded = open && !disabled && options.length > 0;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeIndex, id]);
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
      aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-haspopup="listbox"
      aria-activedescendant={expanded ? `${id}-${activeIndex}` : undefined}
      onClick={() => { search.current = { text: "", time: 0 }; setActive(selected); setOpen(!expanded); }}
      onKeyDown={event => {
        if (!options.length || disabled || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent?.isComposing) return;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          search.current = { text: "", time: 0 };
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !expanded ? selected : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === "Enter" || event.key === " ") && expanded) {
          event.preventDefault(); choose(activeIndex);
        } else if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }
        else if (event.key.length === 1 && event.key !== " ") {
          const now = Date.now();
          const character = event.key.toLocaleLowerCase("ru");
          const text = now - search.current.time < 700 ? search.current.text + character : character;
          search.current = { text, time: now };
          const repeated = [...text].every(letter => letter === character);
          const query = repeated ? character : text;
          const start = expanded ? activeIndex : selected;
          let match = -1;
          for (let step = 0; step < options.length; step++) {
            const index = (start + (repeated ? 1 : 0) + step) % options.length;
            if (options[index][1].toLocaleLowerCase("ru").startsWith(query)) { match = index; break; }
          }
          if (match >= 0) { event.preventDefault(); setOpen(true); setActive(match); }
        }
      }}>
      <span id={`${id}-value`}>{options[selected]?.[1] ?? "Нет доступных вариантов"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {expanded && <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
      {options.map(([key, label], index) => <li key={key} id={`${id}-${index}`} role="option" aria-selected={value === key}
        className={activeIndex === index ? "active" : ""} onPointerMove={() => setActive(index)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {label}{value === key && <Check size={16} aria-hidden="true" />}
      </li>)}
    </ul>}
  </div>;
}
