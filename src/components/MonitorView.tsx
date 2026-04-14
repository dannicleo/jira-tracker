/**
 * MonitorView — exibe em tempo real as issues na coluna monitorada
 * com duas barras de progresso por issue:
 *   1. Tempo efetivo na coluna / limite de 8h (configurável)
 *   2. Tempo efetivo na coluna / estimativa de desenvolvimento
 */
import { useState, useEffect } from "react";
import {
  RefreshCw,
  Settings,
  Loader2,
  Flag,
  Clock,
  AlertTriangle,
  Columns,
} from "lucide-react";
import type { MonitoredIssue, BoardMonitorConfig } from "../types";
import { effectiveTimeMs, formatElapsed } from "../hooks/useMonitor";

interface Props {
  config: BoardMonitorConfig;
  issues: MonitoredIssue[];
  syncing: boolean;
  lastSyncAt: Date | null;
  error: string | null;
  onSync: () => void;
  onSetup: () => void;   // volta para MonitorSetup para reconfigurar
}

const MAX_HOURS_DEFAULT = 8;
const MS_PER_HOUR = 3_600_000;

export function MonitorView({
  config,
  issues,
  syncing,
  lastSyncAt,
  error,
  onSync,
  onSetup,
}: Props) {
  // Tick a cada segundo para atualizar os tempos em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Separa issues ativas (ainda na coluna) das que já saíram
  const activeIssues = issues.filter((i) => i.currentEntry !== null);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 drag-region">
        <div className="flex items-center gap-2 no-drag min-w-0">
          <Columns size={14} className="text-blue-500 shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-gray-700 truncate block">
              {config.columnName}
            </span>
            <span className="text-xs text-gray-400 truncate block">
              {config.boardName}
              {config.sprintName ? ` · ${config.sprintName}` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 no-drag shrink-0">
          <button
            onClick={onSync}
            disabled={syncing}
            title="Sincronizar agora"
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onSetup}
            title="Reconfigurar monitor"
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-100 rounded-lg flex gap-2">
          <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
          <span className="text-xs text-red-700">{error}</span>
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {syncing && activeIssues.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 size={16} className="text-blue-500 animate-spin" />
            <span className="text-xs text-gray-400">Sincronizando...</span>
          </div>
        ) : activeIssues.length === 0 ? (
          <EmptyColumn columnName={config.columnName} />
        ) : (
          <div className="p-2 space-y-2">
            {activeIssues.map((issue) => (
              <IssueMonitorCard
                key={issue.issueKey}
                issue={issue}
                maxHours={config.maxColumnHours ?? MAX_HOURS_DEFAULT}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: última sincronização */}
      <div className="px-3 py-1.5 border-t border-gray-100 flex items-center gap-1.5">
        <Clock size={11} className="text-gray-300" />
        <span className="text-xs text-gray-400">
          {syncing
            ? "Sincronizando..."
            : lastSyncAt
              ? `Atualizado ${formatRelative(lastSyncAt)} · próximo em ${nextSyncLabel(config)}`
              : "Aguardando primeira sync..."}
        </span>
      </div>
    </div>
  );
}

// ─── IssueMonitorCard ─────────────────────────────────────────────────────────

function IssueMonitorCard({
  issue,
  maxHours,
}: {
  issue: MonitoredIssue;
  maxHours: number;
}) {
  const entry = issue.currentEntry!;
  const elapsedMs = effectiveTimeMs(entry);
  const elapsedHours = elapsedMs / MS_PER_HOUR;

  const maxMs = maxHours * MS_PER_HOUR;
  const limitPct = Math.min((elapsedMs / maxMs) * 100, 100);
  const limitOver = elapsedMs > maxMs;

  const estimatePct =
    issue.estimateSeconds && issue.estimateSeconds > 0
      ? Math.min((elapsedMs / (issue.estimateSeconds * 1000)) * 100, 100)
      : null;
  const estimateOver =
    issue.estimateSeconds !== null &&
    elapsedMs > (issue.estimateSeconds ?? 0) * 1000;

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        limitOver
          ? "border-red-200 bg-red-50"
          : issue.isFlagged
            ? "border-amber-200 bg-amber-50"
            : "border-gray-100 bg-white"
      }`}
    >
      {/* Topo: chave + assignee + flag */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-mono font-medium text-gray-500">
              {issue.issueKey}
            </span>
            {issue.isFlagged && (
              <span className="flex items-center gap-0.5 text-xs text-amber-600">
                <Flag size={10} className="fill-amber-500 text-amber-500" />
                Impedimento
              </span>
            )}
            {limitOver && (
              <span className="text-xs text-red-600 font-medium">
                ⚠ Limite excedido
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-2">
            {issue.summary}
          </p>
          {issue.assigneeName && (
            <p className="text-xs text-gray-400 mt-0.5">{issue.assigneeName}</p>
          )}
        </div>

        {/* Tempo decorrido */}
        <div className="text-right shrink-0">
          <span
            className={`text-sm font-semibold tabular-nums ${
              limitOver ? "text-red-600" : "text-gray-700"
            }`}
          >
            {formatElapsed(elapsedMs)}
          </span>
          {issue.isFlagged && (
            <p className="text-xs text-amber-500">pausado</p>
          )}
        </div>
      </div>

      {/* Barra 1: Tempo na coluna / limite */}
      <ProgressBar
        label={`Limite ${maxHours}h`}
        pct={limitPct}
        value={formatElapsed(elapsedMs)}
        max={`${maxHours}h`}
        danger={limitOver}
        warning={elapsedHours >= maxHours * 0.75}
      />

      {/* Barra 2: Tempo / estimativa */}
      {issue.estimateSeconds !== null ? (
        <ProgressBar
          label="Estimativa"
          pct={estimatePct ?? 0}
          value={formatElapsed(elapsedMs)}
          max={formatElapsed((issue.estimateSeconds ?? 0) * 1000)}
          danger={estimateOver}
          warning={(estimatePct ?? 0) >= 75}
          className="mt-2"
        />
      ) : (
        <div className="mt-2 flex items-center gap-1">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100" />
          <span className="text-xs text-gray-300">sem estimativa</span>
        </div>
      )}
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

function ProgressBar({
  label,
  pct,
  value,
  max,
  danger,
  warning,
  className = "",
}: {
  label: string;
  pct: number;
  value: string;
  max: string;
  danger: boolean;
  warning: boolean;
  className?: string;
}) {
  const barColor = danger
    ? "bg-red-500"
    : warning
      ? "bg-amber-400"
      : "bg-blue-400";

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <span
          className={`text-xs font-medium tabular-nums ${
            danger ? "text-red-600" : warning ? "text-amber-600" : "text-gray-500"
          }`}
        >
          {value} / {max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyColumn({ columnName }: { columnName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
      <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
        <span className="text-2xl">✅</span>
      </div>
      <p className="text-sm font-medium text-gray-600">Nenhuma issue em "{columnName}"</p>
      <p className="text-xs text-gray-400 mt-1">
        A coluna está vazia. O monitor atualizará automaticamente.
      </p>
    </div>
  );
}

// ─── Helpers de tempo ─────────────────────────────────────────────────────────

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "agora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin}min`;
  return `há ${Math.floor(diffMin / 60)}h`;
}

function nextSyncLabel(config: BoardMonitorConfig): string {
  return `${config.syncIntervalMinutes}min`;
}
