/**
 * IssueDetailPanel — painel lateral com o detalhe completo de uma issue.
 *
 * Aparece à esquerda do ColumnPanel (mesmo mecanismo do ColumnConfigPanel).
 * Ao montar, busca o detalhe completo via REST API (descrição, reporter,
 * labels, comentários, histórico de status).
 */
import { useState, useEffect, useRef } from "react";
import {
  X, ExternalLink, Loader2, User, Tag, Clock,
  MessageSquare, ArrowRight, AlertTriangle, RefreshCw,
  ChevronDown, ChevronUp, Paperclip, ImageOff,
} from "lucide-react";
import type { AppSettings, JiraBoardIssue } from "../types";
import {
  fetchIssueDetail, jiraFetchBlob,
  type IssueDetail, type IssueAttachment,
  formatTimeInColumn,
} from "../services/jira";
import { open } from "@tauri-apps/plugin-shell";

async function openExternal(url: string) {
  try { await open(url); }
  catch { window.open(url, "_blank", "noopener,noreferrer"); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Cor do badge de status baseada na statusCategory do Jira */
function statusBadgeStyle(colorName: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    "blue-grey": { background: "rgba(100,116,139,0.12)", color: "#475569" },
    "yellow":    { background: "rgba(234,179,8,0.12)",  color: "#92400e" },
    "green":     { background: "rgba(34,197,94,0.12)",  color: "#166534" },
    "blue":      { background: "rgba(59,130,246,0.12)", color: "#1e40af" },
    "red":       { background: "rgba(239,68,68,0.12)",  color: "#991b1b" },
  };
  return map[colorName] ?? { background: "var(--bg-secondary)", color: "var(--text-secondary)" };
}

const priorityColors: Record<string, string> = {
  Highest: "text-red-500",
  High:    "text-orange-400",
  Medium:  "text-yellow-500",
  Low:     "text-blue-400",
  Lowest:  "text-gray-400",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  issue:      JiraBoardIssue;
  settings:   AppSettings;
  jiraBaseUrl: string;
  onClose:    () => void;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function IssueDetailPanel({ issue, settings, jiraBaseUrl, onClose }: Props) {
  const [detail,   setDetail]   = useState<IssueDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);

  const issueUrl = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchIssueDetail(issue.key, settings);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar detalhes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [issue.key]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full panel-content">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b drag-region shrink-0"
           style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2 min-w-0">
          {issue.fields.issuetype?.iconUrl && (
            <img src={issue.fields.issuetype.iconUrl}
                 alt={issue.fields.issuetype.name}
                 className="w-4 h-4 shrink-0" />
          )}
          <span className="text-xs font-mono font-semibold text-blue-600 leading-none truncate">
            {issue.key}
          </span>
          <button
            onClick={() => openExternal(issueUrl)}
            title="Abrir no Jira"
            className="shrink-0 hover:text-blue-500 transition-colors no-drag"
            style={{ color: "var(--text-muted)" }}
          >
            <ExternalLink size={11} />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={load}
            disabled={loading}
            title="Recarregar"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 no-drag"
            style={{ color: "var(--text-secondary)" }}
          >
            {loading
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
          </button>
          <button
            onClick={onClose}
            title="Fechar"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors no-drag"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Corpo ───────────────────────────────────────────────────────────── */}
      {loading && !detail ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2">
          <Loader2 size={18} className="text-blue-400 animate-spin" />
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Carregando…</p>
        </div>
      ) : error && !detail ? (
        <div className="m-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-600 leading-snug">{error}</p>
          </div>
          <button
            onClick={load}
            className="mt-2 text-[11px] text-blue-600 hover:underline no-drag"
          >
            Tentar novamente
          </button>
        </div>
      ) : detail ? (
        <div className="flex-1 overflow-y-auto">
          <DetailBody
            detail={detail}
            issue={issue}
            settings={settings}
            showAllHistory={showAllHistory}
            setShowAllHistory={setShowAllHistory}
            showAllComments={showAllComments}
            setShowAllComments={setShowAllComments}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Corpo do detalhe ─────────────────────────────────────────────────────────

function DetailBody({
  detail, issue, settings,
  showAllHistory, setShowAllHistory,
  showAllComments, setShowAllComments,
}: {
  detail: IssueDetail;
  issue: JiraBoardIssue;
  settings: AppSettings;
  showAllHistory: boolean;
  setShowAllHistory: (v: boolean) => void;
  showAllComments: boolean;
  setShowAllComments: (v: boolean) => void;
}) {
  const statusHistory = detail.history.filter(h => h.field === "status");
  const visibleHistory = showAllHistory ? statusHistory : statusHistory.slice(0, 4);
  const visibleComments = showAllComments ? detail.comments : detail.comments.slice(0, 2);

  return (
    <div className="px-3 py-3 space-y-4">

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
          {detail.summary}
        </p>
      </div>

      {/* ── Badges: status + flag ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={statusBadgeStyle(detail.status.statusCategory?.colorName ?? "")}
        >
          {detail.status.name}
        </span>
        {issue.isFlagged && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: "rgba(254,242,242,0.5)", color: "#dc2626", border: "1px solid #fecaca" }}>
            <AlertTriangle size={9} />
            Impedimento
          </span>
        )}
        {detail.priority && (
          <span className={`text-[10px] font-medium ${priorityColors[detail.priority.name] ?? "text-gray-400"}`}>
            {detail.priority.name}
          </span>
        )}
      </div>

      {/* ── Metadados ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">

        {/* Assignee */}
        <MetaRow icon={<User size={11} style={{ color: "var(--text-muted)" }} />} label="Responsável">
          {detail.assignee ? (
            <div className="flex items-center gap-1.5">
              {detail.assignee.avatarUrl
                ? <img src={detail.assignee.avatarUrl} alt={detail.assignee.displayName}
                       className="w-4 h-4 rounded-full" />
                : <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                    <User size={8} style={{ color: "var(--text-secondary)" }} />
                  </div>}
              <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
                {detail.assignee.displayName}
              </span>
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Não atribuído</span>
          )}
        </MetaRow>

        {/* Reporter */}
        {detail.reporter && (
          <MetaRow icon={<User size={11} style={{ color: "var(--text-muted)" }} />} label="Reportado por">
            <div className="flex items-center gap-1.5">
              {detail.reporter.avatarUrl
                ? <img src={detail.reporter.avatarUrl} alt={detail.reporter.displayName}
                       className="w-4 h-4 rounded-full" />
                : <div className="w-4 h-4 rounded-full bg-gray-200" />}
              <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
                {detail.reporter.displayName}
              </span>
            </div>
          </MetaRow>
        )}

        {/* Time in column */}
        {typeof issue.timeInColumnMs === "number" && issue.timeInColumnMs > 0 && (
          <MetaRow icon={<Clock size={11} style={{ color: "var(--text-muted)" }} />} label="Tempo na coluna">
            <span className="text-[11px] font-mono" style={{ color: "var(--text-primary)" }}>
              {formatTimeInColumn(issue.timeInColumnMs)}
            </span>
          </MetaRow>
        )}

        {/* Criado */}
        <MetaRow icon={<Clock size={11} style={{ color: "var(--text-muted)" }} />} label="Criado">
          <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
            {formatDate(detail.created)}
          </span>
        </MetaRow>

        {/* Atualizado */}
        <MetaRow icon={<Clock size={11} style={{ color: "var(--text-muted)" }} />} label="Atualizado">
          <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
            {formatDate(detail.updated)}
          </span>
        </MetaRow>

        {/* Parent */}
        {detail.parent && (
          <MetaRow icon={<Tag size={11} style={{ color: "var(--text-muted)" }} />} label="Épico/Pai">
            <span className="text-[11px] font-mono text-blue-600">{detail.parent.key}</span>
            <span className="text-[11px] ml-1 truncate" style={{ color: "var(--text-secondary)" }}>
              {detail.parent.summary}
            </span>
          </MetaRow>
        )}

        {/* Labels */}
        {detail.labels.length > 0 && (
          <MetaRow icon={<Tag size={11} style={{ color: "var(--text-muted)" }} />} label="Labels">
            <div className="flex flex-wrap gap-1">
              {detail.labels.map(l => (
                <span key={l}
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>
                  {l}
                </span>
              ))}
            </div>
          </MetaRow>
        )}
      </div>

      {/* ── Descrição ───────────────────────────────────────────────────────── */}
      {detail.description && (
        <Section title="Descrição">
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap"
             style={{ color: "var(--text-secondary)" }}>
            {detail.description.length > 600
              ? detail.description.slice(0, 600).trimEnd() + "…"
              : detail.description}
          </p>
        </Section>
      )}

      {/* ── Imagens ─────────────────────────────────────────────────────────── */}
      {(() => {
        const imgs = detail.attachments.filter(a => a.mimeType.startsWith("image/"));
        if (imgs.length === 0) return null;
        return (
          <Section title={`Imagens (${imgs.length})`}>
            <div className="grid grid-cols-2 gap-2">
              {imgs.map(att => (
                <AuthImage
                  key={att.id}
                  attachment={att}
                  settings={settings}
                />
              ))}
            </div>
          </Section>
        );
      })()}

      {/* ── Anexos (não-imagem) ──────────────────────────────────────────────── */}
      {(() => {
        const files = detail.attachments.filter(a => !a.mimeType.startsWith("image/"));
        if (files.length === 0) return null;
        return (
          <Section title={`Anexos (${files.length})`}>
            <div className="space-y-1">
              {files.map(att => (
                <div key={att.id}
                     className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border"
                     style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                  <Paperclip size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <span className="flex-1 text-[11px] truncate" style={{ color: "var(--text-primary)" }}>
                    {att.filename}
                  </span>
                  <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    {formatBytes(att.size)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        );
      })()}

      {/* ── Histórico de status ──────────────────────────────────────────────── */}
      {statusHistory.length > 0 && (
        <Section title={`Histórico de status (${statusHistory.length})`}>
          <div className="space-y-1.5">
            {visibleHistory.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>
                  {h.fromString || "—"}
                </span>
                <ArrowRight size={8} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 leading-none whitespace-nowrap">
                  {h.toString}
                </span>
                <span className="ml-auto shrink-0 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {formatDateTime(h.created)}
                </span>
              </div>
            ))}
          </div>
          {statusHistory.length > 4 && (
            <button
              onClick={() => setShowAllHistory(!showAllHistory)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 transition-colors no-drag"
            >
              {showAllHistory
                ? <><ChevronUp size={10} />Mostrar menos</>
                : <><ChevronDown size={10} />Ver {statusHistory.length - 4} mais</>}
            </button>
          )}
        </Section>
      )}

      {/* ── Comentários ─────────────────────────────────────────────────────── */}
      {detail.comments.length > 0 && (
        <Section title={`Comentários (${detail.comments.length})`}>
          <div className="space-y-2.5">
            {visibleComments.map((c) => (
              <div key={c.id} className="rounded-xl px-2.5 py-2 border"
                   style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                <div className="flex items-center gap-1.5 mb-1">
                  {c.author.avatarUrl
                    ? <img src={c.author.avatarUrl} alt={c.author.displayName}
                           className="w-4 h-4 rounded-full shrink-0" />
                    : <div className="w-4 h-4 rounded-full bg-gray-200 shrink-0 flex items-center justify-center">
                        <User size={8} style={{ color: "var(--text-secondary)" }} />
                      </div>}
                  <span className="text-[10px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {c.author.displayName}
                  </span>
                  <span className="ml-auto text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    {formatDate(c.created)}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed whitespace-pre-wrap"
                   style={{ color: "var(--text-secondary)" }}>
                  {c.body.length > 200 ? c.body.slice(0, 200).trimEnd() + "…" : c.body}
                </p>
              </div>
            ))}
          </div>
          {detail.comments.length > 2 && (
            <button
              onClick={() => setShowAllComments(!showAllComments)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 transition-colors no-drag"
            >
              {showAllComments
                ? <><ChevronUp size={10} />Mostrar menos</>
                : <><ChevronDown size={10} /><MessageSquare size={9} />Ver {detail.comments.length - 2} mais</>}
            </button>
          )}
        </Section>
      )}

      <div className="pb-2" />
    </div>
  );
}

// ─── Utilitários de layout ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
         style={{ color: "var(--text-muted)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function MetaRow({
  icon, label, children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center gap-1.5 w-24 shrink-0 mt-0.5">
        {icon}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

// ─── Formata tamanho em bytes ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Imagem autenticada (blob URL) ────────────────────────────────────────────

/**
 * Faz download da imagem com autenticação Jira e exibe via blob URL.
 * Usa a thumbnail quando disponível (menor, carrega mais rápido);
 * clicando na imagem abre a versão completa no navegador.
 */
function AuthImage({
  attachment,
  settings,
}: {
  attachment: IssueAttachment;
  settings: AppSettings;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  // Mantemos a ref para revogar o blob URL quando desmontar
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Prefere thumbnail (menor), senão baixa o conteúdo completo
        const url = attachment.thumbnail ?? attachment.content;
        const blob = await jiraFetchBlob(url, settings);
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobRef.current = objectUrl;
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [attachment.id]);   // re-executa se a issue mudar

  if (loading) {
    return (
      <div className="w-full rounded-lg border flex items-center justify-center"
           style={{ minHeight: 64, background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}>
        <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="w-full rounded-lg border flex flex-col items-center justify-center gap-1 py-3"
           style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}>
        <ImageOff size={14} style={{ color: "var(--text-muted)" }} />
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Falha ao carregar</span>
      </div>
    );
  }

  return (
    <button
      title={`${attachment.filename} · ${formatBytes(attachment.size)}`}
      onClick={() => openExternal(attachment.content)}
      className="w-full rounded-lg border overflow-hidden no-drag group/img relative"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <img
        src={blobUrl}
        alt={attachment.filename}
        className="w-full object-cover"
        style={{ maxHeight: 160 }}
      />
      {/* Overlay ao hover para indicar que é clicável */}
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors flex items-center justify-center">
        <ExternalLink
          size={14}
          className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow"
        />
      </div>
      {/* Nome do arquivo */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-black/30
                      opacity-0 group-hover/img:opacity-100 transition-opacity">
        <p className="text-[9px] text-white truncate">{attachment.filename}</p>
      </div>
    </button>
  );
}
