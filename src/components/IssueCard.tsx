import { Trash2 } from "lucide-react";
import type { TrackedIssue } from "../types";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  issue: TrackedIssue;
  onSelect: (issue: TrackedIssue) => void;
  onRemove: (issueKey: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  indeterminate: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
};

export function IssueCard({ issue, onSelect, onRemove }: Props) {
  const statusStyle = STATUS_STYLES[issue.status_category] ?? "bg-gray-100 text-gray-600";
  const lastSynced = formatDistanceToNow(new Date(issue.last_synced), {
    addSuffix: true,
    locale: ptBR,
  });

  return (
    <div
      className="group relative flex flex-col gap-1 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors border border-transparent hover:border-gray-100"
      onClick={() => onSelect(issue)}
    >
      {/* Header: key + type + remove */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-600 font-mono">
            {issue.issue_key}
          </span>
          <span className="text-xs text-gray-400">{issue.issue_type}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-drag">
          <button
            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(issue.issue_key);
            }}
            title="Parar de trackear"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-800 leading-tight line-clamp-2">
        {issue.summary}
      </p>

      {/* Footer: status + assignee + sync */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle}`}>
            {issue.status}
          </span>
          {issue.priority && (
            <PriorityDot priority={issue.priority} />
          )}
        </div>

        <div className="flex items-center gap-2">
          {issue.assignee_name && (
            <span className="text-xs text-gray-400 truncate max-w-[80px]">
              {issue.assignee_name.split(" ")[0]}
            </span>
          )}
          <span className="text-xs text-gray-300">{lastSynced}</span>
        </div>
      </div>
    </div>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    Highest: "bg-red-500",
    High: "bg-orange-500",
    Medium: "bg-yellow-500",
    Low: "bg-blue-400",
    Lowest: "bg-blue-300",
  };
  const color = colors[priority] ?? "bg-gray-300";
  return (
    <span
      className={`w-2 h-2 rounded-full ${color} inline-block`}
      title={`Prioridade: ${priority}`}
    />
  );
}
