"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    let saved: Theme = "dark";
    try {
      const value = localStorage.getItem("career-quest-theme");
      if (value === "light" || value === "dark") saved = value;
      else if (value === "system") saved = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch { /* The theme still works when browser storage is unavailable. */ }
    setTheme(saved);
  }, []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("career-quest-theme", theme); } catch { /* Session-only preference. */ }
  }, [theme]);
  return <div className="theme-control" role="group" aria-label="Оформление сайта">
    {([{ value: "light", label: "Светлая тема", Icon: Sun }, { value: "dark", label: "Тёмная тема", Icon: Moon }] as const).map(({value, label, Icon}) =>
      <button key={value} type="button" title={label} aria-label={label} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={17} aria-hidden="true" /></button>
    )}
  </div>;
}
