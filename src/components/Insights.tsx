import { ArrowLeft } from "lucide-react";
import type { TrackedIssue } from "../types";
import { calculateDaysOpen } from "../services/jira";

interface Props {
  issues: TrackedIssue[];
  onNavigate: (view: null) => void;
}

export function Insights({ issues, onNavigate }: Props) {
  const totalIssues = issues.length;
  const byCategory = {
    new: issues.filter((i) => i.status_category === "new").length,
    indeterminate: issues.filter((i) => i.status_category === "indeterminate").length,
    done: issues.filter((i) => i.status_category === "done").length,
  };

  const oldestIssues = [...issues]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, 3);

  const staleIssues = issues.filter((i) => {
    const daysSinceUpdate =
      (Date.now() - new Date(i.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate > 7 && i.status_category !== "done";
  });

  const byProject: Record<string, number> = {};
  for (const issue of issues) {
    byProject[issue.project_key] = (byProject[issue.project_key] ?? 0) + 1;
  }

  return (
    <div className="flex flex-col h-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 drag-region">
        <button
          onClick={() => onNavigate(null)}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-gray-700">Insights</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Cards de resumo */}
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Total" value={totalIssues} color="blue" />
          <SummaryCard label="Em andamento" value={byCategory.indeterminate} color="yellow" />
          <SummaryCard label="Concluídos" value={byCategory.done} color="green" />
        </div>

        {/* Distribuição por status */}
        {totalIssues > 0 && (
          <Section title="Distribuição por status">
            <div className="space-y-2">
              <ProgressBar
                label="A fazer"
                count={byCategory.new}
                total={totalIssues}
                color="bg-blue-400"
              />
              <ProgressBar
                label="Em andamento"
                count={byCategory.indeterminate}
                total={totalIssues}
                color="bg-amber-400"
              />
              <ProgressBar
                label="Concluído"
                count={byCategory.done}
                total={totalIssues}
                color="bg-green-400"
              />
            </div>
          </Section>
        )}

        {/* Issues paradas (sem update > 7 dias) */}
        {staleIssues.length > 0 && (
          <Section title="Atenção: sem atualização há +7 dias">
            <div className="space-y-1">
              {staleIssues.map((issue) => (
                <div
                  key={issue.issue_key}
                  className="flex items-center justify-between p-2 bg-orange-50 rounded-lg"
                >
                  <span className="text-xs font-mono font-semibold text-orange-600">
                    {issue.issue_key}
                  </span>
                  <span className="text-xs text-orange-500">
                    {Math.floor(
                      (Date.now() - new Date(issue.updated_at).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )}d sem update
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Issues mais antigas */}
        {oldestIssues.length > 0 && (
          <Section title="Issues abertas há mais tempo">
            <div className="space-y-1">
              {oldestIssues.map((issue) => (
                <div
                  key={issue.issue_key}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                >
                  <div>
                    <span className="text-xs font-mono font-semibold text-blue-600">
                      {issue.issue_key}
                    </span>
                    <p className="text-xs text-gray-500 truncate max-w-[180px]">
                      {issue.summary}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {calculateDaysOpen(issue.created_at)}d
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Por projeto */}
        {Object.keys(byProject).length > 1 && (
          <Section title="Por projeto">
            <div className="space-y-1">
              {Object.entries(byProject)
                .sort(([, a], [, b]) => b - a)
                .map(([project, count]) => (
                  <div
                    key={project}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-xs font-mono font-semibold text-gray-600">
                      {project}
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {count} issue{count !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
            </div>
          </Section>
        )}

        {totalIssues === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-gray-400">
              Nenhum dado disponível ainda.
            </p>
            <p className="text-xs text-gray-300 mt-1">
              Adicione issues para ver insights.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "yellow" | "green" | "red";
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-700",
    yellow: "bg-amber-50 text-amber-700",
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
  };

  return (
    <div className={`rounded-xl p-3 text-center ${styles[color]}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function ProgressBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
