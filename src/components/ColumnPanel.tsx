/**
 * ColumnPanel — lista as issues de uma coluna do board selecionado.
 *
 * Cada card mostra:
 *   - Chave da issue + summary + assignee
 *   - Badge de tempo na coluna (descontando flags)
 *   - Barra de limite (tempo / limitHours) — baseado em regras por tipo de issue
 *
 * O gear no header dispara onToggleConfig para abrir/fechar o ColumnConfigPanel
 * que fica à esquerda deste painel (gerenciado pelo App).
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { RefreshCw, Loader2, User, Flag, Clock, Settings2, Check, X, ExternalLink, Copy, Search, ChevronsDown } from "lucide-react";
import type { LoadMoreMeta } from "../hooks/useBoardView";
import type { BoardColumnWithIssues, JiraBoardIssue, ColumnConfig, LimitRule } from "../types";
import { formatTimeInColumn } from "../services/jira";
import { open } from "@tauri-apps/plugin-shell";

/** Abre a URL no navegador padrão (Tauri production) ou numa aba (dev browser) */
async function openExternal(url: string) {
  try {
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

interface Props {
  column: BoardColumnWithIssues;
  boardName: string;
  projectKey: string;
  syncing: boolean;
  enriching: boolean;
  lastSyncAt: Date | null;
  error: string | null;
  columnConfig: ColumnConfig;
  onSync: () => void;
  /** Base URL do Jira para montar o link de cada issue */
  jiraBaseUrl: string;
  /** Metadados de paginação do "carregar mais" para esta coluna */
  loadMoreMeta?: LoadMoreMeta;
  /** Callback para buscar mais issues via JQL */
  onLoadMore?: () => void;
  /** Abre/fecha o painel de configuração lateral */
  onToggleConfig: () => void;
  /** true quando o painel de configuração está aberto (destaca o ícone) */
  configPanelOpen?: boolean;
  /** Callback ao clicar num card para abrir o painel de detalhe */
  onSelectIssue?: (issue: JiraBoardIssue) => void;
  /** Chave da issue atualmente selecionada no painel de detalhe */
  selectedIssueKey?: string | null;
}

export function ColumnPanel({
  column, boardName, projectKey, syncing, enriching,
  lastSyncAt, error, columnConfig, onSync, jiraBaseUrl,
  loadMoreMeta, onLoadMore, onToggleConfig, configPanelOpen = false,
  onSelectIssue, selectedIssueKey,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef    = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef        = useRef<HTMLDivElement>(null);

  // Refs "live" para o IntersectionObserver — evitam re-registrar o observer
  // a cada mudança de loadMoreMeta/onLoadMore
  const onLoadMoreRef    = useRef(onLoadMore);
  const loadMoreMetaRef  = useRef(loadMoreMeta);
  const hasSearchRef     = useRef(false);
  const syncingRef       = useRef(syncing);
  onLoadMoreRef.current   = onLoadMore;
  loadMoreMetaRef.current = loadMoreMeta;
  syncingRef.current      = syncing;

  // IntersectionObserver: dispara onLoadMore quando o sentinel entra na viewport
  // do scroll container (usuário chegou ao fundo da lista)
  useEffect(() => {
    const sentinel  = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (hasSearchRef.current || syncingRef.current) return;

        const meta          = loadMoreMetaRef.current;
        const fn            = onLoadMoreRef.current;
        if (!fn || meta?.loading) return;

        const alreadyFetched = meta?.nextOffset ?? 0;
        const total          = meta?.total ?? Infinity;
        if (alreadyFetched === 0 || alreadyFetched < total) {
          fn();
        }
      },
      { root: container, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []); // registra uma única vez — lê deps via refs

  // Filtra por idade (maxAgeDays) usando issue.enteredAt quando disponível
  const ageFilteredIssues = (() => {
    const { maxAgeDays } = columnConfig;
    if (!maxAgeDays || maxAgeDays <= 0) return column.issues;
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return column.issues.filter((issue) => {
      if (!issue.enteredAt) return true; // sem dado de entrada, mostra por padrão
      return new Date(issue.enteredAt).getTime() >= cutoffMs;
    });
  })();

  // Filtra por busca (summary ou chave)
  const filteredIssues = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ageFilteredIssues;
    return ageFilteredIssues.filter(
      (issue) =>
        issue.fields.summary.toLowerCase().includes(q) ||
        issue.key.toLowerCase().includes(q)
    );
  })();

  const totalCount    = column.issues.length;
  const filteredCount = ageFilteredIssues.length;
  const hasFilter     = (columnConfig.maxAgeDays ?? 0) > 0;
  const hasSearch     = searchQuery.trim().length > 0;
  hasSearchRef.current = hasSearch;

  const [copied, setCopied] = useState(false);

  const copyLinks = useCallback(() => {
    const base = jiraBaseUrl.replace(/\/$/, "");
    const links = filteredIssues
      .map((i) => `${base}/browse/${i.key}`)
      .join("\n");
    navigator.clipboard.writeText(links).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [filteredIssues, jiraBaseUrl]);

  return (
    <div className="flex flex-col h-full panel-content">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b drag-region shrink-0"
           style={{ borderColor: "var(--border-subtle)" }}>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{projectKey}</span>
            <span className="mx-1" style={{ color: "var(--text-muted)" }}>·</span>
            {column.name}
          </p>
          <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>{boardName}</p>
        </div>
        <div className="flex items-center gap-1 no-drag shrink-0">
          {/* Contador */}
          <span className="text-xs font-medium mr-1" style={{ color: "var(--text-secondary)" }}>
            {hasSearch
              ? <>{filteredIssues.length} <span className="font-normal" style={{ color: "var(--text-muted)" }}>de {filteredCount !== totalCount ? `${filteredCount} filtrado` : totalCount}</span></>
              : hasFilter && filteredCount < totalCount
              ? <>{filteredCount} <span className="font-normal" style={{ color: "var(--text-muted)" }}>de {totalCount}</span></>
              : <>{totalCount} issue{totalCount !== 1 ? "s" : ""}</>
            }
          </span>

          {/* Botão de copiar links */}
          <button
            onClick={copyLinks}
            disabled={filteredIssues.length === 0}
            title={copied ? "Links copiados!" : "Copiar links de todas as issues"}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30
              ${copied
                ? "bg-green-50 text-green-600"
                : "hover:bg-gray-100"}`}
            style={!copied ? { color: "var(--text-secondary)" } : undefined}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          {/* Botão de configuração da coluna */}
          <button
            onClick={onToggleConfig}
            title="Configurar limites da coluna"
            className={`p-1.5 rounded-lg transition-colors
              ${configPanelOpen
                ? "bg-blue-50 text-blue-500 ring-1 ring-blue-200"
                : "hover:bg-gray-100"}`}
            style={!configPanelOpen ? { color: "var(--text-secondary)" } : undefined}
          >
            <Settings2 size={13} />
          </button>

          {/* Botão de refresh */}
          <button
            onClick={onSync}
            disabled={syncing}
            title="Atualizar"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            style={{ color: "var(--text-secondary)" }}
          >
            {syncing
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {/* Barra de busca */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-colors"
          style={{
            background:  hasSearch ? "rgba(239,246,255,0.6)" : "var(--bg-secondary)",
            borderColor: hasSearch ? "#bfdbfe" : "var(--border-subtle)",
          }}
        >
          <Search size={11} className={hasSearch ? "text-blue-400 shrink-0" : "shrink-0"} style={!hasSearch ? { color: "var(--text-muted)" } : undefined} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por chave ou descrição…"
            className="flex-1 text-xs bg-transparent outline-none min-w-0"
            style={{ color: "var(--text-primary)", WebkitAppRegion: "no-drag" } as React.CSSProperties}
          />
          {hasSearch && (
            <button
              onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
              className="shrink-0 hover:text-gray-500 transition-colors no-drag"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Erro de sync */}
      {error && (
        <div className="mx-2 mt-2 px-2.5 py-2 bg-red-50/40 border border-red-300 rounded-xl shrink-0">
          <p className="text-[10px] text-red-600 leading-snug">{error}</p>
        </div>
      )}

      {/* Lista de issues + sentinel de rolagem infinita */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {filteredIssues.length === 0 ? (
          <EmptyColumn
            syncing={syncing}
            filtered={hasFilter && totalCount > 0}
            searched={hasSearch}
            onLoadMore={!syncing && !hasSearch ? onLoadMore : undefined}
            loadMoreLoading={loadMoreMeta?.loading}
          />
        ) : (
          <div className="p-2 space-y-1.5">
            {filteredIssues.map((issue) => (
              <IssueColumnCard
                key={issue.id}
                issue={issue}
                enriching={enriching}
                columnConfig={columnConfig}
                jiraBaseUrl={jiraBaseUrl}
                onSelect={onSelectIssue ? () => onSelectIssue(issue) : undefined}
                isSelected={selectedIssueKey === issue.key}
              />
            ))}
          </div>
        )}

        {/* Sentinel + indicador de loading para rolagem infinita.
            O IntersectionObserver observa este elemento; quando ele aparece
            na viewport do scroll container, dispara onLoadMore. */}
        {onLoadMore && !hasSearch && (() => {
          const alreadyFetched = loadMoreMeta?.nextOffset ?? 0;
          const total          = loadMoreMeta?.total ?? Infinity;
          const hasMore        = alreadyFetched === 0 || alreadyFetched < total;
          if (!hasMore && !loadMoreMeta?.loading) return null;
          return (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-3"
              aria-hidden="true"
            >
              {loadMoreMeta?.loading && (
                <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              )}
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      {lastSyncAt && (
        <div className="px-3 py-1.5 border-t shrink-0 flex items-center justify-between gap-2"
             style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
            Atualizado às {lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
          {enriching && (
            <div className="flex items-center gap-1 text-[10px] text-blue-400 dark:text-blue-300">
              <Loader2 size={9} className="animate-spin" />
              <span>calculando tempo…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers para regras de limite ───────────────────────────────────────────

/**
 * Determina quantas horas de limite se aplicam a uma issue com base nas regras.
 * Ordem de precedência:
 *   1. Primeira regra cujos issueTypes incluem o tipo da issue (match específico)
 *   2. Primeira regra com issueTypes vazio (catch-all)
 *   3. undefined — sem limite
 */
/** Uma entrada de limite resolvida, pronta para renderizar como barra de progresso. */
interface ResolvedLimit {
  hours: number;
  label: string;
}

/**
 * Retorna uma barra de progresso para cada regra de limite aplicável ao issue.
 * Regras específicas por tipo (issueTypes não vazio) têm prioridade sobre catch-all.
 * Dentro do grupo, todas as regras válidas geram uma barra — fixas e de campo.
 */
function getApplicableLimits(
  issue: JiraBoardIssue,
  rules: LimitRule[] | undefined
): ResolvedLimit[] {
  if (!rules || rules.length === 0) return [];
  const issueTypeName = issue.fields.issuetype?.name ?? "";

  const specificRules = rules.filter(
    (r) => r.issueTypes.length > 0 && r.issueTypes.includes(issueTypeName)
  );
  const catchAllRules = rules.filter((r) => r.issueTypes.length === 0);
  const candidates = specificRules.length > 0 ? specificRules : catchAllRules;

  const result: ResolvedLimit[] = [];

  for (const rule of candidates) {
    // Label: usa a descrição da regra; fallback para "fixo" ou "campo" se vazia
    const label = rule.description?.trim()
      || (rule.timeMode === "fixed" ? "fixo" : "campo");

    if (rule.timeMode === "fixed" && (rule.fixedHours ?? 0) > 0) {
      result.push({ hours: rule.fixedHours!, label });
    } else if (rule.timeMode === "field" && rule.fieldId) {
      const raw = issue.ruleFieldValues?.[rule.fieldId];
      if (raw != null) {
        const unit = rule.fieldUnit ?? "hours";
        result.push({ hours: unit === "minutes" ? raw / 60 : raw, label });
      }
    }
  }

  return result;
}

// ─── Card de issue ────────────────────────────────────────────────────────────

/**
 * Determina a referência ao épico da issue.
 * Suporta:
 *   - Projetos clássicos: customfield_10014 (chave do épico como string)
 *   - Projetos next-gen: parent cuja issuetype.name === "Epic"
 */
function getEpicRef(issue: JiraBoardIssue): { key: string; summary: string } | null {
  // Clássico: customfield_10014 = "PROJ-42"
  if (issue.fields.customfield_10014) {
    return { key: issue.fields.customfield_10014, summary: "" };
  }
  // Next-gen: parent com issuetype Epic
  const parent = issue.fields.parent;
  if (parent && parent.fields.issuetype?.name === "Epic") {
    return { key: parent.key, summary: parent.fields.summary };
  }
  return null;
}

function IssueColumnCard({
  issue, enriching, columnConfig, jiraBaseUrl, onSelect, isSelected,
}: {
  issue: JiraBoardIssue;
  enriching: boolean;
  columnConfig: ColumnConfig;
  jiraBaseUrl: string;
  onSelect?: () => void;
  isSelected?: boolean;
}) {
  const { fields } = issue;

  const priorityColor: Record<string, string> = {
    Highest: "bg-red-500",
    High:    "bg-orange-400",
    Medium:  "bg-yellow-400",
    Low:     "bg-blue-400",
    Lowest:  "bg-gray-300",
  };
  const priColor = priorityColor[fields.priority?.name ?? ""] ?? "bg-gray-300";

  const isSubtask = fields.issuetype?.subtask === true;
  const parentRef = isSubtask ? fields.parent : null;
  const epicRef   = !isSubtask ? getEpicRef(issue) : null;

  // Resolve uma barra de progresso por regra de limite aplicável
  const limitBars   = getApplicableLimits(issue, columnConfig.limitRules);
  const hasEstimate = issue.estimateHours !== undefined && issue.estimateHours > 0;
  const showBars    = issue.timeInColumnMs !== undefined && (limitBars.length > 0 || hasEstimate);

  const issueUrl  = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;
  const parentUrl = parentRef ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${parentRef.key}` : null;
  const epicUrl   = epicRef ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${epicRef.key}` : null;

  return (
    <div
      className={`group/card rounded-xl border px-3 py-2.5 shadow-sm transition-colors
        ${issue.isFlagged ? "theme-card-flagged" : "theme-card"}
        ${onSelect ? "cursor-pointer" : ""}`}
      onClick={onSelect
        ? (e) => {
            // Ignora cliques em botões e links aninhados
            const t = e.target as HTMLElement;
            if (t.closest("button, a")) return;
            onSelect();
          }
        : undefined}
      style={isSelected ? { outline: "2px solid #3b82f6", outlineOffset: "-1px" } : undefined}
    >
      {/* Referência ao pai (subtask) */}
      {parentRef && parentUrl && (
        <button
          onClick={() => openExternal(parentUrl)}
          title={parentRef.fields.summary || parentRef.key}
          className="flex items-center gap-1 mb-1 no-drag group/parent"
        >
          {parentRef.fields.issuetype?.iconUrl && (
            <img
              src={parentRef.fields.issuetype.iconUrl}
              alt={parentRef.fields.issuetype.name}
              className="w-2.5 h-2.5 shrink-0 opacity-60"
            />
          )}
          <span className="text-[10px] font-mono group-hover/parent:text-blue-500 transition-colors leading-none"
                style={{ color: "var(--text-secondary)" }}>
            {parentRef.key}
          </span>
          {parentRef.fields.summary && (
            <span className="text-[10px] truncate max-w-[120px] group-hover/parent:text-blue-400 transition-colors"
                  style={{ color: "var(--text-muted)" }}>
              {parentRef.fields.summary}
            </span>
          )}
        </button>
      )}

      <div className="flex items-start justify-between gap-2">
        {/* Chave + summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {/* Indicador visual de subtask */}
            {isSubtask && (
              <span className="text-[9px] leading-none shrink-0 font-medium select-none"
                    style={{ color: "var(--text-muted)" }}>↳</span>
            )}
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priColor}`} />
            <span className="text-[11px] font-mono font-semibold text-blue-600 leading-none">
              {issue.key}
            </span>
            {issue.isFlagged && (
              <span title="Impedimento" className="shrink-0 flex items-center">
                <Flag size={10} className="text-red-300 fill-red-300" />
              </span>
            )}
            <button
              onClick={() => openExternal(issueUrl)}
              title="Abrir no Jira"
              className="opacity-0 group-hover/card:opacity-100 transition-opacity hover:text-blue-500 no-drag"
              style={{ color: "var(--text-muted)" }}
            >
              <ExternalLink size={10} />
            </button>
          </div>
          <p className="text-xs leading-snug line-clamp-2" style={{ color: "var(--text-primary)" }}>
            {fields.summary}
          </p>
        </div>

        {/* Avatar do assignee */}
        <div className="shrink-0">
          {fields.assignee?.avatarUrls["32x32"] ? (
            <img
              src={fields.assignee.avatarUrls["32x32"]}
              alt={fields.assignee.displayName}
              title={fields.assignee.displayName}
              className="w-6 h-6 rounded-full border"
              style={{ borderColor: "var(--border-subtle)" }}
            />
          ) : (
            <div className="w-6 h-6 rounded-full theme-secondary flex items-center justify-center">
              <User size={12} className="text-gray-400" />
            </div>
          )}
        </div>
      </div>

      {/* Referência ao épico */}
      {epicRef && epicUrl && (
        <button
          onClick={() => openExternal(epicUrl)}
          title={epicRef.summary || `Épico ${epicRef.key}`}
          className="flex items-center gap-1 mt-1.5 no-drag group/epic"
        >
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-50 border border-purple-100 group-hover/epic:bg-purple-100 group-hover/epic:border-purple-200 transition-colors">
            <span className="text-[9px] font-semibold text-purple-500 leading-none">⬡</span>
            <span className="text-[10px] font-mono text-purple-500 leading-none font-medium">
              {epicRef.key}
            </span>
            {epicRef.summary && (
              <span className="text-[10px] text-purple-400 truncate max-w-[120px]">
                {epicRef.summary}
              </span>
            )}
          </span>
        </button>
      )}

      {/* Barras de progresso */}
      {showBars && (
        <div className="mt-2 space-y-1.5">
          {limitBars.map((bar, idx) => (
            <ProgressBar
              key={idx}
              timeMs={issue.timeInColumnMs!}
              maxMs={bar.hours * 3_600_000}
              label={bar.label}
              isFlagged={issue.isFlagged}
            />
          ))}
          {hasEstimate && (
            <ProgressBar
              timeMs={issue.timeInColumnMs!}
              maxMs={issue.estimateHours! * 3_600_000}
              label="estimativa"
              isFlagged={issue.isFlagged}
              variant="estimate"
            />
          )}
        </div>
      )}

      {/* Tipo + status + badge de tempo */}
      <div className="flex items-center justify-between gap-1 mt-1.5">
        <div className="flex items-center gap-1 min-w-0">
          {fields.issuetype?.iconUrl && (
            <img
              src={fields.issuetype.iconUrl}
              alt={fields.issuetype.name}
              className={`shrink-0 ${isSubtask ? "w-2.5 h-2.5 opacity-80" : "w-3 h-3"}`}
            />
          )}
          <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>{fields.issuetype?.name}</span>
          <span className="text-[10px] mx-0.5" style={{ color: "var(--text-muted)" }}>·</span>
          <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>{fields.status?.name}</span>
        </div>

        <TimeInColumnBadge
          timeMs={issue.timeInColumnMs}
          isFlagged={issue.isFlagged}
          loading={enriching && issue.timeInColumnMs === undefined}
        />
      </div>
    </div>
  );
}

// ─── Barra de progresso ───────────────────────────────────────────────────────

function ProgressBar({
  timeMs, maxMs, label, isFlagged, variant = "limit",
}: {
  timeMs: number;
  maxMs: number;
  label: string;
  isFlagged?: boolean;
  variant?: "limit" | "estimate";
}) {
  const pct     = Math.min(100, (timeMs / maxMs) * 100);
  const over    = timeMs > maxMs;
  const elapsed = formatTimeInColumn(timeMs);
  const total   = formatTimeInColumn(maxMs);

  // Cores da barra
  let barColor: string;
  if (isFlagged) {
    barColor = "bg-red-400";
  } else if (over) {
    barColor = variant === "estimate" ? "bg-orange-400" : "bg-red-400";
  } else if (pct >= 75) {
    barColor = "bg-amber-400";
  } else {
    barColor = variant === "estimate" ? "bg-blue-400" : "bg-emerald-400";
  }

  const labelColor = over
    ? variant === "estimate" ? "text-orange-500" : "text-red-500"
    : "text-gray-400";

  return (
    <div>
      {/* Labels */}
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] uppercase tracking-wide font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
        <span className={`text-[9px] font-medium ${labelColor}`}>
          {elapsed}
          <span className="font-normal" style={{ color: "var(--text-muted)" }}> / {total}</span>
          {over && <span className="ml-0.5">⚠</span>}
        </span>
      </div>

      {/* Track */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Badge de tempo ───────────────────────────────────────────────────────────

function TimeInColumnBadge({
  timeMs, isFlagged, loading,
}: {
  timeMs?: number;
  isFlagged?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border shrink-0"
           style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}>
        <Loader2 size={9} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }
  if (timeMs === undefined) return null;

  const hours = timeMs / 3_600_000;
  const badgeClass = isFlagged
    ? "bg-red-50/20 text-red-400 border-red-200"
    : hours >= 72
    ? "bg-red-50/30 text-red-500 border-red-200"
    : hours >= 24
    ? "bg-amber-50 text-amber-500 border-amber-200"
    : "bg-green-50 text-green-600 border-green-200";

  return (
    <div
      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-medium shrink-0 ${badgeClass}`}
      title={isFlagged ? "Flagado — tempo excluído do cálculo" : "Tempo nesta coluna (sem períodos flagados)"}
    >
      {isFlagged ? <Flag size={9} /> : <Clock size={9} />}
      <span>{formatTimeInColumn(timeMs)}</span>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyColumn({
  syncing, filtered, searched, onLoadMore, loadMoreLoading,
}: {
  syncing: boolean;
  filtered?: boolean;
  searched?: boolean;
  onLoadMore?: () => void;
  loadMoreLoading?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-10 text-center px-6">
      {syncing ? (
        <>
          <Loader2 size={20} className="text-blue-400 animate-spin mb-3" />
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Buscando issues...</p>
        </>
      ) : searched ? (
        <>
          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mb-3">
            <Search size={18} className="text-blue-300" />
          </div>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nenhum resultado encontrado</p>
          <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>Tente uma busca diferente</p>
        </>
      ) : filtered ? (
        <>
          <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center mb-3">
            <span className="text-lg">🔍</span>
          </div>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nenhuma issue no período filtrado</p>
          <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>Ajuste o filtro de dias nas configurações da coluna</p>
          {onLoadMore && (
            <button
              onClick={onLoadMore}
              disabled={loadMoreLoading}
              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-100 bg-blue-50 text-blue-500 hover:bg-blue-100 text-xs font-medium transition-colors disabled:opacity-50 no-drag"
            >
              {loadMoreLoading
                ? <><Loader2 size={11} className="animate-spin" />Carregando…</>
                : <><ChevronsDown size={11} />Carregar mais do Jira</>}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
               style={{ background: "var(--bg-secondary)" }}>
            <span className="text-lg">✓</span>
          </div>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nenhuma issue nesta coluna</p>
          {onLoadMore && (
            <button
              onClick={onLoadMore}
              disabled={loadMoreLoading}
              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-100 bg-blue-50 text-blue-500 hover:bg-blue-100 text-xs font-medium transition-colors disabled:opacity-50 no-drag"
            >
              {loadMoreLoading
                ? <><Loader2 size={11} className="animate-spin" />Carregando…</>
                : <><ChevronsDown size={11} />Carregar mais do Jira</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}
