/**
 * AlertPanel — painel lateral de alertas ativos.
 *
 * Exibe todos os alertas não silenciados agrupados por tipo,
 * com ação de silenciar individual ou todos de uma vez.
 */
import { Bell, Clock, AlertTriangle, Flag, ArrowRightLeft, X, BellOff } from "lucide-react";
import type { AppAlert } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  const hours  = Math.floor(mins / 60);
  const days   = Math.floor(hours / 24);
  if (days > 0)  return `há ${days}d`;
  if (hours > 0) return `há ${hours}h`;
  if (mins > 0)  return `há ${mins}min`;
  return "agora";
}

// ─── Configuração visual por tipo de alerta ───────────────────────────────────

interface AlertStyle {
  Icon: typeof Bell;
  label: string;
  iconClass: string;
  bgClass: string;
  borderClass: string;
  badgeClass: string;
}

const ALERT_STYLES: Record<AppAlert["kind"], AlertStyle> = {
  time_breach: {
    Icon: Clock,
    label: "Tempo excedido",
    iconClass: "text-red-500",
    bgClass: "bg-red-50",
    borderClass: "border-red-200",
    badgeClass: "bg-red-500",
  },
  time_warning: {
    Icon: AlertTriangle,
    label: "Tempo próximo do limite",
    iconClass: "text-amber-500",
    bgClass: "bg-amber-50",
    borderClass: "border-amber-200",
    badgeClass: "bg-amber-500",
  },
  flagged: {
    Icon: Flag,
    label: "Impedimento",
    iconClass: "text-red-500",
    bgClass: "bg-red-50",
    borderClass: "border-red-200",
    badgeClass: "bg-red-500",
  },
  column_change: {
    Icon: ArrowRightLeft,
    label: "Mudança de coluna",
    iconClass: "text-blue-500",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-200",
    badgeClass: "bg-blue-500",
  },
};

// ─── Componente principal ─────────────────────────────────────────────────────

interface AlertPanelProps {
  alerts: AppAlert[];
  onSilence: (id: string) => void;
  onSilenceAll: () => void;
  jiraBaseUrl: string;
}

export function AlertPanel({ alerts, onSilence, onSilenceAll, jiraBaseUrl }: AlertPanelProps) {
  const baseUrl = jiraBaseUrl.replace(/\/$/, "");

  // Ordena: time_breach → time_warning → flagged → column_change
  const ORDER: Record<AppAlert["kind"], number> = {
    time_breach: 0, time_warning: 1, flagged: 2, column_change: 3,
  };
  const sorted = [...alerts].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

  return (
    <div className="flex flex-col h-full panel-content rounded-2xl overflow-hidden">

      {/* ── Cabeçalho ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={15} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">Alertas</span>
          {alerts.length > 0 && (
            <span className="min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-bold
              rounded-full flex items-center justify-center px-1">
              {alerts.length > 99 ? "99+" : alerts.length}
            </span>
          )}
        </div>

        {alerts.length > 0 && (
          <button
            onClick={onSilenceAll}
            title="Silenciar todos os alertas"
            className="no-drag flex items-center gap-1 text-[10px] text-gray-400
              hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-50"
          >
            <BellOff size={12} />
            Silenciar todos
          </button>
        )}
      </div>

      {/* ── Lista de alertas ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1.5">
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          sorted.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              baseUrl={baseUrl}
              onSilence={() => onSilence(alert.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Card de alerta individual ────────────────────────────────────────────────

function AlertCard({
  alert,
  baseUrl,
  onSilence,
}: {
  alert: AppAlert;
  baseUrl: string;
  onSilence: () => void;
}) {
  const style = ALERT_STYLES[alert.kind];
  const { Icon } = style;
  const issueUrl = `${baseUrl}/browse/${alert.issueKey}`;

  return (
    <div className={`group rounded-xl border ${style.bgClass} ${style.borderClass} px-3 py-2.5`}>
      {/* Linha topo: ícone + issueKey + tempo + botão silenciar */}
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 shrink-0 ${style.iconClass}`}>
          <Icon size={14} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Issue key + label */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <a
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-bold text-gray-700 hover:underline no-drag shrink-0"
            >
              {alert.issueKey}
            </a>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white ${style.badgeClass}`}>
              {style.label}
            </span>
          </div>

          {/* Mensagem */}
          <p className="text-[11px] text-gray-600 leading-snug break-words">
            {alert.message}
          </p>

          {/* Coluna */}
          {alert.columnName && (
            <span className="inline-block mt-1 text-[9px] font-medium text-gray-400
              bg-gray-100 rounded px-1.5 py-0.5 leading-none">
              {alert.columnName}
            </span>
          )}

          {/* Summary */}
          <p className="text-[10px] text-gray-400 mt-0.5 truncate" title={alert.summary}>
            {alert.summary}
          </p>

          {/* Barra de progresso para alertas de tempo */}
          {alert.pct !== undefined && (
            <TimeBar pct={alert.pct} kind={alert.kind} />
          )}

          {/* Timestamp */}
          <p className="text-[9px] text-gray-300 mt-1">
            {relativeTime(alert.createdAt)}
          </p>
        </div>

        {/* Botão silenciar */}
        <button
          onClick={onSilence}
          title="Silenciar este alerta"
          className="no-drag shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
            p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-white/60"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Barra de progresso de tempo ──────────────────────────────────────────────

function TimeBar({ pct, kind }: { pct: number; kind: AppAlert["kind"] }) {
  const clamped = Math.min(pct, 100);
  const color   = kind === "time_breach" ? "bg-red-400" : "bg-amber-400";

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-gray-400">tempo na coluna</span>
        <span className={`text-[9px] font-semibold ${kind === "time_breach" ? "text-red-500" : "text-amber-500"}`}>
          {Math.round(pct)}%
          {kind === "time_breach" && " ⚠"}
        </span>
      </div>
      <div className="h-1 bg-white/70 rounded-full overflow-hidden border border-white/50">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

// ─── Estado vazio ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
      <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
        <Bell size={18} className="text-green-400" />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500">Sem alertas ativos</p>
        <p className="text-[10px] text-gray-300 mt-0.5 leading-snug">
          Notificações de tempo e mudanças<br />aparecerão aqui
        </p>
      </div>
    </div>
  );
}
