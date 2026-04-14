/**
 * useMonitor — lógica central de monitoramento de coluna
 *
 * - Sincroniza com a Jira API de X em X minutos (ou manualmente)
 * - Mantém histórico de entry/exit por issue
 * - Detecta períodos de flag (impedimento) e os desconta do tempo efetivo
 * - Expõe dados prontos para o MonitorView renderizar em tempo real
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { BoardMonitorConfig, MonitoredIssue, ColumnEntry, FlagPeriod } from "../types";
import { fetchMonitorIssues } from "../services/jira";
import {
  getBoardMonitorConfig,
  saveBoardMonitorConfig,
  getMonitoredIssues,
  saveMonitoredIssues,
  clearBoardMonitorConfig,
} from "../services/db";
import type { AppSettings } from "../types";

export interface UseMonitorReturn {
  config: BoardMonitorConfig | null;
  issues: MonitoredIssue[];
  syncing: boolean;
  lastSyncAt: Date | null;
  error: string | null;
  syncNow: () => Promise<void>;
  configure: (config: BoardMonitorConfig) => Promise<void>;
  clearConfig: () => Promise<void>;
}

export function useMonitor(settings: AppSettings): UseMonitorReturn {
  const [config, setConfig] = useState<BoardMonitorConfig | null>(null);
  const [issues, setIssues] = useState<MonitoredIssue[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const issuesRef = useRef<MonitoredIssue[]>([]);

  // Mantém a ref atualizada para uso dentro de callbacks sem stale closure
  issuesRef.current = issues;

  // Carrega config e issues do localStorage ao montar
  useEffect(() => {
    (async () => {
      const [cfg, storedIssues] = await Promise.all([
        getBoardMonitorConfig(),
        getMonitoredIssues(),
      ]);
      if (cfg) setConfig(cfg);
      if (storedIssues.length > 0) setIssues(storedIssues);
    })();
  }, []);

  // ─── Lógica de merge (sync) ─────────────────────────────────────────────────

  const mergeIssues = useCallback(
    (fresh: MonitoredIssue[], existing: MonitoredIssue[]): MonitoredIssue[] => {
      const now = new Date().toISOString();
      const freshKeys = new Set(fresh.map((i) => i.issueKey));
      const result: MonitoredIssue[] = [];

      // Issues que ainda estão na coluna
      for (const freshIssue of fresh) {
        const prev = existing.find((e) => e.issueKey === freshIssue.issueKey);

        if (!prev) {
          // Issue nova: o fetchMonitorIssues já reconstruiu os flagPeriods
          // do changelog, então simplesmente usamos o que veio da API.
          result.push({ ...freshIssue });
          continue;
        }

        // Issue já conhecida — preserva o enteredAt original e o histórico de flags,
        // atualizando apenas o estado atual da flag (abrir/fechar período).
        let currentEntry: ColumnEntry = prev.currentEntry ?? {
          enteredAt: freshIssue.currentEntry?.enteredAt ?? now,
          flagPeriods: freshIssue.currentEntry?.flagPeriods ?? [],
        };

        // Atualiza flag periods com base no estado atual da flag
        currentEntry = updateFlagPeriods(currentEntry, freshIssue.isFlagged, now);

        result.push({
          ...freshIssue,
          currentEntry,
          history: prev.history,      // preserva histórico de entradas anteriores
          lastSyncedAt: now,
        });
      }

      // Issues que não estão mais na coluna
      for (const prev of existing) {
        if (freshKeys.has(prev.issueKey)) continue; // ainda ativa, já processada acima

        if (prev.currentEntry !== null) {
          // Acabou de sair neste sync — fecha a entrada e move para histórico
          const closed: ColumnEntry = {
            ...prev.currentEntry,
            exitedAt: now,
            flagPeriods: closeFlagPeriods(prev.currentEntry.flagPeriods, now),
          };
          result.push({
            ...prev,
            currentEntry: null,
            history: [closed, ...prev.history],
            lastSyncedAt: now,
          });
        } else {
          // Já havia saído em um sync anterior — preserva o registro histórico
          // BUG CORRIGIDO: sem este bloco, o histórico era perdido após 2 syncs
          result.push(prev);
        }
      }

      return result;
    },
    []
  );

  // ─── Sync principal ─────────────────────────────────────────────────────────

  const syncNow = useCallback(async () => {
    const cfg = config;
    if (!cfg || !settings.jira_api_token) return;

    setSyncing(true);
    setError(null);
    try {
      const fresh = await fetchMonitorIssues(cfg.boardId, cfg.columnStatusIds, settings);
      const merged = mergeIssues(fresh, issuesRef.current);

      // DB primeiro — garante consistência mesmo que o app feche logo depois
      await saveMonitoredIssues(merged);

      // Depois atualiza o estado visual
      setIssues(merged);
      setLastSyncAt(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }, [config, settings, mergeIssues]);

  // Auto-sync periódico
  useEffect(() => {
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);

    if (!config || !settings.jira_api_token) return;

    // Sync imediato ao configurar
    syncNow();

    const intervalMs = config.syncIntervalMinutes * 60 * 1000;
    syncTimerRef.current = setInterval(syncNow, intervalMs);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.boardId, config?.columnName, config?.syncIntervalMinutes]);

  // ─── Configurar / Limpar ────────────────────────────────────────────────────

  const configure = useCallback(async (cfg: BoardMonitorConfig) => {
    await saveBoardMonitorConfig(cfg);
    await saveMonitoredIssues([]); // limpa issues do config anterior
    setConfig(cfg);
    setIssues([]);
    setLastSyncAt(null);
    setError(null);
  }, []);

  const clearConfig = useCallback(async () => {
    await clearBoardMonitorConfig();
    setConfig(null);
    setIssues([]);
    setLastSyncAt(null);
    setError(null);
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
  }, []);

  return { config, issues, syncing, lastSyncAt, error, syncNow, configure, clearConfig };
}

// ─── Helpers de flag ──────────────────────────────────────────────────────────

function updateFlagPeriods(
  entry: ColumnEntry,
  isFlagged: boolean,
  now: string
): ColumnEntry {
  const periods = [...entry.flagPeriods];
  const openPeriod = periods.find((p) => !p.end);

  if (isFlagged && !openPeriod) {
    // Acabou de ser flagado
    periods.push({ start: now });
  } else if (!isFlagged && openPeriod) {
    // Flag foi removida
    const idx = periods.indexOf(openPeriod);
    periods[idx] = { ...openPeriod, end: now };
  }

  return { ...entry, flagPeriods: periods };
}

function closeFlagPeriods(periods: FlagPeriod[], now: string): FlagPeriod[] {
  return periods.map((p) => (p.end ? p : { ...p, end: now }));
}

// ─── Utilitário de tempo efetivo (exportado para uso no MonitorView) ──────────

/** Calcula o tempo efetivo em ms na coluna, descontando períodos de flag */
export function effectiveTimeMs(entry: ColumnEntry): number {
  const end = entry.exitedAt ? new Date(entry.exitedAt).getTime() : Date.now();
  const total = end - new Date(entry.enteredAt).getTime();

  const flaggedMs = entry.flagPeriods.reduce((sum, fp) => {
    const flagEnd = fp.end ? new Date(fp.end).getTime() : Date.now();
    return sum + Math.max(0, flagEnd - new Date(fp.start).getTime());
  }, 0);

  return Math.max(0, total - flaggedMs);
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}
