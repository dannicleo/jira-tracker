import { RefreshCw, Loader2, Layout } from "lucide-react";
import type { TrackedIssue } from "../types";
import { IssueCard } from "./IssueCard";
import { SearchIssue } from "./SearchIssue";

interface Props {
  issues: TrackedIssue[];
  syncing: boolean;
  hasCredentials: boolean;
  hasMonitorConfig: boolean;
  onSelectIssue: (issue: TrackedIssue) => void;
  onRemoveIssue: (key: string) => Promise<void>;
  onAddIssue: (key: string) => Promise<void>;
  onSync: () => void;
  onNavigate: (view: "board-setup") => void;
}

export function IssueList({
  issues,
  syncing,
  hasCredentials,
  onSelectIssue,
  onRemoveIssue,
  onAddIssue,
  onSync,
  onNavigate,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Header compacto — título + sync */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 drag-region">
        <div className="flex items-center gap-2 no-drag">
          <span className="text-sm font-semibold text-gray-700">Issues</span>
          {issues.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
              {issues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={onSync}
            disabled={syncing || issues.length === 0 || !hasCredentials}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
            title="Sincronizar todos"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Search / Add */}
      {hasCredentials && (
        <div className="border-b border-gray-100">
          <SearchIssue onAdd={onAddIssue} />
        </div>
      )}

      {/* Lista de issues */}
      <div className="flex-1 overflow-y-auto">
        {!hasCredentials ? (
          <EmptyCredentials />
        ) : issues.length === 0 ? (
          <EmptyIssues onBoard={() => onNavigate("board-setup")} />
        ) : (
          <div className="p-2 space-y-1">
            {issues.map((issue) => (
              <IssueCard
                key={issue.issue_key}
                issue={issue}
                onSelect={onSelectIssue}
                onRemove={onRemoveIssue}
              />
            ))}
          </div>
        )}
      </div>

      {/* Syncing indicator */}
      {syncing && (
        <div className="flex items-center justify-center gap-2 py-2 border-t border-gray-100 bg-blue-50">
          <Loader2 size={12} className="text-blue-500 animate-spin" />
          <span className="text-xs text-blue-600">Sincronizando...</span>
        </div>
      )}
    </div>
  );
}

function EmptyIssues({ onBoard }: { onBoard: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-10 text-center px-6">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
        <span className="text-2xl">📋</span>
      </div>
      <p className="text-sm font-medium text-gray-600">Nenhum issue trackeado</p>
      <p className="text-xs text-gray-400 mt-1 mb-4">
        Digite uma chave acima ou importe direto de um board
      </p>
      <button
        onClick={onBoard}
        className="px-4 py-2 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
      >
        <Layout size={12} />
        Importar do Board
      </button>
    </div>
  );
}

function EmptyCredentials() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-10 text-center px-6">
      <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
        <span className="text-2xl">🔑</span>
      </div>
      <p className="text-sm font-medium text-gray-700">Configure o Jira</p>
      <p className="text-xs text-gray-400 mt-1">
        Adicione suas credenciais pela engrenagem na sidebar
      </p>
    </div>
  );
}
