import { useState, useEffect } from "react";
import { ArrowLeft, RefreshCw, Clock, User, Tag, Calendar, Plus } from "lucide-react";
import type { TrackedIssue, IssueSnapshot, IssueInsight, AppSettings } from "../types";
import { getSnapshots, getInsights, saveInsight } from "../services/db";
import { fetchAndTrackIssue, calculateTimeInStatus, calculateDaysOpen } from "../services/jira";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  issue: TrackedIssue;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (updated: TrackedIssue) => void;
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  indeterminate: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
};

export function IssueDetail({ issue, settings, onBack, onUpdate }: Props) {
  const [snapshots, setSnapshots] = useState<IssueSnapshot[]>([]);
  const [insights, setInsights] = useState<IssueInsight[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "insights">("overview");

  useEffect(() => {
    loadData();
  }, [issue.issue_key]);

  async function loadData() {
    const [snaps, ins] = await Promise.all([
      getSnapshots(issue.issue_key),
      getInsights(issue.issue_key),
    ]);
    setSnapshots(snaps);
    setInsights(ins);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const updated = await fetchAndTrackIssue(issue.issue_key, settings);
      onUpdate(updated);
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    await saveInsight({
      issue_key: issue.issue_key,
      type: "note",
      label: "Nota",
      value: JSON.stringify({ text: noteText.trim() }),
      created_at: new Date().toISOString(),
    });
    setNoteText("");
    setAddingNote(false);
    await loadData();
  }

  const timeInStatus = calculateTimeInStatus(snapshots);
  const daysOpen = calculateDaysOpen(issue.created_at);
  const statusStyle = STATUS_STYLES[issue.status_category] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="flex flex-col h-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 drag-region">
        <button
          onClick={onBack}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-xs font-mono font-semibold text-blue-600 no-drag">
          {issue.issue_key}
        </span>
        <div className="flex-1 drag-region" />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 no-drag"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">
        {/* Summary + Status */}
        <div className="px-3 py-3 border-b border-gray-50">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusStyle}`}>
              {issue.status}
            </span>
            <span className="text-xs text-gray-400">{issue.issue_type}</span>
          </div>
          <h2 className="text-sm font-medium text-gray-800 leading-snug">
            {issue.summary}
          </h2>
        </div>

        {/* Meta info */}
        <div className="px-3 py-3 grid grid-cols-2 gap-2 border-b border-gray-50">
          <MetaItem
            icon={<User size={11} />}
            label="Responsável"
            value={issue.assignee_name ?? "Não atribuído"}
          />
          <MetaItem
            icon={<Tag size={11} />}
            label="Prioridade"
            value={issue.priority}
          />
          <MetaItem
            icon={<Calendar size={11} />}
            label="Criado"
            value={`${daysOpen}d atrás`}
          />
          <MetaItem
            icon={<Clock size={11} />}
            label="Atualizado"
            value={formatDistanceToNow(new Date(issue.updated_at), {
              locale: ptBR,
              addSuffix: true,
            })}
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(["overview", "history", "insights"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "text-blue-600 border-b-2 border-blue-500"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab === "overview" && "Visão Geral"}
              {tab === "history" && "Histórico"}
              {tab === "insights" && "Insights"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-3 py-3">
          {activeTab === "overview" && (
            <OverviewTab issue={issue} timeInStatus={timeInStatus} daysOpen={daysOpen} />
          )}
          {activeTab === "history" && (
            <HistoryTab snapshots={snapshots} />
          )}
          {activeTab === "insights" && (
            <InsightsTab
              insights={insights}
              noteText={noteText}
              addingNote={addingNote}
              setNoteText={setNoteText}
              setAddingNote={setAddingNote}
              onAddNote={handleAddNote}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-gray-400">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xs font-medium text-gray-700 truncate">{value}</span>
    </div>
  );
}

function OverviewTab({
  issue,
  timeInStatus,
  daysOpen,
}: {
  issue: TrackedIssue;
  timeInStatus: ReturnType<typeof calculateTimeInStatus>;
  daysOpen: number;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Tempo em cada status
        </p>
        {timeInStatus.length === 0 ? (
          <p className="text-xs text-gray-400">Sem histórico de status ainda</p>
        ) : (
          <div className="space-y-2">
            {timeInStatus.map((item) => (
              <div key={item.status} className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{item.status}</span>
                <span className="text-xs font-mono font-medium text-gray-700">
                  {item.durationHuman}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="text-xs text-blue-600 font-medium">
          Issue aberta há <strong>{daysOpen} dias</strong>
        </p>
        <p className="text-xs text-blue-400 mt-0.5">
          Trackeado desde{" "}
          {format(new Date(issue.tracked_since), "dd/MM/yyyy", { locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

function HistoryTab({ snapshots }: { snapshots: IssueSnapshot[] }) {
  if (snapshots.length === 0) {
    return (
      <p className="text-xs text-gray-400 text-center py-4">
        Nenhuma mudança registrada ainda
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {snapshots.map((snap, idx) => {
        const data = JSON.parse(snap.snapshot_data ?? "{}");
        return (
          <div key={snap.id ?? idx} className="flex gap-2 items-start">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-gray-700">
                {data.initial
                  ? `Início do tracking: ${snap.status}`
                  : `${data.prev_status} → ${data.new_status}`}
              </p>
              <p className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(snap.captured_at), {
                  addSuffix: true,
                  locale: ptBR,
                })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InsightsTab({
  insights,
  noteText,
  addingNote,
  setNoteText,
  setAddingNote,
  onAddNote,
}: {
  insights: IssueInsight[];
  noteText: string;
  addingNote: boolean;
  setNoteText: (v: string) => void;
  setAddingNote: (v: boolean) => void;
  onAddNote: () => void;
}) {
  return (
    <div className="space-y-3">
      {insights.map((insight, idx) => {
        const data = JSON.parse(insight.value ?? "{}");
        return (
          <div key={insight.id ?? idx} className="p-2 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">{insight.label}</span>
              <span className="text-xs text-gray-400">
                {format(new Date(insight.created_at), "dd/MM HH:mm")}
              </span>
            </div>
            <p className="text-xs text-gray-700">{data.text ?? insight.value}</p>
          </div>
        );
      })}

      {addingNote ? (
        <div className="space-y-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Digite sua nota..."
            className="w-full text-xs p-2 rounded-lg border border-gray-200 resize-none outline-none focus:ring-2 focus:ring-blue-400 no-drag"
            rows={3}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onAddNote}
              disabled={!noteText.trim()}
              className="flex-1 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              Salvar
            </button>
            <button
              onClick={() => { setAddingNote(false); setNoteText(""); }}
              className="flex-1 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingNote(true)}
          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
        >
          <Plus size={12} />
          Adicionar nota
        </button>
      )}
    </div>
  );
}
