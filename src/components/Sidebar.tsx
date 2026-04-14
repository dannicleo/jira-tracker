/**
 * Sidebar — barra vertical de ícones flutuante.
 *
 * Cada coluna recebe um ícone semântico + cor baseada na categoria de status do Jira:
 *   Azul   → To Do  (To Code Review, To Test, To Deploy, Todo…)
 *   Âmbar  → In Progress  (In Code Review, In Test, In Progress…)
 *   Verde  → Done  (Production, Done, Released…)
 *   Neutro → colunas sem correspondência conhecida
 */
import { useCallback } from "react";
import {
  Settings, LayoutGrid, RefreshCw, Loader2, AlertCircle, Bell, History, PenLine, GripVertical,
  // Ícones semânticos de coluna
  Circle,          // Todo / genérico "to do"
  Zap,             // In Progress
  GitPullRequest,  // Code Review
  FlaskConical,    // Test / QA
  Server,          // Homolog / Staging
  Rocket,          // Deploy / Release
  Globe,           // Production
  CheckCircle2,    // Done / Completed
  Layers,          // Fallback genérico
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppView, SelectedBoardConfig, BoardColumnWithIssues } from "../types";

// ─── Mapeamento de ícones e cores ────────────────────────────────────────────

/** Categorias de status (espelham as do Jira) */
type StatusCategory = "todo" | "inprogress" | "done" | "neutral";

interface ColumnStyle {
  Icon: LucideIcon;
  category: StatusCategory;
  /** Classe Tailwind para a cor do ícone */
  iconColor: string;
  /** Classe Tailwind para o badge */
  badgeColor: string;
}

/**
 * Determina o ícone e a cor de uma coluna com base no nome.
 *
 * Regras (ordem de precedência):
 *  1. Conteúdo específico (code review, test, homolog, deploy, production, done, progress)
 *  2. Prefixo de estado ("to " → azul, "in " → âmbar)
 *  3. Fallback neutro
 */
function getColumnStyle(columnName: string): ColumnStyle {
  const n = columnName.toLowerCase().trim();

  // ── Detecta conteúdo semântico ───────────────────────────────────────────
  const isCodeReview = n.includes("code review") || n.includes("review");
  const isTest       = n.includes("test") || n.includes("qa") || n.includes("quality");
  const isHomolog    = n.includes("homolog") || n.includes("staging") || n.includes("uat");
  const isDeploy     = n.includes("deploy") || n.includes("release");
  const isProd       = n === "production" || n === "prod" || n.includes("production");
  const isDone       = n === "done" || n.includes("done") || n === "completed" || n === "finished" || n === "released";
  const isProgress   = n === "in progress" || n.includes("progress");
  const isTodo       = n === "todo" || n === "to do" || n === "backlog" || n === "open" || n === "new";

  // ── Detecta prefixo de estado ────────────────────────────────────────────
  const prefixTo = n.startsWith("to ") || n === "todo" || n === "to do";
  const prefixIn = n.startsWith("in ") || isProgress;

  // ── Categoria final ──────────────────────────────────────────────────────
  let category: StatusCategory;
  if (isDone || isProd)  category = "done";
  else if (prefixIn)     category = "inprogress";
  else if (prefixTo || isTodo) category = "todo";
  else                   category = "neutral";

  // ── Cores por categoria ──────────────────────────────────────────────────
  const palette: Record<StatusCategory, { icon: string; badge: string }> = {
    todo:       { icon: "text-blue-400",  badge: "bg-blue-500"  },
    inprogress: { icon: "text-amber-400", badge: "bg-amber-500" },
    done:       { icon: "text-green-400", badge: "bg-green-500" },
    neutral:    { icon: "text-white/50",  badge: "bg-slate-500" },
  };
  const { icon: iconColor, badge: badgeColor } = palette[category];

  // ── Ícone por conteúdo ───────────────────────────────────────────────────
  let Icon: LucideIcon = Layers; // fallback

  if (isDone)       Icon = CheckCircle2;
  else if (isProd)  Icon = Globe;
  else if (isDeploy)Icon = Rocket;
  else if (isHomolog) Icon = Server;
  else if (isTest)  Icon = FlaskConical;
  else if (isCodeReview) Icon = GitPullRequest;
  else if (isProgress)   Icon = Zap;
  else if (isTodo || prefixTo) Icon = Circle;

  return { Icon, category, iconColor, badgeColor };
}

// ─── Componente principal ────────────────────────────────────────────────────

interface SidebarProps {
  activeView: AppView | null;
  activeColumnName: string | null;
  onToggle: (view: AppView) => void;
  onSelectColumn: (name: string) => void;
  hasCredentials: boolean;
  boardConfig: SelectedBoardConfig | null;
  columns: BoardColumnWithIssues[];
  syncing: boolean;
  syncError: string | null;
  onSync: () => void;
  alertCount: number;
  draftCount: number;
}

export function Sidebar({
  activeView,
  activeColumnName,
  onToggle,
  onSelectColumn,
  hasCredentials,
  boardConfig,
  columns,
  syncing,
  syncError,
  onSync,
  alertCount,
  draftCount,
}: SidebarProps) {
  // Usa startDragging() — forma mais confiável em Tauri v2 com janelas
  // transparentes sem decorações (data-tauri-drag-region e -webkit-app-region
  // podem não funcionar dependendo da versão do WKWebView).
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch(() => {});
  }, []);

  return (
    <div className="sidebar-bar w-14 flex flex-col items-center pb-3 gap-0.5 shrink-0">

      {/* ── Drag handle — arraste para mover a barra ─────── */}
      <div
        onMouseDown={handleDragStart}
        style={{ cursor: "grab", height: 28, flexShrink: 0 }}
        className="w-full flex items-center justify-center select-none"
        title="Arraste para mover"
      >
        <GripVertical
          size={14}
          style={{ color: "var(--sidebar-icon)", opacity: 0.3, pointerEvents: "none" }}
        />
      </div>

      {/* ── Configurações ─────────────────────────────────── */}
      <SidebarBtn
        active={activeView === "settings"}
        onClick={() => onToggle("settings")}
        title="Configurações"
      >
        <Settings size={18} />
      </SidebarBtn>

      {/* ── Alertas ───────────────────────────────────────── */}
      <div className="relative">
        <SidebarBtn
          active={activeView === "alerts"}
          onClick={() => onToggle("alerts")}
          title={alertCount > 0 ? `${alertCount} alerta${alertCount > 1 ? "s" : ""} ativo${alertCount > 1 ? "s" : ""}` : "Alertas"}
        >
          <Bell size={18} />
        </SidebarBtn>
        {alertCount > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[16px] h-4
            bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center
            justify-center px-0.5 leading-none shadow-sm animate-pulse">
            {alertCount > 9 ? "9+" : alertCount}
          </span>
        )}
      </div>

      {/* ── Histórico ─────────────────────────────────────── */}
      <SidebarBtn
        active={activeView === "history"}
        onClick={() => onToggle("history")}
        title="Histórico de atividade"
      >
        <History size={18} />
      </SidebarBtn>

      {/* ── Rascunhos ─────────────────────────────────────── */}
      <div className="relative">
        <SidebarBtn
          active={activeView === "drafts"}
          onClick={() => onToggle("drafts")}
          title={draftCount > 0 ? `${draftCount} rascunho${draftCount !== 1 ? "s" : ""}` : "Rascunhos"}
        >
          <PenLine size={18} />
        </SidebarBtn>
        {draftCount > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[16px] h-4
            bg-indigo-500 text-white text-[9px] font-bold rounded-full flex items-center
            justify-center px-0.5 leading-none shadow-sm">
            {draftCount > 9 ? "9+" : draftCount}
          </span>
        )}
      </div>

      <Separator />

      {/* ── Sem credenciais ───────────────────────────────── */}
      {!hasCredentials && (
        <div className="flex-1 flex items-center">
          <span className="text-[8px] text-center leading-tight px-1" style={{ color: "var(--sidebar-icon)" }}>
            Configure<br />o Jira
          </span>
        </div>
      )}

      {/* ── Sem board: botão de seleção ───────────────────── */}
      {hasCredentials && !boardConfig && (
        <SidebarBtn
          active={activeView === "board-setup"}
          onClick={() => onToggle("board-setup")}
          title="Selecionar board"
        >
          <LayoutGrid size={18} />
        </SidebarBtn>
      )}

      {/* ── Board selecionado: colunas como ícones ────────── */}
      {hasCredentials && boardConfig && (
        <>
          {/* Botão de troca de board */}
          <button
            onClick={() => onToggle("board-setup")}
            title={`Board: ${boardConfig.boardName} · clique para trocar`}
            className="no-drag relative w-11 flex flex-col items-center justify-center rounded-xl transition-all py-1.5 gap-[3px] mb-0.5"
            style={{
              background: activeView === "board-setup" ? "var(--sidebar-active-bg)" : "transparent",
              color:      activeView === "board-setup" ? "var(--sidebar-icon-hover)" : "var(--sidebar-icon)",
            }}
          >
            <LayoutGrid size={16} />
            <span className="text-[8px] font-bold tracking-wide leading-none">
              {boardConfig.projectKey}
            </span>
          </button>

          {/* Ícones de coluna — rola com scroll do mouse quando não cabem */}
          <div className="sidebar-scroll flex-1 flex flex-col items-center gap-0.5 w-full py-0.5">
            {columns.map((col) => (
              <ColumnBtn
                key={col.name}
                column={col}
                active={activeView === "column" && activeColumnName === col.name}
                onClick={() => onSelectColumn(col.name)}
              />
            ))}
            {columns.length === 0 && syncing && (
              <Loader2 size={13} className="text-white/30 animate-spin mt-2" />
            )}
            {columns.length === 0 && !syncing && syncError && (
              <button
                onClick={onSync}
                title={`Erro: ${syncError}\nClique para tentar novamente`}
                className="no-drag mt-2 flex flex-col items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
              >
                <AlertCircle size={15} />
                <span className="text-[8px] text-center leading-tight px-1">
                  erro<br />sync
                </span>
              </button>
            )}
            {columns.length === 0 && !syncing && !syncError && (
              <span className="text-[8px] text-center px-1 mt-2" style={{ color: "var(--sidebar-icon)" }}>
                carregando<br />colunas…
              </span>
            )}
          </div>
        </>
      )}

      <Separator />

      {/* ── Sync ──────────────────────────────────────────── */}
      <button
        onClick={onSync}
        disabled={syncing || !hasCredentials || !boardConfig}
        title={syncing ? "Atualizando…" : "Atualizar board"}
        className="no-drag w-11 h-11 flex items-center justify-center rounded-xl transition-all disabled:opacity-25"
        style={{ color: "var(--sidebar-icon)" }}
      >
        {syncing
          ? <Loader2 size={17} className="animate-spin" />
          : <RefreshCw size={17} />}
      </button>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SidebarBtn({
  active, onClick, title, children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="no-drag relative w-11 h-11 flex items-center justify-center rounded-xl transition-all"
      style={{
        background: active ? "var(--sidebar-active-bg)" : "transparent",
        color:      active ? "var(--sidebar-icon-hover)" : "var(--sidebar-icon)",
      }}
    >
      {children}
    </button>
  );
}

/** Botão de coluna com ícone semântico + cor de categoria + badge de contagem */
function ColumnBtn({
  column, active, onClick,
}: {
  column: BoardColumnWithIssues;
  active: boolean;
  onClick: () => void;
}) {
  const { Icon, iconColor, badgeColor } = getColumnStyle(column.name);
  const count = column.issues.length;

  // Abreviação: primeiras letras de cada palavra (máx 2)
  const abbr = column.name
    .split(/[\s\-_]+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <button
      onClick={onClick}
      title={`${column.name} · ${count} issue${count !== 1 ? "s" : ""}`}
      className="no-drag relative w-11 flex flex-col items-center justify-center rounded-xl transition-all py-2 gap-[3px]"
      style={{ background: active ? "var(--sidebar-active-bg)" : "transparent" }}
    >
      {/* Barra lateral de destaque — visível apenas quando ativo */}
      {active && (
        <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full ${badgeColor}`} />
      )}

      {/* Ícone semântico com cor de categoria */}
      <span
        className={`transition-colors ${active ? iconColor : ""}`}
        style={active ? { filter: "brightness(1.3)" } : { color: "var(--sidebar-icon)" }}
      >
        <Icon size={17} />
      </span>

      {/* Abreviação micro */}
      <span
        className="text-[8px] font-bold tracking-wide leading-none transition-colors"
        style={{ color: active ? "var(--sidebar-icon-hover)" : "var(--sidebar-icon)" }}
      >
        {abbr}
      </span>

      {/* Badge de contagem */}
      {count > 0 && (
        <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px]
          ${active ? badgeColor : badgeColor + " opacity-80"}
          text-white text-[9px] font-bold rounded-full flex items-center justify-center
          px-0.5 leading-none shadow-sm`}>
          {count > 99 ? "99+" : count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

function Separator() {
  return <div className="w-6 h-px my-1.5" style={{ background: "var(--sidebar-sep)" }} />;
}
