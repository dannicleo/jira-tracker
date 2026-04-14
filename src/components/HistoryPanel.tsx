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
  MessageSquare, Flag as FlagIcon, ListChecks,
} from "lucide-react";
import type { AppSettings, ActivityIssue, DevActivityIssue, DevAction } from "../types";
import {
  fetchActivityHistory, fetchDevActivity, fetchCurrentUserAccountId,
  searchJiraUsers, type JiraUser,
} from "../services/jira";
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
  settings: AppSettings;
  projectKey?: string;
  jiraBaseUrl: string;
}

export function HistoryPanel({ settings, projectKey, jiraBaseUrl }: Props) {
  // Abas
  const [activeTab, setActiveTab] = useState<"assigned" | "activity">("assigned");

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

  // Dispara o fetch da aba ativa ao mudar período, usuário ou aba
  useEffect(() => {
    if (activeTab === "assigned") fetchData(periodStart, periodEnd);
    else                          fetchDevData(periodStart, periodEnd);
  }, [periodStart, periodEnd, activeTab, fetchData, fetchDevData]);

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
          onClick={() => activeTab === "assigned"
            ? fetchData(periodStart, periodEnd)
            : fetchDevData(periodStart, periodEnd)}
          disabled={loading || devLoading}
          title="Atualizar"
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 no-drag shrink-0"
          style={{ color: "var(--text-secondary)" }}
        >
          {(loading || devLoading)
            ? <Loader2 size={13} className="animate-spin" />
            : <RefreshCw size={13} />}
        </button>
      </div>

      {/* ── Abas ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center px-3 gap-0.5 shrink-0 border-b"
           style={{ borderColor: "var(--border-subtle)" }}>
        {(["assigned", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors no-drag"
            style={{
              color:        activeTab === tab ? "#2563eb" : "var(--text-secondary)",
              borderBottom: activeTab === tab ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {tab === "assigned"
              ? <><ListChecks size={11} />Issues Atribuídas</>
              : <><FlagIcon size={11} />Atividade do Dev</>}
          </button>
        ))}
      </div>

      {/* ── Filtro por pessoa ──────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
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
      </div>

      {/* ── Navegação de período ───────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b shrink-0 space-y-2"
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
      </div>

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
