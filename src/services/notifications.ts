/**
 * Serviço de notificações do sistema (macOS) via Tauri plugin-notification.
 *
 * Fluxo:
 *   1. Solicita permissão uma vez (macOS exige consentimento explícito)
 *   2. Envia notificação nativa para cada alerta do AlertEngine
 *   3. Agrupa em notificação única quando há muitas notificações simultâneas
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { StatusChange, AppAlert } from "../types";

// Máximo de notificações individuais antes de agrupar
const MAX_INDIVIDUAL = 3;

/**
 * Garante que a permissão de notificação está concedida.
 * Solicita ao sistema operacional se ainda não foi concedida.
 * Retorna true se pode enviar notificações.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Envia notificações do sistema para as mudanças de status detectadas.
 *
 * Estratégia:
 *   1 mudança  → notificação individual com summary da issue
 *   2-3 mudanças → uma notificação por mudança
 *   4+ mudanças  → notificação agrupada com resumo
 *
 * @param changes  Lista de mudanças de status detectadas no sync
 * @param boardName  Nome do board (usado no título ao agrupar)
 */
export async function notifyStatusChanges(
  changes: StatusChange[],
  boardName: string
): Promise<void> {
  if (changes.length === 0) return;

  const canNotify = await ensureNotificationPermission();
  if (!canNotify) return;

  if (changes.length <= MAX_INDIVIDUAL) {
    for (const change of changes) {
      const assignee = change.assigneeName ? ` · ${change.assigneeName}` : "";
      sendNotification({
        title: `${change.issueKey} → ${change.toStatus}${assignee}`,
        body: change.summary,
        sound: "default",
      });
    }
  } else {
    const preview = changes
      .slice(0, 3)
      .map((c) => `${c.issueKey} → ${c.toStatus}`)
      .join("\n");
    const remainder = changes.length - 3;
    sendNotification({
      title: `${boardName} — ${changes.length} issues atualizadas`,
      body: preview + (remainder > 0 ? `\n+ ${remainder} mais` : ""),
      sound: "default",
    });
  }
}

// ─── Ícones de alerta por tipo ────────────────────────────────────────────────

const ALERT_ICONS: Record<AppAlert["kind"], string> = {
  time_breach:   "⏰",
  time_warning:  "⚠️",
  flagged:       "🚩",
  column_change: "↔️",
};

/**
 * Envia notificações nativas do OS para alertas do AlertEngine.
 *
 * Estratégia:
 *   1 alerta  → notificação individual
 *   2-3       → uma por alerta
 *   4+        → agrupada com resumo
 */
export async function notifyAlerts(alerts: AppAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  const canNotify = await ensureNotificationPermission();
  if (!canNotify) return;

  if (alerts.length <= MAX_INDIVIDUAL) {
    for (const alert of alerts) {
      const icon   = ALERT_ICONS[alert.kind] ?? "🔔";
      const column = alert.columnName ? ` · ${alert.columnName}` : "";
      sendNotification({
        title: `${icon} ${alert.issueKey}${column}`,
        body: alert.message,
        sound: "default",
      });
    }
  } else {
    // Prioriza time_breach > time_warning > flagged > column_change no preview
    const sorted = [...alerts].sort((a, b) => {
      const order: Record<AppAlert["kind"], number> = {
        time_breach: 0, time_warning: 1, flagged: 2, column_change: 3,
      };
      return order[a.kind] - order[b.kind];
    });

    const preview = sorted
      .slice(0, 3)
      .map((a) => `${ALERT_ICONS[a.kind]} ${a.issueKey}`)
      .join("\n");
    const remainder = alerts.length - 3;

    sendNotification({
      title: `${alerts[0].boardName} — ${alerts.length} alertas`,
      body: preview + (remainder > 0 ? `\n+ ${remainder} mais` : ""),
      sound: "default",
    });
  }
}
