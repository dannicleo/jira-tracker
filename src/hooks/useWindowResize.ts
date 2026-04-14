/**
 * useWindowResize — redimensiona a janela e detecta o lado do painel.
 *
 * Quando painel FECHADO  → janela = 72px (só sidebar), posição X corrigida.
 * Quando painel ABERTO   → janela = 800px no lado com mais espaço disponível.
 *
 * Retorna "left" | "right" indicando de qual lado o painel foi aberto.
 *
 * Regras importantes:
 * - Não dispara no mount quando painel já está fechado (evita mover a barra
 *   que o Rust posicionou ou que o usuário arrastou).
 * - Preserva sempre o Y e a altura atuais (respeita a posição manual do usuário).
 * - Só altera X e Width.
 */
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const SIDEBAR_W = 72;
const FULL_W    = 800;
const PANEL_W   = FULL_W - SIDEBAR_W; // 728

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function resizeWindow(
  panelOpen: boolean,
  lastSide: "left" | "right",
): Promise<"left" | "right"> {
  if (!isTauri()) return "left";

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const [pos, size, scale] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);

    // Coordenadas lógicas atuais (preserva Y e Height — não faz reposicionamento vertical)
    const winX = pos.x    / scale;
    const winY = pos.y    / scale;
    const winH = size.height / scale;

    if (!panelOpen) {
      // Fecha: encolhe para 72px mantendo X da sidebar.
      // Quando o painel estava à ESQUERDA, a sidebar fica na borda direita
      // da janela de 800px → sidebarX = winX + PANEL_W.
      // Quando estava à DIREITA, a sidebar fica na borda esquerda → sidebarX = winX.
      const sidebarX = lastSide === "left" ? winX + PANEL_W : winX;

      await invoke("set_window_bounds", {
        x: sidebarX, y: winY,
        width: SIDEBAR_W, height: winH,
      });
      return lastSide;
    }

    // Abre: winX é o X atual da sidebar (janela era 72px = só sidebar).
    const sidebarX   = winX;
    const screenW    = window.screen.width;
    const spaceLeft  = sidebarX;
    const spaceRight = screenW - sidebarX - SIDEBAR_W;

    let side: "left" | "right";
    let targetX: number;

    if (spaceLeft >= spaceRight) {
      side    = "left";
      targetX = Math.max(0, sidebarX - PANEL_W);
    } else {
      side    = "right";
      targetX = sidebarX;
    }

    await invoke("set_window_bounds", {
      x: targetX, y: winY,
      width: FULL_W, height: winH,
    });

    return side;
  } catch {
    return lastSide;
  }
}

export function useWindowResize(panelOpen: boolean): "left" | "right" {
  const [panelSide, setPanelSide] = useState<"left" | "right">("left");
  const sideRef    = useRef<"left" | "right">("left");
  // null = mount ainda não processado
  const prevOpenRef = useRef<boolean | null>(null);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = panelOpen;

    // No mount com painel fechado: a janela já está no tamanho certo (Rust
    // a posicionou no startup). Não fazer nada evita mover a barra.
    if (wasOpen === null && !panelOpen) return;

    let cancelled = false;
    resizeWindow(panelOpen, sideRef.current).then((side) => {
      if (!cancelled) {
        sideRef.current = side;
        setPanelSide(side);
      }
    });
    return () => { cancelled = true; };
  }, [panelOpen]);

  return panelSide;
}

export function invalidateMonitorCache() { /* no-op */ }
