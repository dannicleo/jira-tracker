/**
 * HistoryPanel — histórico de atividade por período.
 *
 * - Período padrão: semana atual (seg–dom)
 * - Navegação: botões < e > avançam/retrocedem o período
 * - Modo personalizado: seleção livre de data início e fim
 * - Filtro por pessoa: busca qualquer usuário do Jira pelo nome/e-mail
 * - Busca issues atribuídas ao usuário selecionado com atividade no período
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft, ChevronRight, Loader2, RefreshCw,
  ExternalLink, ArrowRight, CalendarDays, User, X, Search,
  MessageSquare, Flag as FlagIcon, ListChecks, BarChart2, CheckCircle2, AlertTriangle, XCircle, ChevronDown,
  Terminal, Play, Bookmark, BookmarkCheck, Trash2, Copy, Check,
} from "lucide-react";
import type { AppSettings, ActivityIssue, DevActivityIssue, DevAction, ColumnConfig, WorkSchedule, BoardColumnWithIssues } from "../types";
import {
  fetchActivityHistory, fetchDevActivity, fetchCurrentUserAccountId,
  searchJiraUsers, fetchReportIssues, formatTimeInColumn, fetchJqlIssues,
  type JiraUser, type ReportIssue, type JqlIssue,
} from "../services/jira";
import {
  getSavedJqlQueries, saveJqlQuery, deleteJqlQuery,
} from "../services/db";
import type { SavedJqlQuery } from "../types";
import type { DevActivityResult } from "../services/jira";
import { open } from "@tauri-apps/plugin-shell";

async function openExternal(url: string) {
  try { await open(url); }
  catch { window.open(url, "_blank", "noopener,noreferrer"); }
}

// ─── Utilitários de período ────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function endOfWeek(d: Date): Date {
  const monday = startOfWeek(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(s: string): Date | null {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function formatPeriodLabel(start: Date, end: Date): string {
  const sDay = start.getDate();
  const eDay = end.getDate();
  const sMon = start.toLocaleDateString("pt-BR", { month: "short" });
  const eMon = end.toLocaleDateString("pt-BR", { month: "short" });
  const eYear = end.getFullYear();
  const nowYear = new Date().getFullYear();
  const yearSuffix = eYear !== nowYear ? ` ${eYear}` : "";

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${sDay} – ${eDay} ${eMon}${yearSuffix}`;
  }
  return `${sDay} ${sMon} – ${eDay} ${eMon}${yearSuffix}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const day = d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${weekday} ${day} · ${time}`;
}

function isCurrentWeek(start: Date, end: Date): boolean {
  const ws = startOfWeek(new Date());
  const we = endOfWeek(new Date());
  return toInputDate(start) === toInputDate(ws) && toInputDate(end) === toInputDate(we);
}

// ─── Cores de prioridade ──────────────────────────────────────────────────────

const priorityDot: Record<string, string> = {
  Highest: "bg-red-500",
  High:    "bg-orange-400",
  Medium:  "bg-yellow-400",
  Low:     "bg-blue-400",
  Lowest:  "bg-gray-300",
};

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  settings:      AppSettings;
  projectKey?:   string;
  jiraBaseUrl:   string;
  /** Colunas do board (para seleção da coluna no relatório) */
  columns?:      BoardColumnWithIssues[];
  /** Configurações de limite por coluna */
  columnConfigs?: Record<string, ColumnConfig>;
  /** Horário de trabalho para cálculo de tempo útil */
  workSchedule?:  WorkSchedule;
}

export function HistoryPanel({ settings, projectKey, jiraBaseUrl, columns = [], columnConfigs = {}, workSchedule }: Props) {
  // Abas
  const [activeTab, setActiveTab] = useState<"assigned" | "activity" | "report" | "jql">("assigned");

  // Período
  const [periodStart, setPeriodStart] = useState<Date>(() => startOfWeek(new Date()));
  const [periodEnd,   setPeriodEnd]   = useState<Date>(() => endOfWeek(new Date()));
  const periodDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;

  // Modo personalizado
  const [customMode,  setCustomMode]  = useState(false);
  const [customStart, setCustomStart] = useState(toInputDate(periodStart));
  const [customEnd,   setCustomEnd]   = useState(toInputDate(periodEnd));

  // Filtro por pessoa
  const [selectedUser,    setSelectedUser]    = useState<JiraUser | null>(null);
  const [showUserPicker,  setShowUserPicker]  = useState(false);
  const [userQuery,       setUserQuery]       = useState("");
  const [userResults,     setUserResults]     = useState<JiraUser[]>([]);
  const [searchingUsers,  setSearchingUsers]  = useState(false);
  const userPickerRef = useRef<HTMLDivElement>(null);
  const userInputRef  = useRef<HTMLInputElement>(null);

  // Dados — aba "Issues Atribuídas"
  const [issues,  setIssues]  = useState<ActivityIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Dados — aba "Atividade do Dev"
  const [devIssues,    setDevIssues]    = useState<DevActivityIssue[]>([]);
  const [devTruncated, setDevTruncated] = useState(false);
  const [devLoading,   setDevLoading]   = useState(false);
  const [devError,     setDevError]     = useState<string | null>(null);

  // Dados — aba "Consulta JQL"
  const [jqlQuery,     setJqlQuery]     = useState("");
  const [jqlIssues,    setJqlIssues]    = useState<JqlIssue[]>([]);
  const [jqlTotal,     setJqlTotal]     = useState(0);
  const [jqlTruncated, setJqlTruncated] = useState(false);
  const [jqlLoading,   setJqlLoading]   = useState(false);
  const [jqlError,     setJqlError]     = useState<string | null>(null);
  const [jqlExecuted,  setJqlExecuted]  = useState(false);
  // Queries salvas
  const [savedQueries,    setSavedQueries]    = useState<SavedJqlQuery[]>(() => getSavedJqlQueries());
  const [showSaveInput,   setShowSaveInput]   = useState(false);
  const [saveName,        setSaveName]        = useState("");
  const [showSavedList,   setShowSavedList]   = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);
  // Seleção para cópia
  const [selectedKeys,  setSelectedKeys]  = useState<Set<string>>(new Set());
  const [copyDone,      setCopyDone]      = useState(false);

  // Dados — aba "Relatório"
  // Colunas que possuem ao menos uma regra de limite configurada
  const reportableColumns = columns.filter(c => (columnConfigs[c.name]?.limitRules?.length ?? 0) > 0);
  const [selectedReportCol, setSelectedReportCol] = useState<string>(() => reportableColumns[0]?.name ?? "");
  const [reportIssues,  setReportIssues]  = useState<ReportIssue[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError,   setReportError]   = useState<string | null>(null);

  // ── Busca de usuários ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!showUserPicker) return;
    if (!userQuery.trim()) { setUserResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const results = await searchJiraUsers(userQuery, settings, projectKey);
        setUserResults(results);
      } finally {
        setSearchingUsers(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [userQuery, showUserPicker, settings, projectKey]);

  // Fecha o picker ao clicar fora
  useEffect(() => {
    if (!showUserPicker) return;
    function handleClick(e: MouseEvent) {
      if (userPickerRef.current && !userPickerRef.current.contains(e.target as Node)) {
        setShowUserPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUserPicker]);

  // Foca o input ao abrir o picker
  useEffect(() => {
    if (showUserPicker) {
      setTimeout(() => userInputRef.current?.focus(), 50);
    }
  }, [showUserPicker]);

  // ── Fetch — aba "Issues Atribuídas" ────────────────────────────────────────
  const fetchData = useCallback(async (start: Date, end: Date) => {
    if (!settings.jira_api_token || !settings.jira_email) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivityHistory(
        selectedUser?.accountId ?? null, start, end, settings, projectKey
      );
      setIssues(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar histórico");
    } finally {
      setLoading(false);
    }
  }, [settings, projectKey, selectedUser]);

  // ── Fetch — aba "Atividade do Dev" ─────────────────────────────────────────
  const fetchDevData = useCallback(async (start: Date, end: Date) => {
    if (!settings.jira_api_token || !settings.jira_email) return;
    setDevLoading(true);
    setDevError(null);
    try {
      let accountId = selectedUser?.accountId ?? null;
      if (!accountId) {
        accountId = await fetchCurrentUserAccountId(settings);
      }
      if (!accountId) throw new Error("Não foi possível identificar o usuário");
      const result: DevActivityResult = await fetchDevActivity(accountId, start, end, settings, projectKey);
      setDevIssues(result.issues);
      setDevTruncated(result.truncated);
    } catch (e) {
      setDevError(e instanceof Error ? e.message : "Erro ao buscar atividade do dev");
    } finally {
      setDevLoading(false);
    }
  }, [settings, projectKey, selectedUser]);

  // ── Fetch — aba "Relatório" ────────────────────────────────────────────────
  const fetchReportData = useCallback(async (start: Date, end: Date, colName: string) => {
    if (!settings.jira_api_token || !settings.jira_email) return;
    const col = columns.find(c => c.name === colName);
    if (!col) return;
    const cfg = columnConfigs[colName];
    setReportLoading(true);
    setReportError(null);
    try {
      const data = await fetchReportIssues(
        start, end,
        col.statusIds,
        cfg?.limitRules,
        workSchedule ?? { workStartHour: 9, workStartMinute: 0, workEndHour: 18, workEndMinute: 0, lunchStartHour: 12, lunchStartMinute: 0, lunchDurationMinutes: 60, workDays: [1,2,3,4,5], holidays: [] },
        settings,
        projectKey
      );
      setReportIssues(data);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Erro ao gerar relatório");
    } finally {
      setReportLoading(false);
    }
  }, [settings, projectKey, columns, columnConfigs, workSchedule]);

  // ── Executa query JQL livre ────────────────────────────────────────────────
  const executeJql = useCallback(async () => {
    if (!jqlQuery.trim() || !settings.jira_api_token || !settings.jira_email) return;
    setJqlLoading(true);
    setJqlError(null);
    setJqlExecuted(true);
    setSelectedKeys(new Set());
    try {
      const { issues, total, truncated } = await fetchJqlIssues(jqlQuery, settings);
      setJqlIssues(issues);
      setJqlTotal(total);
      setJqlTruncated(truncated);
    } catch (e) {
      setJqlError(e instanceof Error ? e.message : "Erro ao executar query");
      setJqlIssues([]);
    } finally {
      setJqlLoading(false);
    }
  }, [jqlQuery, settings]);

  // Salva query com nome
  function handleSaveQuery() {
    if (!saveName.trim() || !jqlQuery.trim()) return;
    const entry = saveJqlQuery(saveName, jqlQuery);
    setSavedQueries(prev => [entry, ...prev]);
    setSaveName("");
    setShowSaveInput(false);
  }

  // Remove query salva
  function handleDeleteQuery(id: string) {
    deleteJqlQuery(id);
    setSavedQueries(prev => prev.filter(q => q.id !== id));
  }

  // Carrega query salva no editor
  function handleLoadQuery(query: SavedJqlQuery) {
    setJqlQuery(query.query);
    setShowSavedList(false);
  }

  // Foca input de nome ao abrir
  useEffect(() => {
    if (showSaveInput) setTimeout(() => saveInputRef.current?.focus(), 50);
  }, [showSaveInput]);

  // Fecha dropdown de queries salvas ao clicar fora
  useEffect(() => {
    if (!showSavedList) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Fecha se clicar fora de qualquer elemento com data-savedlist
      if (!(target as HTMLElement).closest?.("[data-savedlist]")) {
        setShowSavedList(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSavedList]);

  // Dispara o fetch da aba ativa ao mudar período, usuário ou aba
  useEffect(() => {
    if (activeTab === "assigned") fetchData(periodStart, periodEnd);
    else if (activeTab === "activity") fetchDevData(periodStart, periodEnd);
    else if (activeTab === "report" && selectedReportCol) fetchReportData(periodStart, periodEnd, selectedReportCol);
  }, [periodStart, periodEnd, activeTab, selectedReportCol, fetchData, fetchDevData, fetchReportData]);

  // ── Navegação de período ───────────────────────────────────────────────────
  function navigate(direction: -1 | 1) {
    const delta = direction * periodDays;
    setPeriodStart(s => addDays(s, delta));
    setPeriodEnd(e => addDays(e, delta));
    setCustomMode(false);
  }

  function applyCustomRange() {
    const s = parseDateInput(customStart);
    const e = parseDateInput(customEnd);
    if (!s || !e || s > e) return;
    e.setHours(23, 59, 59, 999);
    setPeriodStart(s);
    setPeriodEnd(e);
    setCustomMode(false);
  }

  function setWeek(weekOffset = 0) {
    const base = addDays(new Date(), weekOffset * 7);
    setPeriodStart(startOfWeek(base));
    setPeriodEnd(endOfWeek(base));
    setCustomMode(false);
  }

  function selectUser(user: JiraUser | null) {
    setSelectedUser(user);
    setShowUserPicker(false);
    setUserQuery("");
    setUserResults([]);
  }

  // ── Estatísticas ──────────────────────────────────────────────────────────
  const totalTransitions = issues.reduce((n, i) => n + i.transitions.length, 0);
  const doneCount = issues.filter(i =>
    i.transitions.some(t => /done|conclu|resolv|fechad/i.test(t.toStatus))
  ).length;

  const periodLabel = formatPeriodLabel(periodStart, periodEnd);

  return (
    <div className="flex flex-col h-full panel-content">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b drag-region shrink-0"
           style={{ borderColor: "var(--border-subtle)" }}>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Histórico</p>
          <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
            {projectKey && <span style={{ color: "var(--text-muted)" }}>{projectKey} · </span>}
            {settings.jira_email}
          </p>
        </div>
        <button
          onClick={() => {
            if (activeTab === "assigned") fetchData(periodStart, periodEnd);
            else if (activeTab === "activity") fetchDevData(periodStart, periodEnd);
            else if (activeTab === "report" && selectedReportCol) fetchReportData(periodStart, periodEnd, selectedReportCol);
            else if (activeTab === "jql" && jqlExecuted) executeJql();
          }}
          disabled={loading || devLoading || reportLoading || jqlLoading}
          title="Atualizar"
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 no-drag shrink-0"
          style={{ color: "var(--text-secondary)" }}
        >
          {(loading || devLoading || reportLoading || jqlLoading)
            ? <Loader2 size={13} className="animate-spin" />
            : <RefreshCw size={13} />}
        </button>
      </div>

      {/* ── Abas ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center px-3 gap-0.5 shrink-0 border-b"
           style={{ borderColor: "var(--border-subtle)" }}>
        {([
          { id: "assigned", label: "Atribuídas",  icon: <ListChecks size={11} /> },
          { id: "activity", label: "Dev",          icon: <FlagIcon   size={11} /> },
          { id: "report",   label: "Relatório",    icon: <BarChart2  size={11} /> },
          { id: "jql",      label: "Consulta",     icon: <Terminal   size={11} /> },
        ] as const).map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium transition-colors no-drag"
            style={{
              color:        activeTab === id ? "#2563eb" : "var(--text-secondary)",
              borderBottom: activeTab === id ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── Filtro por pessoa ──────────────────────────────────────────────── */}
      {activeTab !== "jql" && <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="relative" ref={userPickerRef}>
          {/* Botão que mostra a pessoa selecionada */}
          <button
            onClick={() => setShowUserPicker(v => !v)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-colors text-left no-drag"
            style={{
              borderColor: showUserPicker ? "#93c5fd" : "var(--ctrl-inactive-border)",
              background:  showUserPicker ? "rgba(239,246,255,0.5)" : "var(--bg-secondary)",
            }}
          >
            {selectedUser ? (
              selectedUser.avatarUrl
                ? <img src={selectedUser.avatarUrl} alt={selectedUser.displayName}
                       className="w-4 h-4 rounded-full shrink-0" />
                : <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <User size={9} className="text-blue-500" />
                  </div>
            ) : (
              <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <User size={9} style={{ color: "var(--text-secondary)" }} />
              </div>
            )}
            <span className="flex-1 text-xs truncate"
                  style={{ color: selectedUser ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {selectedUser ? selectedUser.displayName : "Você mesmo"}
            </span>
            {selectedUser && (
              <button
                onClick={(e) => { e.stopPropagation(); selectUser(null); }}
                className="shrink-0 rounded hover:text-gray-500 transition-colors no-drag"
                style={{ color: "var(--text-muted)" }}
                title="Voltar para você mesmo"
              >
                <X size={11} />
              </button>
            )}
            <Search size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          </button>

          {/* Dropdown do picker */}
          {showUserPicker && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-md z-50 overflow-hidden"
                 style={{ background: "var(--panel-bg)", borderColor: "var(--ctrl-inactive-border)" }}>

              {/* Input de busca */}
              <div className="flex items-center gap-2 px-3 py-2 border-b"
                   style={{ borderColor: "var(--border-subtle)" }}>
                <Search size={11} style={{ color: "var(--text-secondary)" }} />
                <input
                  ref={userInputRef}
                  type="text"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  placeholder="Nome ou e-mail…"
                  className="flex-1 text-xs bg-transparent outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                {searchingUsers && <Loader2 size={10} className="animate-spin shrink-0" style={{ color: "var(--text-secondary)" }} />}
              </div>

              {/* Opção: você mesmo */}
              <button
                onClick={() => selectUser(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:opacity-80"
                style={{
                  background: !selectedUser ? "rgba(239,246,255,0.6)" : undefined,
                  color:      !selectedUser ? "#2563eb" : "var(--text-primary)",
                }}
              >
                <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <User size={10} style={{ color: "var(--text-secondary)" }} />
                </div>
                <span className="flex-1">Você mesmo</span>
                {!selectedUser && <span className="text-[10px] text-blue-400">ativo</span>}
              </button>

              {/* Resultados da busca */}
              {userResults.length > 0 && (
                <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                  {userResults.map(u => (
                    <button
                      key={u.accountId}
                      onClick={() => selectUser(u)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                      style={{
                        background: selectedUser?.accountId === u.accountId ? "rgba(239,246,255,0.6)" : undefined,
                        color:      selectedUser?.accountId === u.accountId ? "#2563eb" : "var(--text-primary)",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background =
                          selectedUser?.accountId === u.accountId ? "rgba(239,246,255,0.6)" : "";
                      }}
                    >
                      {u.avatarUrl
                        ? <img src={u.avatarUrl} alt={u.displayName} className="w-5 h-5 rounded-full shrink-0" />
                        : <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                            <User size={10} style={{ color: "var(--text-secondary)" }} />
                          </div>
                      }
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{u.displayName}</p>
                        {u.emailAddress && (
                          <p className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                            {u.emailAddress}
                          </p>
                        )}
                      </div>
                      {selectedUser?.accountId === u.accountId && (
                        <span className="text-[10px] text-blue-400 shrink-0">ativo</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Estado vazio */}
              {!searchingUsers && userQuery.trim() && userResults.length === 0 && (
                <div className="px-3 py-3 text-center">
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    Nenhum usuário encontrado
                  </p>
                </div>
              )}

              {/* Dica inicial */}
              {!userQuery.trim() && (
                <div className="px-3 py-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Digite para buscar um membro da equipe
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* ── Navegação de período ───────────────────────────────────────────── */}
      {activeTab !== "jql" && <div className="px-3 py-2 border-b shrink-0 space-y-2"
           style={{ borderColor: "var(--border-subtle)" }}>

        {/* Linha principal: < período > */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate(-1)}
            title="Período anterior"
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors no-drag shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <ChevronLeft size={14} />
          </button>

          <button
            onClick={() => setCustomMode(m => !m)}
            className={`flex-1 text-center text-xs font-semibold rounded-lg py-1 transition-colors no-drag
              ${customMode ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"}`}
            style={!customMode ? { color: "var(--text-primary)" } : undefined}
          >
            {periodLabel}
          </button>

          <button
            onClick={() => navigate(1)}
            disabled={isCurrentWeek(periodStart, periodEnd) && !customMode}
            title="Próximo período"
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 no-drag shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Atalhos rápidos */}
        {!customMode && (
          <div className="flex items-center gap-1">
            {[
              { label: "Hoje",         action: () => { const t = new Date(); setPeriodStart(new Date(t.setHours(0,0,0,0))); setPeriodEnd(new Date(new Date().setHours(23,59,59,999))); } },
              { label: "Esta semana",  action: () => setWeek(0) },
              { label: "Sem. passada", action: () => setWeek(-1) },
            ].map(({ label, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex-1 text-[10px] px-2 py-1 rounded-lg border hover:opacity-80 transition-colors no-drag"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Seletor personalizado */}
        {customMode && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="flex-1 text-[11px] px-2 py-1 border rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 no-drag"
              style={{ background: "var(--panel-bg)", borderColor: "var(--ctrl-inactive-border)", color: "var(--text-primary)", WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
            <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>→</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={e => setCustomEnd(e.target.value)}
              className="flex-1 text-[11px] px-2 py-1 border rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 no-drag"
              style={{ background: "var(--panel-bg)", borderColor: "var(--ctrl-inactive-border)", color: "var(--text-primary)", WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
            <button
              onClick={applyCustomRange}
              disabled={!customStart || !customEnd || customStart > customEnd}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-[11px] font-medium transition-colors disabled:opacity-40 no-drag"
            >
              OK
            </button>
          </div>
        )}
      </div>}

      {/* ── Stats — aba Atribuídas ──────────────────────────────────────────── */}
      {activeTab === "assigned" && !loading && issues.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-b shrink-0"
             style={{ borderColor: "var(--border-subtle)" }}>
          <Stat label="issues" value={issues.length} color="text-blue-600" />
          <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
          <Stat label="transições" value={totalTransitions} color="text-purple-500" />
          <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
          <Stat label="concluídas" value={doneCount} color="text-emerald-600" />
        </div>
      )}

      {/* ── Stats — aba Atividade do Dev ────────────────────────────────────── */}
      {activeTab === "activity" && !devLoading && devIssues.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-b shrink-0"
             style={{ borderColor: "var(--border-subtle)" }}>
          <Stat label="issues" value={devIssues.length} color="text-blue-600" />
          <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
          <Stat
            label="ações"
            value={devIssues.reduce((n, i) => n + i.actions.length, 0)}
            color="text-purple-500"
          />
          <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
          <Stat
            label="comentários"
            value={devIssues.reduce((n, i) => n + i.actions.filter(a => a.type === "comment").length, 0)}
            color="text-emerald-600"
          />
        </div>
      )}

      {/* ── Seletor de coluna + stats — aba Relatório ───────────────────────── */}
      {activeTab === "report" && (
        <div className="px-3 py-2 border-b shrink-0 space-y-2"
             style={{ borderColor: "var(--border-subtle)" }}>
          {/* Selector */}
          {reportableColumns.length > 0 ? (
            <div className="relative">
              <select
                value={selectedReportCol}
                onChange={e => setSelectedReportCol(e.target.value)}
                className="w-full appearance-none px-2.5 py-1.5 pr-7 text-xs border rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 no-drag"
                style={{ background: "var(--panel-bg)", borderColor: "var(--ctrl-inactive-border)", color: "var(--text-primary)" }}
              >
                {reportableColumns.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                           style={{ color: "var(--text-secondary)" }} />
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Nenhuma coluna com limites configurados.
            </p>
          )}
          {/* Stats */}
          {!reportLoading && reportIssues.length > 0 && (() => {
            const ok  = reportIssues.filter(i => i.limits.length === 0 || i.limits.every(l => i.timeInColumnMs <= l.limitHours * 3_600_000)).length;
            const exc = reportIssues.filter(i => i.limits.some(l => i.timeInColumnMs > l.limitHours * 3_600_000)).length;
            return (
              <div className="flex items-center gap-3">
                <Stat label="concluídas" value={reportIssues.length} color="text-blue-600" />
                <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
                <Stat label="dentro do limite" value={ok}  color="text-emerald-600" />
                <div className="w-px h-4" style={{ background: "var(--border-subtle)" }} />
                <Stat label="excedidas"         value={exc} color="text-red-500" />
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Conteúdo ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* ─ Aba Issues Atribuídas ─ */}
        {activeTab === "assigned" && (
          loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Loader2 size={20} className="text-blue-400 animate-spin" />
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Buscando atividade…</p>
            </div>
          ) : error ? (
            <div className="m-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-[11px] text-red-600 leading-snug">{error}</p>
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <CalendarDays size={18} style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Nenhuma atividade no período
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {selectedUser
                  ? `Nenhuma issue de ${selectedUser.displayName} foi atualizada em ${periodLabel}`
                  : `Nenhuma issue atribuída a você foi atualizada em ${periodLabel}`}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {issues.map(issue => (
                <ActivityIssueCard
                  key={issue.id}
                  issue={issue}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ))}
            </div>
          )
        )}

        {/* ─ Aba Atividade do Dev ─ */}
        {activeTab === "activity" && (
          devLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Loader2 size={20} className="text-blue-400 animate-spin" />
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Buscando atividade do dev…</p>
            </div>
          ) : devError ? (
            <div className="m-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-[11px] text-red-600 leading-snug">{devError}</p>
            </div>
          ) : devIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <CalendarDays size={18} style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Nenhuma ação registrada no período
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {selectedUser
                  ? `${selectedUser.displayName} não fez nenhuma ação em ${periodLabel}`
                  : `Você não realizou nenhuma ação em ${periodLabel}`}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {devIssues.map(issue => (
                <DevActivityIssueCard
                  key={issue.id}
                  issue={issue}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ))}
              {devTruncated && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px] leading-snug"
                     style={{ background: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.4)", color: "var(--text-secondary)" }}>
                  <span className="shrink-0 text-yellow-500 font-bold mt-px">⚠</span>
                  <span>
                    Resultado limitado a <strong className="text-yellow-600">300 issues</strong>. Períodos muito longos podem ter atividades não exibidas — refine o intervalo de datas para ver mais.
                  </span>
                </div>
              )}
            </div>
          )
        )}

        {/* ─ Aba Consulta JQL ─ */}
        {activeTab === "jql" && (
          <div className="flex flex-col h-full">
            {/* Input + botão executar */}
            <div className="p-3 border-b shrink-0 space-y-2"
                 style={{ borderColor: "var(--border-subtle)" }}>

              {/* Textarea */}
              <textarea
                value={jqlQuery}
                onChange={e => setJqlQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) executeJql();
                }}
                placeholder={'status CHANGED to "Production" DURING ("2026-04-01", "2026-04-30") AND project = MeuProjeto ORDER BY updated DESC'}
                rows={4}
                className="w-full text-[11px] font-mono px-2.5 py-2 border rounded-xl outline-none resize-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 no-drag"
                style={{
                  background:      "var(--panel-bg)",
                  borderColor:     "var(--ctrl-inactive-border)",
                  color:           "var(--text-primary)",
                  WebkitAppRegion: "no-drag",
                } as React.CSSProperties}
              />

              {/* Botões: Buscar + Salvar + Queries salvas */}
              <div className="relative flex gap-2" data-savedlist>
                <button
                  onClick={executeJql}
                  disabled={!jqlQuery.trim() || jqlLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-semibold transition-colors disabled:opacity-40 no-drag"
                >
                  {jqlLoading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Play size={13} />}
                  {jqlLoading ? "Buscando…" : "Buscar"}
                </button>

                {/* Botão Salvar */}
                <button
                  onClick={() => { setShowSaveInput(v => !v); setSaveName(""); setShowSavedList(false); }}
                  disabled={!jqlQuery.trim()}
                  title="Salvar query"
                  className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border text-xs font-medium transition-colors disabled:opacity-40 no-drag"
                  style={{
                    borderColor: showSaveInput ? "#93c5fd" : "var(--ctrl-inactive-border)",
                    background:  showSaveInput ? "rgba(239,246,255,0.5)" : "var(--bg-secondary)",
                    color:       showSaveInput ? "#2563eb" : "var(--text-secondary)",
                  }}
                >
                  <Bookmark size={13} />
                </button>

                {/* Botão Queries salvas */}
                <button
                  onClick={() => { setShowSavedList(v => !v); setShowSaveInput(false); setSaveName(""); }}
                  disabled={savedQueries.length === 0}
                  title={savedQueries.length === 0 ? "Nenhuma query salva" : "Queries salvas"}
                  className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border text-xs font-medium transition-colors disabled:opacity-40 no-drag"
                  style={{
                    borderColor: showSavedList ? "#93c5fd" : "var(--ctrl-inactive-border)",
                    background:  showSavedList ? "rgba(239,246,255,0.5)" : "var(--bg-secondary)",
                    color:       showSavedList ? "#2563eb" : "var(--text-secondary)",
                  }}
                >
                  <BookmarkCheck size={13} />
                  {savedQueries.length > 0 && (
                    <span className="text-[10px] font-bold">{savedQueries.length}</span>
                  )}
                </button>

                {/* Dropdown suspenso — alinhado à esquerda do container */}
                {showSavedList && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-lg z-50"
                    style={{
                      background:  "var(--panel-bg)",
                      borderColor: "var(--ctrl-inactive-border)",
                      maxHeight:   "280px",
                      overflowY:   "auto",
                    }}
                  >
                    <p className="px-3 py-2 text-[10px] font-semibold border-b"
                       style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}>
                      Queries salvas
                    </p>
                    {savedQueries.map((q, i) => (
                      <div
                        key={q.id}
                        className="flex items-center gap-2 px-2.5 py-2 text-[11px]"
                        style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : undefined }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                      >
                        <button
                          onClick={() => handleLoadQuery(q)}
                          className="flex-1 min-w-0 text-left no-drag"
                          title={q.query}
                        >
                          <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {q.name}
                          </p>
                          <p className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {q.query}
                          </p>
                        </button>
                        <button
                          onClick={() => handleDeleteQuery(q.id)}
                          className="shrink-0 p-1 rounded-lg transition-colors no-drag hover:text-red-500"
                          style={{ color: "var(--text-muted)" }}
                          title="Remover"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Input de nome para salvar — inline, não desloca layout */}
              {showSaveInput && (
                <div className="flex gap-2">
                  <input
                    ref={saveInputRef}
                    type="text"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleSaveQuery();
                      if (e.key === "Escape") { setShowSaveInput(false); setSaveName(""); }
                    }}
                    placeholder="Nome da query…"
                    className="flex-1 text-xs px-2.5 py-1.5 border rounded-xl outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100 no-drag"
                    style={{
                      background:  "var(--panel-bg)",
                      borderColor: "var(--ctrl-inactive-border)",
                      color:       "var(--text-primary)",
                    }}
                  />
                  <button
                    onClick={handleSaveQuery}
                    disabled={!saveName.trim()}
                    className="shrink-0 px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition-colors disabled:opacity-40 no-drag"
                  >
                    OK
                  </button>
                </div>
              )}

              <p className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
                Cmd+Enter para executar · máx. 100 resultados
              </p>
            </div>

            {/* Barra de seleção + copiar */}
            {!jqlLoading && jqlExecuted && !jqlError && jqlIssues.length > 0 && (() => {
              const allSelected = jqlIssues.every(i => selectedKeys.has(i.key));
              const anySelected = selectedKeys.size > 0;

              function toggleAll() {
                if (allSelected) {
                  setSelectedKeys(new Set());
                } else {
                  setSelectedKeys(new Set(jqlIssues.map(i => i.key)));
                }
              }

              function copySelected() {
                const selected = jqlIssues.filter(i => selectedKeys.has(i.key));

                // Plain text — fallback para editores sem rich text
                const plain = selected
                  .map(i => `[${i.key}] ${i.summary} [${i.status.name}]`)
                  .join("\n");

                // Rich text — ↗ vira link clicável em Notion, Slack, Docs, email
                const html = [
                  "<meta charset='utf-8'>",
                  ...selected.map(i => {
                    const url = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${i.key}`;
                    return `<span>[${i.key}] ${i.summary} [${i.status.name}] <a href="${url}">↗</a></span>`;
                  }),
                ].join("<br>");

                try {
                  navigator.clipboard.write([
                    new ClipboardItem({
                      "text/plain": new Blob([plain], { type: "text/plain" }),
                      "text/html":  new Blob([html],  { type: "text/html"  }),
                    }),
                  ]).then(() => {
                    setCopyDone(true);
                    setTimeout(() => setCopyDone(false), 2000);
                  });
                } catch {
                  // Fallback para ambientes que não suportam ClipboardItem
                  navigator.clipboard.writeText(plain).then(() => {
                    setCopyDone(true);
                    setTimeout(() => setCopyDone(false), 2000);
                  });
                }
              }

              return (
                <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
                     style={{ borderColor: "var(--border-subtle)" }}>
                  {/* Checkbox marcar todos */}
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = !allSelected && anySelected; }}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer no-drag shrink-0"
                  />
                  <span className="text-[10px] flex-1" style={{ color: "var(--text-secondary)" }}>
                    {anySelected
                      ? `${selectedKeys.size} de ${jqlIssues.length} selecionadas`
                      : `${jqlIssues.length} issues${jqlTruncated ? ` (de ${jqlTotal})` : ""}`}
                  </span>
                  {/* Botão copiar */}
                  <button
                    onClick={copySelected}
                    disabled={!anySelected}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 no-drag"
                    style={{
                      background: anySelected ? (copyDone ? "rgba(34,197,94,0.12)" : "rgba(37,99,235,0.08)") : undefined,
                      color:      anySelected ? (copyDone ? "#16a34a" : "#2563eb") : "var(--text-muted)",
                    }}
                  >
                    {copyDone ? <Check size={12} /> : <Copy size={12} />}
                    {copyDone ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              );
            })()}

            {/* Resultados */}
            <div className="flex-1 overflow-y-auto">
              {jqlLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <Loader2 size={20} className="text-blue-400 animate-spin" />
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Executando query…</p>
                </div>
              ) : jqlError ? (
                <div className="m-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-[11px] font-mono text-red-600 leading-snug whitespace-pre-wrap">{jqlError}</p>
                </div>
              ) : !jqlExecuted ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                       style={{ background: "var(--bg-secondary)" }}>
                    <Terminal size={18} style={{ color: "var(--text-muted)" }} />
                  </div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Escreva uma query JQL acima
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Qualquer JQL válido do Jira é suportado
                  </p>
                </div>
              ) : jqlIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                       style={{ background: "var(--bg-secondary)" }}>
                    <Search size={18} style={{ color: "var(--text-muted)" }} />
                  </div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Nenhum resultado
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {jqlIssues.map(issue => (
                    <JqlIssueCard
                      key={issue.key}
                      issue={issue}
                      jiraBaseUrl={jiraBaseUrl}
                      selected={selectedKeys.has(issue.key)}
                      onToggle={() => setSelectedKeys(prev => {
                        const next = new Set(prev);
                        next.has(issue.key) ? next.delete(issue.key) : next.add(issue.key);
                        return next;
                      })}
                    />
                  ))}
                  {jqlTruncated && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px] leading-snug"
                         style={{ background: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.4)", color: "var(--text-secondary)" }}>
                      <span className="shrink-0 text-yellow-500 font-bold mt-px">⚠</span>
                      <span>
                        Exibindo <strong className="text-yellow-600">100 de {jqlTotal}</strong> issues.
                        Refine a query para ver resultados específicos.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─ Aba Relatório ─ */}
        {activeTab === "report" && (
          reportableColumns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <BarChart2 size={18} style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Nenhuma coluna com limites configurados
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                Configure regras de limite em uma coluna do board para usar o relatório.
              </p>
            </div>
          ) : reportLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Loader2 size={20} className="text-blue-400 animate-spin" />
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Gerando relatório…</p>
            </div>
          ) : reportError ? (
            <div className="m-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-[11px] text-red-600 leading-snug">{reportError}</p>
            </div>
          ) : reportIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <CalendarDays size={18} style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Nenhuma issue concluída no período
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                Nenhuma issue saiu de "{selectedReportCol}" em {periodLabel}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {reportIssues.map(issue => (
                <ReportIssueCard
                  key={issue.key}
                  issue={issue}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`text-sm font-bold ${color}`}>{value}</span>
      <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}

// ─── Card de issue ────────────────────────────────────────────────────────────

function ActivityIssueCard({ issue, jiraBaseUrl }: { issue: ActivityIssue; jiraBaseUrl: string }) {
  const issueUrl = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;
  const priDot = priorityDot[issue.priority?.name ?? ""] ?? "bg-gray-300";

  return (
    <div className="group/card theme-card rounded-xl border px-3 py-2.5 shadow-sm transition-colors">

      {/* Linha superior: key + summary + link */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priDot}`} />
            <span className="text-[11px] font-mono font-semibold text-blue-600 leading-none">
              {issue.key}
            </span>
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
            {issue.summary}
          </p>
        </div>

        {/* Assignee */}
        <div className="shrink-0">
          {issue.assignee?.avatarUrl ? (
            <img
              src={issue.assignee.avatarUrl}
              alt={issue.assignee.displayName}
              title={issue.assignee.displayName}
              className="w-6 h-6 rounded-full border"
              style={{ borderColor: "var(--border-subtle)" }}
            />
          ) : (
            <div className="w-6 h-6 rounded-full flex items-center justify-center"
                 style={{ background: "var(--bg-secondary)" }}>
              <User size={12} style={{ color: "var(--text-secondary)" }} />
            </div>
          )}
        </div>
      </div>

      {/* Transições de status */}
      {issue.transitions.length > 0 ? (
        <div className="space-y-1 mt-1">
          {issue.transitions.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="px-1.5 py-0.5 rounded-md font-medium leading-none whitespace-nowrap"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>
                {t.fromStatus}
              </span>
              <ArrowRight size={9} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium leading-none whitespace-nowrap">
                {t.toStatus}
              </span>
              <span className="truncate ml-auto shrink-0" style={{ color: "var(--text-muted)" }}>
                {formatDateTime(t.at)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1">
            {issue.issuetype?.iconUrl && (
              <img src={issue.issuetype.iconUrl} alt={issue.issuetype.name} className="w-3 h-3 shrink-0" />
            )}
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{issue.issuetype?.name}</span>
            <span className="text-[10px] mx-0.5" style={{ color: "var(--text-muted)" }}>·</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>
              {issue.currentStatusName}
            </span>
          </div>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {formatDateTime(issue.updatedAt)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Ícone de ação do dev ──────────────────────────────────────────────────────

function DevActionIcon({ type }: { type: DevAction["type"] }) {
  if (type === "comment") {
    return <MessageSquare size={10} className="shrink-0 mt-0.5" style={{ color: "#a855f7" }} />;
  }
  if (type === "flag") {
    return <FlagIcon size={10} className="shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />;
  }
  // transition
  return <ArrowRight size={10} className="shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />;
}

// ─── Card de atividade do dev ─────────────────────────────────────────────────

function DevActivityIssueCard({ issue, jiraBaseUrl }: { issue: DevActivityIssue; jiraBaseUrl: string }) {
  const issueUrl = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;
  const priDot = priorityDot[issue.priority?.name ?? ""] ?? "bg-gray-300";

  return (
    <div className="group/card theme-card rounded-xl border px-3 py-2.5 shadow-sm transition-colors">

      {/* Linha superior: key + summary + link */}
      <div className="flex items-start gap-1.5 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${priDot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {issue.issuetype?.iconUrl && (
              <img src={issue.issuetype.iconUrl} alt={issue.issuetype.name}
                   className="w-3 h-3 shrink-0" />
            )}
            <span className="text-[11px] font-mono font-semibold text-blue-600 leading-none">
              {issue.key}
            </span>
            <button
              onClick={() => openExternal(issueUrl)}
              title="Abrir no Jira"
              className="opacity-0 group-hover/card:opacity-100 transition-opacity hover:text-blue-500 no-drag"
              style={{ color: "var(--text-muted)" }}
            >
              <ExternalLink size={10} />
            </button>
          </div>
          <p className="text-xs leading-snug line-clamp-1" style={{ color: "var(--text-primary)" }}>
            {issue.summary}
          </p>
        </div>
      </div>

      {/* Timeline de ações */}
      <div className="space-y-1 ml-3 pl-2 border-l"
           style={{ borderColor: "var(--border-subtle)" }}>
        {issue.actions.map((action, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[10px]">
            <DevActionIcon type={action.type} />
            <p className="flex-1 min-w-0 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {action.label}
            </p>
            <span className="shrink-0 ml-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
              {formatDateTime(action.at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Card do relatório ────────────────────────────────────────────────────────

function ReportIssueCard({ issue, jiraBaseUrl }: { issue: ReportIssue; jiraBaseUrl: string }) {
  const issueUrl = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;
  const priDot   = priorityDot[issue.priority?.name ?? ""] ?? "bg-gray-300";
  const completedDate = new Date(issue.completedAt).toLocaleDateString("pt-BR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="group/card theme-card rounded-xl border px-3 py-2.5 shadow-sm transition-colors">

      {/* Linha superior: key + summary + link + assignee */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priDot}`} />
            {issue.issuetype?.iconUrl && (
              <img src={issue.issuetype.iconUrl} alt={issue.issuetype.name} className="w-3 h-3 shrink-0" />
            )}
            <span className="text-[11px] font-mono font-semibold text-blue-600 leading-none">
              {issue.key}
            </span>
            <button
              onClick={() => openExternal(issueUrl)}
              title="Abrir no Jira"
              className="opacity-0 group-hover/card:opacity-100 transition-opacity hover:text-blue-500 no-drag"
              style={{ color: "var(--text-muted)" }}
            >
              <ExternalLink size={10} />
            </button>
            {/* Data de conclusão */}
            <span className="ml-auto text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
              {completedDate}
            </span>
          </div>
          <p className="text-xs leading-snug line-clamp-2" style={{ color: "var(--text-primary)" }}>
            {issue.summary}
          </p>
        </div>
        {/* Assignee */}
        {issue.assignee && (
          <div className="shrink-0">
            {issue.assignee.avatarUrls["32x32"] ? (
              <img
                src={issue.assignee.avatarUrls["32x32"]}
                alt={issue.assignee.displayName}
                title={issue.assignee.displayName}
                className="w-6 h-6 rounded-full border"
                style={{ borderColor: "var(--border-subtle)" }}
              />
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <User size={12} style={{ color: "var(--text-secondary)" }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Limites */}
      {issue.limits.length > 0 ? (
        <div className="space-y-1.5 mt-1">
          {issue.limits.map((limit, i) => {
            const pct      = (issue.timeInColumnMs / (limit.limitHours * 3_600_000)) * 100;
            const exceeded = pct >= 100;
            const warning  = pct >= 75 && !exceeded;
            const barColor = exceeded ? "#ef4444" : warning ? "#f59e0b" : "#22c55e";
            const StatusIcon = exceeded ? XCircle : warning ? AlertTriangle : CheckCircle2;
            const statusColor = exceeded ? "text-red-500" : warning ? "text-amber-500" : "text-emerald-500";

            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    {limit.label}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
                      {formatTimeInColumn(issue.timeInColumnMs)}
                      <span style={{ color: "var(--text-muted)" }}> / {formatTimeInColumn(limit.limitHours * 3_600_000)}</span>
                    </span>
                    <StatusIcon size={11} className={statusColor} />
                  </div>
                </div>
                {/* Barra de progresso */}
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, pct)}%`, background: barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Sem limites: só mostra o tempo */
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Tempo na coluna:</span>
          <span className="text-[10px] font-mono font-medium" style={{ color: "var(--text-primary)" }}>
            {formatTimeInColumn(issue.timeInColumnMs)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Card de resultado JQL ────────────────────────────────────────────────────

const statusCategoryColor: Record<string, string> = {
  "blue-grey": "bg-gray-100 text-gray-600",
  "yellow":    "bg-yellow-50 text-yellow-700",
  "green":     "bg-emerald-50 text-emerald-700",
};

function JqlIssueCard({
  issue, jiraBaseUrl, selected, onToggle,
}: {
  issue: JqlIssue;
  jiraBaseUrl: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const issueUrl  = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;
  const priDot    = priorityDot[issue.priority?.name ?? ""] ?? "bg-gray-300";
  const statusCls = statusCategoryColor[issue.status.statusCategory.colorName] ?? "bg-gray-100 text-gray-600";
  const updatedDate = new Date(issue.updated).toLocaleDateString("pt-BR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      className="group/card theme-card rounded-xl border px-3 py-2.5 shadow-sm transition-colors cursor-pointer"
      onClick={onToggle}
      style={{ background: selected ? "rgba(239,246,255,0.5)" : undefined, borderColor: selected ? "#93c5fd" : undefined }}
    >
      {/* Linha superior */}
      <div className="flex items-start gap-2 mb-1.5">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className="mt-0.5 w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer no-drag shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priDot}`} />
            {issue.issuetype?.iconUrl && (
              <img src={issue.issuetype.iconUrl} alt={issue.issuetype.name} className="w-3 h-3 shrink-0" />
            )}
            <span className="text-[11px] font-mono font-semibold text-blue-600 leading-none">
              {issue.key}
            </span>
            <button
              onClick={e => { e.stopPropagation(); openExternal(issueUrl); }}
              title="Abrir no Jira"
              className="opacity-0 group-hover/card:opacity-100 transition-opacity hover:text-blue-500 no-drag"
              style={{ color: "var(--text-muted)" }}
            >
              <ExternalLink size={10} />
            </button>
            <span className="ml-auto text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
              {updatedDate}
            </span>
          </div>
          <p className="text-xs leading-snug line-clamp-2" style={{ color: "var(--text-primary)" }}>
            {issue.summary}
          </p>
        </div>
        {/* Assignee */}
        {issue.assignee && (
          <div className="shrink-0">
            {issue.assignee.avatarUrls["32x32"] ? (
              <img
                src={issue.assignee.avatarUrls["32x32"]}
                alt={issue.assignee.displayName}
                title={issue.assignee.displayName}
                className="w-6 h-6 rounded-full border"
                style={{ borderColor: "var(--border-subtle)" }}
              />
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center"
                   style={{ background: "var(--bg-secondary)" }}>
                <User size={12} style={{ color: "var(--text-secondary)" }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Linha inferior: status */}
      <div className="flex items-center gap-1.5 mt-1 ml-[22px]">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium leading-none ${statusCls}`}>
          {issue.status.name}
        </span>
        {issue.issuetype && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            · {issue.issuetype.name}
          </span>
        )}
      </div>
    </div>
  );
}
