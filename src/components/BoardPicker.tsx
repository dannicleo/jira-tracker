import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  ChevronRight,
  CheckSquare,
  Square,
  Check,
  AlertCircle,
  Search,
} from "lucide-react";
import type {
  AppSettings,
  JiraProject,
  JiraBoard,
  JiraSprint,
  JiraBoardIssue,
} from "../types";
import {
  fetchProjects,
  fetchBoardsByProject,
  fetchActiveSprint,
  fetchSprintIssues,
  fetchBoardIssues,
} from "../services/jira";

interface Props {
  settings: AppSettings;
  onBack: () => void;
  onAddIssues: (keys: string[]) => Promise<void>;
}

type Step = "projects" | "boards" | "issues";

export function BoardPicker({ settings, onBack, onAddIssues }: Props) {
  const [step, setStep] = useState<Step>("projects");

  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);

  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<JiraBoard | null>(null);

  const [activeSprint, setActiveSprint] = useState<JiraSprint | null>(null);
  const [issues, setIssues] = useState<JiraBoardIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Carrega projetos ao montar
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchProjects(settings);
        setProjects(data);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [settings]);

  async function handleSelectProject(project: JiraProject) {
    setSelectedProject(project);
    setStep("boards");
    setLoading(true);
    setError(null);
    setBoards([]);
    setSelectedBoard(null);

    try {
      const data = await fetchBoardsByProject(project.key, settings);

      if (data.length === 0) {
        setError(`Nenhum board encontrado para o projeto "${project.name}".`);
        setLoading(false);
        return;
      }

      // Se só tiver um board, já avança direto para as issues
      if (data.length === 1) {
        setBoards(data);
        await loadBoardIssues(data[0]);
        return;
      }

      setBoards(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectBoard(board: JiraBoard) {
    setSelectedBoard(board);
    setLoading(true);
    setError(null);
    await loadBoardIssues(board);
    setLoading(false);
  }

  async function loadBoardIssues(board: JiraBoard) {
    setSelectedBoard(board);
    setIssues([]);
    setSelected(new Set());
    setActiveSprint(null);
    setError(null);

    const isKanban = board.type === "kanban";

    try {
      if (isKanban) {
        // Kanban: busca issues direto do board (sem sprint)
        const boardIssues = await fetchBoardIssues(board.id, settings);
        setIssues(boardIssues);
        setStep("issues");
      } else {
        // Scrum: busca sprint ativa e depois as issues dela
        const sprint = await fetchActiveSprint(board.id, settings);
        if (!sprint) {
          setError(`Nenhuma sprint ativa no board "${board.name}".`);
          return;
        }
        setActiveSprint(sprint);
        const sprintIssues = await fetchSprintIssues(sprint.id, settings);
        setIssues(sprintIssues);
        setStep("issues");
      }
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleIssue(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      selected.size === issues.length
        ? new Set()
        : new Set(issues.map((i) => i.key))
    );
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await onAddIssues(Array.from(selected));
      onBack();
    } catch (e) {
      setError(String(e));
      setAdding(false);
    }
  }

  function handleBack() {
    if (step === "issues") {
      // Volta para boards (se tinha mais de um) ou para projetos
      if (boards.length > 1) {
        setStep("boards");
        setIssues([]);
        setSelected(new Set());
        setActiveSprint(null);
        setError(null);
      } else {
        setStep("projects");
        setSelectedProject(null);
        setBoards([]);
        setIssues([]);
        setSelected(new Set());
        setActiveSprint(null);
        setError(null);
      }
    } else if (step === "boards") {
      setStep("projects");
      setSelectedProject(null);
      setBoards([]);
      setError(null);
    } else {
      onBack();
    }
  }

  // Projetos filtrados pelo search
  const filteredProjects = projectSearch.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
          p.key.toLowerCase().includes(projectSearch.toLowerCase())
      )
    : projects;

  // ─── Header dinâmico ───────────────────────────────────────────────────────
  const title =
    step === "projects"
      ? "Selecionar Projeto"
      : step === "boards"
        ? selectedProject?.name ?? "Selecionar Board"
        : selectedBoard?.name ?? "Issues";

  const subtitle =
    step === "boards"
      ? `Projeto: ${selectedProject?.key}`
      : step === "issues"
        ? activeSprint
          ? `Sprint: ${activeSprint.name}`
          : selectedBoard?.type === "kanban"
            ? "Kanban · todas as issues"
            : undefined
        : undefined;

  return (
    <div className="flex flex-col h-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 drag-region">
        <button
          onClick={handleBack}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-700 truncate block">
            {title}
          </span>
          {subtitle && (
            <span className="text-xs text-gray-400 truncate block">{subtitle}</span>
          )}
        </div>
        {step === "issues" && issues.length > 0 && (
          <span className="text-xs text-gray-400 no-drag shrink-0">
            {selected.size}/{issues.length}
          </span>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">
        {/* Erro */}
        {error && (
          <div className="mx-3 mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex gap-2">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 size={16} className="text-blue-500 animate-spin" />
            <span className="text-xs text-gray-400">Carregando...</span>
          </div>
        )}

        {/* ── STEP: Projetos ─────────────────────────────────────────────────── */}
        {!loading && step === "projects" && !error && (
          <div className="flex flex-col">
            {/* Busca */}
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Buscar projeto ou chave (ex: AUT)..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  autoFocus
                />
              </div>
            </div>

            {/* Lista */}
            <div className="p-2 space-y-px">
              {filteredProjects.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">
                  Nenhum projeto encontrado
                </p>
              )}
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors group"
                >
                  {/* Avatar do projeto */}
                  {project.avatarUrls?.["48x48"] ? (
                    <img
                      src={project.avatarUrls["48x48"]}
                      alt=""
                      className="w-7 h-7 rounded shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-600">
                        {project.key.slice(0, 2)}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {project.name}
                    </p>
                    <p className="text-xs text-gray-400">{project.key}</p>
                  </div>

                  <ChevronRight
                    size={14}
                    className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP: Boards ───────────────────────────────────────────────────── */}
        {!loading && step === "boards" && !error && (
          <div className="p-2 space-y-px">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => handleSelectBoard(board)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">
                    {board.name}
                  </p>
                  <p className="text-xs text-gray-400 capitalize">{board.type}</p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0 ml-2"
                />
              </button>
            ))}
          </div>
        )}

        {/* ── STEP: Issues da Sprint ─────────────────────────────────────────── */}
        {!loading && step === "issues" && !error && (
          <div className="pb-2">
            {/* Selecionar todos */}
            <button
              onClick={toggleAll}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 border-b border-gray-100 transition-colors"
            >
              {selected.size === issues.length && issues.length > 0 ? (
                <CheckSquare size={13} className="text-blue-500" />
              ) : (
                <Square size={13} />
              )}
              {selected.size === issues.length && issues.length > 0
                ? "Desmarcar todos"
                : "Selecionar todos"}
            </button>

            {issues.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">
                Nenhuma issue nesta sprint
              </p>
            )}

            <div className="space-y-px p-2">
              {issues.map((issue) => {
                const isSelected = selected.has(issue.key);
                const statusKey = issue.fields.status.statusCategory.key;
                const dotColor =
                  statusKey === "done"
                    ? "bg-green-400"
                    : statusKey === "indeterminate"
                      ? "bg-yellow-400"
                      : "bg-blue-400";

                return (
                  <button
                    key={issue.key}
                    onClick={() => toggleIssue(issue.key)}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50 border border-blue-100"
                        : "hover:bg-gray-50 border border-transparent"
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                        isSelected
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-300"
                      }`}
                    >
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>

                    {/* Conteúdo */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-mono text-gray-500 shrink-0">
                          {issue.key}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-xs text-gray-400 truncate">
                          {issue.fields.status.name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-700 leading-snug line-clamp-2">
                        {issue.fields.summary}
                      </p>
                      {issue.fields.assignee && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {issue.fields.assignee.displayName}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer — botão adicionar */}
      {step === "issues" && selected.size > 0 && (
        <div className="px-3 py-3 border-t border-gray-100">
          <button
            onClick={handleAdd}
            disabled={adding}
            className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {adding && <Loader2 size={14} className="animate-spin" />}
            {adding
              ? "Adicionando..."
              : `Rastrear ${selected.size} issue${selected.size > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
