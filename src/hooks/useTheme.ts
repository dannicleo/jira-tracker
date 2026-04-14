/**
 * useTheme — aplica a classe `dark` no <html> baseado na preferência do usuário.
 *
 * - "light"  → remove `dark`
 * - "dark"   → adiciona `dark`
 * - "system" → segue prefers-color-scheme do SO, atualiza automaticamente
 */
import { useEffect } from "react";
import type { AppSettings } from "../types";

export function applyDark(root: HTMLElement, isDark: boolean) {
  if (isDark) {
    root.classList.add("dark");
    // Backgrounds de painel e controles
    root.style.setProperty("--panel-bg",              "#111827");       // gray-900
    root.style.setProperty("--ctrl-inactive-bg",      "#1f2937");       // gray-800
    root.style.setProperty("--ctrl-inactive-border",  "#374151");       // gray-700
    root.style.setProperty("--ctrl-inactive-text",    "#9ca3af");       // gray-400
    root.style.setProperty("--ctrl-inactive-hover",   "#374151");       // gray-700
    root.style.setProperty("--ctrl-selected-bg",      "#1e3a5f");       // blue-900 ~
    root.style.setProperty("--ctrl-selected-border",  "#1d4ed8");       // blue-700
    root.style.setProperty("--ctrl-selected-text",    "#93c5fd");       // blue-300
    // Cards e elementos secundários
    root.style.setProperty("--card-bg",               "#1f2937");       // gray-800
    root.style.setProperty("--card-border",           "rgba(75,85,99,0.6)");  // gray-600/60
    root.style.setProperty("--card-flagged-bg",       "rgba(127,29,29,0.10)"); // red-900/10
    root.style.setProperty("--card-flagged-border",   "rgba(153,27,27,0.40)"); // red-800/40
    root.style.setProperty("--bg-secondary",          "#1f2937");       // gray-800
    root.style.setProperty("--border-subtle",         "rgba(75,85,99,0.6)");
    root.style.setProperty("--text-primary",          "#e5e7eb");       // gray-200
    root.style.setProperty("--text-secondary",        "#6b7280");       // gray-500
    root.style.setProperty("--text-muted",            "rgba(75,85,99,1)"); // gray-600
    // Sidebar
    root.style.setProperty("--sidebar-bg",
      "rgba(16, 16, 20, 0.91)");
    root.style.setProperty("--sidebar-icon",          "rgba(255,255,255,0.45)");
    root.style.setProperty("--sidebar-icon-hover",    "rgba(255,255,255,1)");
    root.style.setProperty("--sidebar-active-bg",     "rgba(255,255,255,0.18)");
    root.style.setProperty("--sidebar-hover-bg",      "rgba(255,255,255,0.10)");
    root.style.setProperty("--sidebar-sep",           "rgba(255,255,255,0.10)");
  } else {
    root.classList.remove("dark");
    root.style.setProperty("--panel-bg",              "#ffffff");
    root.style.setProperty("--ctrl-inactive-bg",      "#f3f4f6");       // gray-100
    root.style.setProperty("--ctrl-inactive-border",  "#e5e7eb");       // gray-200
    root.style.setProperty("--ctrl-inactive-text",    "#6b7280");       // gray-500
    root.style.setProperty("--ctrl-inactive-hover",   "#e5e7eb");       // gray-200
    root.style.setProperty("--ctrl-selected-bg",      "#eff6ff");       // blue-50
    root.style.setProperty("--ctrl-selected-border",  "#93c5fd");       // blue-300
    root.style.setProperty("--ctrl-selected-text",    "#2563eb");       // blue-600
    // Cards e elementos secundários
    root.style.setProperty("--card-bg",               "#ffffff");
    root.style.setProperty("--card-border",           "#f3f4f6");       // gray-100
    root.style.setProperty("--card-flagged-bg",       "rgba(254,242,242,0.30)"); // red-50/30
    root.style.setProperty("--card-flagged-border",   "#fecaca");       // red-200
    root.style.setProperty("--bg-secondary",          "#f9fafb");       // gray-50
    root.style.setProperty("--border-subtle",         "#f3f4f6");       // gray-100
    root.style.setProperty("--text-primary",          "#374151");       // gray-700
    root.style.setProperty("--text-secondary",        "#9ca3af");       // gray-400
    root.style.setProperty("--text-muted",            "#d1d5db");       // gray-300
    // Sidebar — tom acinzentado médio, ícones brancos ainda visíveis
    root.style.setProperty("--sidebar-bg",
      "rgba(75, 80, 95, 0.88)");
    root.style.setProperty("--sidebar-icon",          "rgba(255,255,255,0.60)");
    root.style.setProperty("--sidebar-icon-hover",    "rgba(255,255,255,1)");
    root.style.setProperty("--sidebar-active-bg",     "rgba(255,255,255,0.22)");
    root.style.setProperty("--sidebar-hover-bg",      "rgba(255,255,255,0.14)");
    root.style.setProperty("--sidebar-sep",           "rgba(255,255,255,0.18)");
  }
}

export function useTheme(theme: AppSettings["theme"]) {
  useEffect(() => {
    const root = document.documentElement;

    if (theme === "dark") {
      applyDark(root, true);
      return;
    }

    if (theme === "light") {
      applyDark(root, false);
      return;
    }

    // "system" — escuta a mídia query do SO
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply(e: MediaQueryListEvent | MediaQueryList) {
      applyDark(root, e.matches);
    }

    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
