/**
 * MonitorSetup — fluxo de configuração do monitor de coluna
 * Passo 1: Projeto → Passo 2: Board → Passo 3: Coluna
 * Salva BoardMonitorConfig e navega para o MonitorView.
 */
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  ChevronRight,
  AlertCircle,
  Search,
  Columns,
} from "lucide-react";
import type {
  AppSettings,
  JiraProject,
  JiraBoard,
  JiraBoardColumn,
  JiraSprint,
  BoardMonitorConfig,
} from "../types";
import {
  fetchProjects,
  fetchBoardsByProject,
  fetchBoardColumns,
  fetchActiveSprint,
} from "../services/jira";

interface Props {
  settings: AppSettings;
  onBack: () => void;
  onConfigured: (config: BoardMonitorConfig) => void;
}

type Step = "projects" | "boards" | "columns";

export function MonitorSetup({ settings, onBack, onConfigured }: Props) {
  const [step, setStep] = useState<Step>("projects");

  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);

  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<JiraBoard | null>(null);
  const [activeSprint, setActiveSprint] = useState<JiraSprint | null>(null);

  const [columns, setColumns] = useState<JiraBoardColumn[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega projetos
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        setProjects(await fetchProjects(settings));
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
    try {
      const data = await fetchBoardsByProject(project.key, settings);
      if (data.length === 0) {
        setError(`Nenhum board encontrado para "${project.name}".`);
        return;
      }
      setBoards(data);
      // Se só tem um board, avança direto
      if (data.length === 1) await handleSelectBoard(data[0]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectBoard(board: JiraBoard) {
    setSelectedBoard(board);
    setStep("columns");
    setLoading(true);
    setError(null);
    try {
      const [cols, sprint] = await Promise.all([
        fetchBoardColumns(board.id, settings),
        board.type !== "kanban" ? fetchActiveSprint(board.id, settings) : Promise.resolve(null),
      ]);
      // Filtra colunas que têm pelo menos um status mapeado
      setColumns(cols.filter((c) => c.statuses.length > 0));
      setActiveSprint(sprint);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleSelectColumn(column: JiraBoardColumn) {
    if (!selectedBoard || !selectedProject) return;

    const config: BoardMonitorConfig = {
      boardId: selectedBoard.id,
      boardName: selectedBoard.name,
      boardType: selectedBoard.type,
      projectKey: selectedProject.key,
      columnName: column.name,
      columnStatusIds: column.statuses.map((s) => s.id),
      sprintId: activeSprint?.id,
      sprintName: activeSprint?.name,
      syncIntervalMinutes: 10,
      maxColumnHours: 8,
    };

    onConfigured(config);
  }

  function handleBack() {
    if (step === "columns") {
      if (boards.length > 1) {
        setStep("boards");
        setColumns([]);
        setError(null);
      } else {
        setStep("projects");
        setSelectedProject(null);
        setBoards([]);
        setColumns([]);
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

  const filteredProjects = projectSearch.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
          p.key.toLowerCase().includes(projectSearch.toLowerCase())
      )
    : projects;

  const title =
    step === "projects"
      ? "Monitor · Projeto"
      : step === "boards"
        ? selectedProject?.name ?? "Monitor · Board"
        : `Monitor · Coluna`;

  const subtitle =
    step === "boards"
      ? `Projeto: ${selectedProject?.key}`
      : step === "columns"
        ? `${selectedProject?.key} · ${selectedBoard?.name}`
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
          <span className="text-sm font-semibold text-gray-700 truncate block">{title}</span>
          {subtitle && (
            <span className="text-xs text-gray-400 truncate block">{subtitle}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-3 mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex gap-2">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 size={16} className="text-blue-500 animate-spin" />
            <span className="text-xs text-gray-400">Carregando...</span>
          </div>
        )}

        {/* ── Projetos ───────────────────────────────────────────────────────── */}
        {!loading && step === "projects" && !error && (
          <div className="flex flex-col">
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar projeto ou chave (ex: AUT)..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-300"
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  autoFocus
                />
              </div>
            </div>
            <div className="p-2 space-y-px">
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors group"
                >
                  {project.avatarUrls?.["48x48"] ? (
                    <img src={project.avatarUrls["48x48"]} alt="" className="w-7 h-7 rounded shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-600">{project.key.slice(0, 2)}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{project.name}</p>
                    <p className="text-xs text-gray-400">{project.key}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Boards ─────────────────────────────────────────────────────────── */}
        {!loading && step === "boards" && !error && boards.length > 1 && (
          <div className="p-2 space-y-px">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => handleSelectBoard(board)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{board.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{board.type}</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 shrink-0 ml-2" />
              </button>
            ))}
          </div>
        )}

        {/* ── Colunas ────────────────────────────────────────────────────────── */}
        {!loading && step === "columns" && !error && (
          <div className="flex flex-col">
            <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Selecione a coluna que deseja monitorar. O app acompanhará todas as issues nesta coluna em tempo real.
              </p>
            </div>
            <div className="p-2 space-y-px">
              {columns.map((col) => (
                <button
                  key={col.name}
                  onClick={() => handleSelectColumn(col)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 text-left transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Columns size={13} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">{col.name}</p>
                    <p className="text-xs text-gray-400">
                      {col.statuses.length} status{col.statuses.length !== 1 ? "es" : ""}
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
