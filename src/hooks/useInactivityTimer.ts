/**
 * useInactivityTimer — recolhe o painel após inatividade.
 *
 * "Inativo" = mouse saiu da janela e não voltou dentro de `timeoutMinutes`.
 *
 * Usa eventos DOM nativos: `mouseleave` no document inicia o timer;
 * `mouseenter` ou `mousemove` cancela. Funciona no Tauri WKWebView
 * enquanto `setIgnoreCursorEvents` não estiver ativo.
 *
 * Só roda quando `isActive = true` (painel aberto) e `timeoutMinutes > 0`.
 */
import { useEffect, useRef } from "react";

export function useInactivityTimer(
  /** Indica se há painel aberto — o timer só corre quando true */
  isActive: boolean,
  /** Minutos até recolher. 0 = desativado. */
  timeoutMinutes: number,
  /** Callback chamado quando o timeout dispara */
  onTimeout: () => void,
) {
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef   = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!isActive || timeoutMinutes <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const ms = timeoutMinutes * 60 * 1000;

    function startTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onTimeoutRef.current();
      }, ms);
    }

    function cancelTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    // mouseleave = mouse saiu da janela → inicia contagem
    // mouseenter / mousemove = mouse voltou → cancela
    document.addEventListener("mouseleave", startTimer);
    document.addEventListener("mouseenter", cancelTimer);
    document.addEventListener("mousemove",  cancelTimer);

    return () => {
      document.removeEventListener("mouseleave", startTimer);
      document.removeEventListener("mouseenter", cancelTimer);
      document.removeEventListener("mousemove",  cancelTimer);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive, timeoutMinutes]);
}
