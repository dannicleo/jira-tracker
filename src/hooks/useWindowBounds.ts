/**
 * useWindowBounds — impede que a barra saia dos limites do monitor atual.
 *
 * Ouve o evento `onMoved` (disparado a cada pixel durante o drag).
 * Usa debounce de 200 ms para só agir depois que o usuário soltou o mouse,
 * evitando jitter durante o arraste.
 *
 * Após o debounce, verifica se alguma parte da janela ultrapassou as bordas
 * do monitor corrente e, se sim, chama `set_window_bounds` para reposicioná-la
 * dentro dos limites (mantendo tamanho intacto).
 *
 * Permite mover para outro monitor normalmente — o clamp usa `currentMonitor()`
 * que já reflete o monitor onde a janela está após a mudança.
 */
import { useEffect }                           from "react";
import { invoke }                              from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor }    from "@tauri-apps/api/window";

const MENU_BAR_H = 28; // reserva para a barra de menu do macOS

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function clampToMonitor() {
  try {
    const win = getCurrentWindow();

    const [monitor, winPos, winSize, scale] = await Promise.all([
      currentMonitor(),
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);

    if (!monitor) return;

    // Converte tudo para coordenadas lógicas
    const monX = monitor.position.x    / monitor.scaleFactor;
    const monY = monitor.position.y    / monitor.scaleFactor;
    const monW = monitor.size.width    / monitor.scaleFactor;
    const monH = monitor.size.height   / monitor.scaleFactor;

    const winX = winPos.x         / scale;
    const winY = winPos.y         / scale;
    const winW = winSize.width    / scale;
    const winH = winSize.height   / scale;

    // Clamp: a janela deve caber inteiramente no monitor (abaixo da menu bar)
    const clampedX = Math.max(monX,               Math.min(winX, monX + monW - winW));
    const clampedY = Math.max(monY + MENU_BAR_H,  Math.min(winY, monY + monH - winH));

    // Só move se houver diferença de mais de 1 px (evita loop por arredondamento)
    if (Math.abs(clampedX - winX) > 1 || Math.abs(clampedY - winY) > 1) {
      await invoke("set_window_bounds", {
        x: clampedX, y: clampedY,
        width: winW,  height: winH,
      });
    }
  } catch {
    // silencioso — não bloqueia UX
  }
}

export function useWindowBounds() {
  useEffect(() => {
    if (!isTauri()) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onMoved(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(clampToMonitor, 200);
      })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten?.();
    };
  }, []);
}
