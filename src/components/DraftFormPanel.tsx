/**
 * DraftFormPanel — painel secundário para criar/editar um rascunho de issue Jira.
 *
 * Segue o mesmo padrão de ColumnConfigPanel e IssueDetailPanel:
 *   - Aparece ao lado do DraftsPanel (à esquerda ou direita, conforme panelSide)
 *   - Header com título + botão fechar
 *   - Corpo com scroll contendo o formulário completo
 */
import { useState, useRef } from "react";
import {
  X, Trash2,
  BookOpen, Bug, CheckSquare, Layers, GitBranch,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus,
} from "lucide-react";
import type { IssueDraft, DraftPriority, CachedIssueType } from "../types";


/** Tipos padrão usados quando o cache do Jira ainda não foi carregado */
export const DEFAULT_TYPES: CachedIssueType[] = [
  { id: "story",   name: "Story",    subtask: false, cachedAt: "" },
  { id: "bug",     name: "Bug",      subtask: false, cachedAt: "" },
  { id: "task",    name: "Task",     subtask: false, cachedAt: "" },
  { id: "epic",    name: "Epic",     subtask: false, cachedAt: "" },
  { id: "subtask", name: "Sub-task", subtask: true,  cachedAt: "" },
];

// ─── Ícone de tipo ────────────────────────────────────────────────────────────

function TypeIconFallback({ name, size = 12 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  const props = { size };
  if (n.includes("bug"))  return <Bug        {...props} className="text-red-500" />;
  if (n.includes("epic")) return <Layers     {...props} className="text-purple-500" />;
  if (n.includes("sub"))  return <GitBranch  {...props} className="text-gray-400" />;
  if (n.includes("task")) return <CheckSquare {...props} className="text-blue-500" />;
  return                         <BookOpen   {...props} className="text-green-500" />;
}

export function IssueTypeIcon({ type, size = 12 }: { type: CachedIssueType; size?: number }) {
  if (type.iconUrl) {
    return (
      <img
        src={type.iconUrl}
        alt={type.name}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      />
    );
  }
  return <TypeIconFallback name={type.name} size={size} />;
}

// ─── Prioridade ───────────────────────────────────────────────────────────────

export const PRIORITIES: { value: DraftPriority; color: string }[] = [
  { value: "Highest", color: "#ef4444" },
  { value: "High",    color: "#f97316" },
  { value: "Medium",  color: "#eab308" },
  { value: "Low",     color: "#60a5fa" },
  { value: "Lowest",  color: "#93c5fd" },
];

export function PriorityIcon({ p, size = 11 }: { p: DraftPriority; size?: number }) {
  const props = { size };
  switch (p) {
    case "Highest": return <ChevronsUp   {...props} className="text-red-500" />;
    case "High":    return <ArrowUp      {...props} className="text-orange-500" />;
    case "Medium":  return <Minus        {...props} className="text-yellow-500" />;
    case "Low":     return <ArrowDown    {...props} className="text-blue-400" />;
    case "Lowest":  return <ChevronsDown {...props} className="text-blue-300" />;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  draft:       IssueDraft;
  isNew:       boolean;
  issueTypes:  CachedIssueType[];
  projectKey?: string;
  onSave:      (draft: IssueDraft) => void;
  onClose:     () => void;
  onDelete?:   () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function DraftFormPanel({
  draft: initialDraft,
  isNew,
  issueTypes,
  projectKey,
  onSave,
  onClose,
  onDelete,
}: Props) {
  const [draft, setDraft]           = useState<IssueDraft>(initialDraft);
  const [labelInput, setLabelInput] = useState("");
  const [deleteConfirm, setConfirm] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

const types = issueTypes.length > 0 ? issueTypes : DEFAULT_TYPES;

  const set = (patch: Partial<IssueDraft>) =>
    setDraft((d) => ({ ...d, ...patch, updatedAt: new Date().toISOString() }));

  function addLabel(raw: string) {
    const tag = raw.trim().replace(/,+$/, "");
    if (!tag || draft.labels.includes(tag)) return;
    set({ labels: [...draft.labels, tag] });
    setLabelInput("");
  }

function handleSave() {
    if (!draft.title.trim()) { titleRef.current?.focus(); return; }
    onSave({ ...draft, updatedAt: new Date().toISOString() });
  }

  const currentTypeObj = types.find((t) => t.name === draft.type) ?? types[0];

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--panel-bg)" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b shrink-0"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {isNew ? "Novo rascunho" : "Editar rascunho"}
        </p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg transition-colors hover:bg-black/10"
          style={{ color: "var(--text-muted)" }}
          title="Fechar"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Corpo ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Seletor de tipo */}
        <div className="flex items-center gap-2">
          <IssueTypeIcon type={currentTypeObj} size={14} />
          <select
            value={draft.type}
            onChange={(e) => set({ type: e.target.value })}
            className="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none border transition-colors appearance-none cursor-pointer"
            style={{
              background:  "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color:       "var(--text-primary)",
            }}
          >
            {types.map((t) => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Título */}
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            Título <span className="text-red-400">*</span>
          </label>
          <input
            ref={titleRef}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Título da issue"
            className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none border transition-colors"
            style={{
              background:  "var(--bg-secondary)",
              borderColor: draft.title.trim() ? "var(--border-subtle)" : "#fca5a5",
              color:       "var(--text-primary)",
            }}
          />
        </div>

        {/* Prioridade */}
        <div>
          <label className="block text-[10px] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
            Prioridade
          </label>
          <div className="flex items-center gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                onClick={() => set({ priority: p.value })}
                title={p.value}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{
                  background: draft.priority === p.value ? p.color + "22" : "transparent",
                  border: `1px solid ${draft.priority === p.value ? p.color : "transparent"}`,
                }}
              >
                <PriorityIcon p={p.value} />
              </button>
            ))}
            <span className="text-[10px] ml-1" style={{ color: "var(--text-muted)" }}>
              {draft.priority}
            </span>
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            Descrição
          </label>
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Descreva a issue (opcional)"
            rows={4}
            className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none border resize-none transition-colors"
            style={{
              background:  "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color:       "var(--text-primary)",
            }}
          />
        </div>

        {/* Epic/Pai + Projeto */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              Epic / Pai
            </label>
            <input
              value={draft.parentKey ?? ""}
              onChange={(e) => set({ parentKey: e.target.value.toUpperCase() })}
              placeholder="ex: AUT-10"
              className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none border transition-colors"
              style={{
                background:  "var(--bg-secondary)",
                borderColor: "var(--border-subtle)",
                color:       "var(--text-primary)",
              }}
            />
          </div>
          {!projectKey && (
            <div className="w-28">
              <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Projeto <span className="text-red-400">*</span>
              </label>
              <input
                value={draft.projectKey ?? ""}
                onChange={(e) => set({ projectKey: e.target.value.toUpperCase() })}
                placeholder="ex: AUT"
                className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none border transition-colors"
                style={{
                  background:  "var(--bg-secondary)",
                  borderColor: !draft.projectKey?.trim() ? "#fca5a5" : "var(--border-subtle)",
                  color:       "var(--text-primary)",
                }}
              />
            </div>
          )}
        </div>

        {/* Labels */}
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            Labels
          </label>
          {draft.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {draft.labels.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                >
                  {tag}
                  <button
                    onClick={() => set({ labels: draft.labels.filter((l) => l !== tag) })}
                    className="hover:text-red-400 transition-colors"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addLabel(labelInput);
              }
            }}
            onBlur={() => addLabel(labelInput)}
            placeholder="Adicione labels (Enter ou vírgula)"
            className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none border transition-colors"
            style={{
              background:  "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color:       "var(--text-primary)",
            }}
          />
        </div>


      </div>

      {/* ── Rodapé com ações ────────────────────────────────────────────────── */}
      <div
        className="shrink-0 border-t px-3 py-2.5 space-y-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {/* Botão de excluir — com confirmação */}
        {onDelete && (
          <div className="flex items-center">
            {deleteConfirm ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Confirmar exclusão?
                </span>
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={() => setConfirm(false)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X size={13} />
                  </button>
                  <button
                    onClick={onDelete}
                    className="p-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
                    title="Confirmar exclusão"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirm(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-500"
                style={{ color: "var(--text-muted)" }}
              >
                <Trash2 size={12} />
                Excluir
              </button>
            )}
          </div>
        )}

        {/* Salvar rascunho */}
        <button
          onClick={handleSave}
          className="w-full py-1.5 text-xs rounded-lg border font-medium transition-colors"
          style={{
            background:  "var(--bg-secondary)",
            borderColor: "var(--border-subtle)",
            color:       "var(--text-primary)",
          }}
        >
          Salvar rascunho
        </button>
      </div>
    </div>
  );
}
