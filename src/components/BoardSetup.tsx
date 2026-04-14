/**
 * BoardSetup — seleção de projeto e board (2 passos).
 * Após selecionar o board, chama onConfigured com o SelectedBoardConfig.
 * As colunas NÃO são selecionadas aqui — todas aparecem automaticamente na sidebar.
 */
import { useState, useEffect } from "react";
import {
  ArrowLeft, Loader2, ChevronRight, AlertCircle, Search, LayoutGrid,
} from "lucide-react";
import type { AppSettings, JiraProject, JiraBoard, SelectedBoardConfig } from "../types";
import { fetchProjects, fetchBoardsByProject, fetchActiveSprint } from "../services/jira";

interface Props {
  settings: AppSettings;
  currentConfig: SelectedBoardConfig | null;
  onBack: () => void;
  onConfigured: (config: SelectedBoardConfig) => void;
}

type Step = "projects" | "boards";

export function BoardSetup({ settings, currentConfig, onBack, onConfigured }: Props) {
  const [step, setStep]               = useState<Step>("projects");
  const [projects, setProjects]       = useState<JiraProject[]>([]);
  const [search, setSearch]           = useState("");
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);
  const [boards, setBoards]           = useState<JiraBoard[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Carrega projetos ao montar
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
      // Se só há um board, avança direto
      if (data.length === 1) await handleSelectBoard(project, data[0]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectBoard(project: JiraProject, board: JiraBoard) {
    setLoading(true);
    setError(null);
    try {
      // Para boards Scrum, já busca a sprint ativa para armazenar no config
      let sprintId: number | undefined;
      let sprintName: string | undefined;
      if (board.type !== "kanban") {
        const sprint = await fetchActiveSprint(board.id, settings);
        sprintId   = sprint?.id;
        sprintName = sprint?.name;
      }

      const config: SelectedBoardConfig = {
        boardId:              board.id,
        boardName:            board.name,
        boardType:            board.type,
        projectKey:           project.key,
        sprintId,
        sprintName,
        syncIntervalMinutes:  5,
      };
      onConfigured(config);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    if (step === "boards") {
      setStep("projects");
      setSelectedProject(null);
      setBoards([]);
      setError(null);
    } else {
      onBack();
    }
  }

  const filtered = search.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.key.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  const subtitle = step === "boards" ? `Projeto: ${selectedProject?.key}` : undefined;

  return (
    <div className="flex flex-col h-full panel-content">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 drag-region shrink-0">
        <button
          onClick={handleBack}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-700 block truncate">
            {step === "projects" ? "Selecionar Board" : selectedProject?.name ?? "Boards"}
          </span>
          {subtitle && (
            <span className="text-xs text-gray-400 block">{subtitle}</span>
          )}
        </div>
        {currentConfig && (
          <span className="text-[10px] text-gray-400 no-drag">atual: {currentConfig.boardName}</span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Erro */}
        {error && (
          <div className="mx-3 mt-3 p-3 bg-red-50 border border-red-100 rounded-xl flex gap-2">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-14 gap-2">
            <Loader2 size={16} className="text-blue-500 animate-spin" />
            <span className="text-xs text-gray-400">Carregando...</span>
          </div>
        )}

        {/* ── Passo 1: Projetos ────────────────────────────────────────────── */}
        {!loading && step === "projects" && !error && (
          <>
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar projeto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-300"
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  autoFocus
                />
              </div>
            </div>
            <div className="p-2 space-y-px">
              {filtered.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors group"
                >
                  {project.avatarUrls?.["48x48"] ? (
                    <img src={project.avatarUrls["48x48"]} alt="" className="w-7 h-7 rounded shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-[11px] font-bold text-blue-600">{project.key.slice(0, 2)}</span>
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
          </>
        )}

        {/* ── Passo 2: Boards ──────────────────────────────────────────────── */}
        {!loading && step === "boards" && !error && boards.length > 1 && (
          <div className="p-2 space-y-px">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => handleSelectBoard(selectedProject!, board)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 text-left transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                  <LayoutGrid size={14} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{board.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{board.type}</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
