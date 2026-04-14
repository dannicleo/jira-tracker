/**
 * useMousePassthrough — click-through para áreas transparentes da janela.
 *
 * Problema com a abordagem JS pura:
 *   Quando `setIgnoreCursorEvents(true)` é ativado, o macOS PARA de entregar
 *   qualquer evento de mouse ao WebView. O listener `mousemove` deixa de
 *   disparar, então o JS nunca detecta o cursor voltando à sidebar.
 *   Resultado: a janela fica presa em passthrough e a sidebar não responde.
 *
 * Solução híbrida JS + Rust:
 *   1. JS `mousemove`: detecta quando o cursor SAIR da sidebar
 *      → ativa `setIgnoreCursorEvents(true)` + chama `start_cursor_watch`
 *   2. Rust `start_cursor_watch`: loop Tokio de 50 ms que usa CoreGraphics
 *      para ler a posição global do cursor (independente do JS), emite
 *      `"cursor-in-sidebar"` quando o cursor VOLTA para a zona da sidebar.
 *   3. JS ouve `"cursor-in-sidebar"` → desativa passthrough + para watch.
 *
 * Inicialização:
 *   No mount, o painel está fechado → ativa passthrough imediatamente
 *   (sem esperar mousemove) para nunca bloquear outros apps desde o início.
 */
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Pixels lógicos da direita da janela que correspondem à sidebar
const SIDEBAR_ZONE = 90;

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

// Cache do objeto Window Tauri para evitar import dinâmico a cada evento
type TauriWindow = { setIgnoreCursorEvents: (ignore: boolean) => Promise<void> };
let winCache: TauriWindow | null = null;

async function getTauriWindow(): Promise<TauriWindow> {
  if (!winCache) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    winCache = getCurrentWindow() as TauriWindow;
  }
  return winCache;
}

export function useMousePassthrough(panelOpen: boolean) {
  const panelOpenRef   = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  // Rastreia o último estado para evitar chamadas IPC redundantes
  // null = ainda não inicializado
  const lastIgnoreRef = useRef<boolean | null>(null);

  // ── Reage a mudanças no estado do painel ──────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    if (panelOpen) {
      // Painel aberto: desativa passthrough e para o cursor watch
      invoke("stop_cursor_watch").catch(() => {});
      getTauriWindow()
        .then((win) => win.setIgnoreCursorEvents(false))
        .catch(() => {});
      lastIgnoreRef.current = false;
    } else {
      // Painel fechado: ativa passthrough imediatamente
      // (não espera mousemove — evita bloquear outros apps)
      getTauriWindow()
        .then((win) => win.setIgnoreCursorEvents(true))
        .catch(() => {});
      invoke("start_cursor_watch").catch(() => {});
      lastIgnoreRef.current = true;
    }
  }, [panelOpen]);

  // ── Listeners permanentes (registrados uma única vez) ─────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    // Evento Rust: cursor voltou para a sidebar durante passthrough
    // O cursor watch já se encerrou (break interno); apenas desativamos o passthrough.
    let unlistenSidebar: (() => void) | null = null;
    listen("cursor-in-sidebar", () => {
      getTauriWindow()
        .then((win) => win.setIgnoreCursorEvents(false))
        .catch(() => {});
      // Reseta para que o próximo mousemove detecte a saída da sidebar
      lastIgnoreRef.current = false;
    }).then((fn) => {
      unlistenSidebar = fn;
    });

    // mousemove: detecta cursor saindo da sidebar enquanto painel fechado
    // (só dispara quando `setIgnoreCursorEvents(false)` está ativo)
    const handleMouseMove = async (e: MouseEvent) => {
      if (panelOpenRef.current) return; // painel aberto → ignora

      const isOverSidebar = e.clientX >= window.innerWidth - SIDEBAR_ZONE;
      const shouldIgnore  = !isOverSidebar;

      if (shouldIgnore === lastIgnoreRef.current) return; // sem mudança
      lastIgnoreRef.current = shouldIgnore;

      try {
        const win = await getTauriWindow();
        await win.setIgnoreCursorEvents(shouldIgnore);
        if (shouldIgnore) {
          // Cursor saiu da sidebar → inicia watch Rust para detectar retorno
          invoke("start_cursor_watch").catch(() => {});
        }
        // Se !shouldIgnore: cursor voltou à sidebar via JS (já desativou passthrough acima)
        // O cursor watch já se encerrou automaticamente ao emitir cursor-in-sidebar.
      } catch {
        /* silencioso — não bloqueia UX */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      unlistenSidebar?.();
      // Ao desmontar: garante captura de eventos e encerra cursor watch
      invoke("stop_cursor_watch").catch(() => {});
      getTauriWindow()
        .then((win) => win.setIgnoreCursorEvents(false))
        .catch(() => {});
    };
  }, []); // registra uma única vez
}
