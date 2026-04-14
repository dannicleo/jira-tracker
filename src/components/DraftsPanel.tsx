/**
 * DraftsPanel — lista de rascunhos de issues Jira armazenados localmente.
 *
 * O formulário de criação/edição foi movido para DraftFormPanel, que aparece
 * como um painel secundário (mesmo padrão de ColumnConfigPanel).
 *
 * Este componente gerencia apenas a lista:
 *   - Exibe os cards colapsados
 *   - Botão "+ Novo" → chama onNew
 *   - Clicar num card → chama onEdit(draft)
 *   - activeDraftId → destaca o card que está sendo editado no painel lateral
 */
import { Plus, Pencil } from "lucide-react";
import type { IssueDraft, CachedIssueType } from "../types";
import { getDrafts } from "../services/db";
import { IssueTypeIcon, PriorityIcon, DEFAULT_TYPES } from "./DraftFormPanel";

// ─── Tempo relativo ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "agora";
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

// ─── Card colapsado ───────────────────────────────────────────────────────────

function DraftCard({
  draft,
  issueTypes,
  active,
  onExpand,
}: {
  draft:      IssueDraft;
  issueTypes: CachedIssueType[];
  active:     boolean;
  onExpand:   () => void;
}) {
  const types   = issueTypes.length > 0 ? issueTypes : DEFAULT_TYPES;
  const typeObj = types.find((t) => t.name === draft.type) ?? {
    id: draft.type, name: draft.type, subtask: false, cachedAt: "",
  };

  return (
    <button
      onClick={onExpand}
      className="w-full text-left rounded-xl border px-3 py-2.5 transition-all group"
      style={{
        borderColor: active ? "var(--accent, #3b82f6)" : "var(--border-subtle)",
        background:  active ? "var(--sidebar-active-bg, rgba(59,130,246,0.08))" : "var(--card-bg)",
        boxShadow:   active ? "0 0 0 1px var(--accent, #3b82f6)" : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          <IssueTypeIcon type={typeObj} size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-xs font-medium leading-snug truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {draft.title || <span style={{ color: "var(--text-muted)" }}>Sem título</span>}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <PriorityIcon p={draft.priority} />
            {draft.labels.length > 0 && (
              <span
                className="text-[9px] truncate max-w-[100px]"
                style={{ color: "var(--text-muted)" }}
              >
                {draft.labels.slice(0, 2).join(", ")}
                {draft.labels.length > 2 ? "…" : ""}
              </span>
            )}
            <span className="text-[9px] ml-auto" style={{ color: "var(--text-muted)" }}>
              {timeAgo(draft.updatedAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  issueTypes:    CachedIssueType[];
  activeDraftId: string | null; // ID do rascunho aberto no painel lateral
  onNew:         () => void;
  onEdit:        (draft: IssueDraft) => void;
}

// ─── Painel principal ─────────────────────────────────────────────────────────

export function DraftsPanel({ issueTypes, activeDraftId, onNew, onEdit }: Props) {
  // Lê do localStorage a cada render (getDrafts é síncrono e barato)
  const drafts = getDrafts();

  return (
    <div className="flex flex-col h-full panel-content">

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b drag-region shrink-0"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Rascunhos
          </p>
          <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
            {drafts.length === 0
              ? "Nenhum rascunho"
              : `${drafts.length} rascunho${drafts.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={onNew}
          title="Novo rascunho"
          className="no-drag flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
                     bg-blue-500 hover:bg-blue-600 text-white transition-colors"
        >
          <Plus size={12} /> Novo
        </button>
      </div>

      {/* Corpo */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">

        {/* Empty state */}
        {drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: "var(--bg-secondary)" }}
            >
              <Pencil size={18} style={{ color: "var(--text-muted)" }} />
            </div>
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Nenhum rascunho ainda
            </p>
            <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
              Clique em "+ Novo" para criar o primeiro
            </p>
          </div>
        )}

        {/* Lista */}
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            issueTypes={issueTypes}
            active={activeDraftId === draft.id}
            onExpand={() => onEdit(draft)}
          />
        ))}
      </div>
    </div>
  );
}
