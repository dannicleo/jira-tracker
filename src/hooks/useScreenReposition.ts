/**
 * useScreenReposition — reposiciona a janela automaticamente ao trocar de monitor.
 *
 * Detecta mudanças em:
 *   - Resolução da tela (screen.width / screen.height)
 *   - Densidade de pixels (devicePixelRatio — diferente entre Retina e não-Retina)
 *
 * Quando qualquer uma dessas mudar, invoca o comando Tauri `reposition_window`
 * para que o Rust recalcule a posição/tamanho com base no novo monitor.
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useScreenReposition() {
  useEffect(() => {
    let lastW     = window.screen.width;
    let lastH     = window.screen.height;
    let lastDPR   = window.devicePixelRatio;

    function handleResize() {
      const w   = window.screen.width;
      const h   = window.screen.height;
      const dpr = window.devicePixelRatio;

      if (w !== lastW || h !== lastH || dpr !== lastDPR) {
        lastW   = w;
        lastH   = h;
        lastDPR = dpr;
        invoke("reposition_window").catch(() => {/* silencioso */});
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
}
