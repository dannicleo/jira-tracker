/**
 * App — shell principal com layout sidebar + painel.
 *
 * Visual:
 *   [painel (flex-1, bg branco)]  [sidebar (48px, bg escuro)]
 *
 * Jornada principal:
 *   1. Usuário abre o app → sidebar mostra "selecionar board"
 *   2. Seleciona projeto → board → colunas aparecem como ícones na sidebar
 *   3. Clica num ícone de coluna → painel abre com as issues da coluna
 *   4. Auto-refresh a cada N minutos (configurável)
 */
import { useState, useRef, useCallback, useEffect } from "react";
import type { AppView } from "./types";
import { useIssues }             from "./hooks/useIssues";
import { useBoardView }          from "./hooks/useBoardView";
import { useWindowResize }       from "./hooks/useWindowResize";
import { useWindowBounds }       from "./hooks/useWindowBounds";
import { useTheme }              from "./hooks/useTheme";
import { useInactivityTimer }    from "./hooks/useInactivityTimer";
import { Sidebar }             from "./components/Sidebar";
import { BoardSetup }          from "./components/BoardSetup";
import { ColumnPanel }         from "./components/ColumnPanel";
import { ColumnConfigPanel }   from "./components/ColumnConfigPanel";
import { IssueDetailPanel }    from "./components/IssueDetailPanel";
import { Settings }            from "./components/Settings";
import { AlertPanel }          from "./components/AlertPanel";
import { HistoryPanel }        from "./components/HistoryPanel";
import { DraftsPanel }         from "./components/DraftsPanel";
import { DraftFormPanel }      from "./components/DraftFormPanel";
import type { JiraBoardIssue, IssueDraft } from "./types";
import { getDrafts, saveDraft, deleteDraft, newDraftId } from "./services/db";

export default function App() {
  const { settings, loading: settingsLoading, updateSettings } = useIssues();
  const board = useBoardView(settings);

  // null = somente sidebar visível
  const [view, setView]               = useState<AppView | null>(null);
  const [panelExiting, setPanelExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Painel de configuração de coluna — a janela não redimensiona mais,
  // então só precisamos de um estado de visibilidade.
  const [columnConfigVisible, setColumnConfigVisible] = useState(false);
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Painel de detalhe da issue — visible/exiting (open foi removido: era apenas para wideMode)
  const [issueDetailVisible, setIssueDetailVisible] = useState(false);
  const [issueDetailExiting, setIssueDetailExiting] = useState(false);
  const [selectedIssue,      setSelectedIssue]      = useState<JiraBoardIssue | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasCredentials = Boolean(
    settings.jira_base_url && settings.jira_email && settings.jira_api_token
  );

  // Resolve view efetiva: quando não há board, força setup
  const effectiveView: AppView | null =
    view === "column" && !board.config ? "board-setup" : view;

  // Contagem de rascunhos para o badge na sidebar — relê ao sair do painel
  const [draftCount, setDraftCount] = useState(() => getDrafts().length);
  useEffect(() => {
    if (effectiveView !== "drafts") setDraftCount(getDrafts().length);
  }, [effectiveView]);

  // ── Painel de formulário de rascunho (painel secundário dentro da view "drafts") ──
  const [draftFormDraft,   setDraftFormDraft]   = useState<IssueDraft | null>(null);
  const [draftFormIsNew,   setDraftFormIsNew]   = useState(false);

  function openNewDraft() {
    const now = new Date().toISOString();
    const types = board.issueTypes;
    const defType = types.find((t) => !t.subtask)?.name ?? "Story";
    const blank: IssueDraft = {
      id:         newDraftId(),
      title:      "",
      type:       defType,
      priority:   "Medium",
      labels:     [],
      projectKey: board.config?.projectKey ?? "",
      createdAt:  now,
      updatedAt:  now,
    };
    setDraftFormDraft(blank);
    setDraftFormIsNew(true);
  }

  function openEditDraft(draft: IssueDraft) {
    setDraftFormDraft(draft);
    setDraftFormIsNew(false);
  }

  function closeDraftForm() {
    setDraftFormDraft(null);
  }

  function handleDraftSave(draft: IssueDraft) {
    saveDraft(draft);
    // Após salvar: mantém o painel aberto com os dados atualizados (novo ou existente)
    // O usuário fecha manualmente ou clica "Criar no Jira"
    setDraftFormDraft(draft);
    setDraftFormIsNew(false); // passa a ser "edição" após o primeiro save
    setDraftCount(getDrafts().length);
  }

  function handleDraftDelete(id: string) {
    deleteDraft(id);
    setDraftFormDraft(null);
    setDraftCount(getDrafts().length);
  }

  // Redimensiona a janela conforme o painel: 72px (sidebar) ou 800px (painel aberto).
  // Usa effectiveView (sem !panelExiting) para manter a janela larga durante a animação de saída.
  // Retorna o lado onde o painel foi aberto (left/right) para ajustar layout e animações.
  const panelSide = useWindowResize(effectiveView !== null);

  // Aplica tema (dark/light/system) na classe do <html>
  useTheme(settings.theme);

  // Impede que a barra saia dos limites do monitor atual
  useWindowBounds();

  // Recolhe o painel quando o mouse fica fora da janela por X minutos
  useInactivityTimer(
    effectiveView !== null,
    settings.inactivity_timeout_minutes ?? 2,
    startExit,
  );

  /** Abre o config panel (fecha o detalhe se aberto — são exclusivos) */
  const openConfig = useCallback(() => {
    // Fecha detalhe imediatamente (sem animação — troca de painel)
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    setIssueDetailVisible(false);
    setIssueDetailExiting(false);

    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    setColumnConfigVisible(true); // aparece imediatamente — sem resize para esperar
  }, []);

  /** Fecha o config panel */
  const closeConfig = useCallback(() => {
    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    setColumnConfigVisible(false);
  }, []);

  /** Abre o painel de detalhe (fecha config se aberto — são exclusivos) */
  const openDetail = useCallback((issue: JiraBoardIssue) => {
    // Fecha config imediatamente
    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    setColumnConfigVisible(false);

    // Cancela animação de saída pendente antes de abrir
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    setIssueDetailExiting(false);

    setSelectedIssue(issue);
    setIssueDetailVisible(true); // aparece imediatamente — sem resize para esperar
  }, []);

  /**
   * Fecha o painel de detalhe com animação de saída:
   *   1. setIssueDetailVisible(false) → remove destaque do card
   *   2. setIssueDetailExiting(true)  → painel fica no DOM durante a animação
   *   3. após 190ms                   → remove do DOM
   */
  const closeDetail = useCallback(() => {
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    setIssueDetailVisible(false);
    setIssueDetailExiting(true);
    detailTimerRef.current = setTimeout(() => {
      setIssueDetailExiting(false);
    }, 190); // ligeiramente maior que a duração da animação (0.18s)
  }, []);

  /** Fecha o painel de detalhe imediatamente (sem animação própria) */
  function forceCloseDetail() {
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    setIssueDetailVisible(false);
    setIssueDetailExiting(false);
  }

  /** Inicia animação de saída e remove o painel após ela terminar */
  function startExit() {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    closeConfig();
    forceCloseDetail(); // o painel principal já anima, o detalhe some junto
    closeDraftForm();   // fecha o formulário de rascunho se estiver aberto
    setPanelExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setView(null);
      setPanelExiting(false);
    }, 180); // deve ser igual à duração de panel-slide-out
  }

  /** Alterna painel: mesmo botão fecha com animação, outro troca imediatamente */
  function handleToggle(newView: AppView) {
    if (view === newView) {
      startExit();
    } else {
      // Troca de painel: cancela saída pendente e abre o novo diretamente
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      setPanelExiting(false);
      closeDraftForm(); // fecha formulário de rascunho ao trocar de painel
      setView(newView);
    }
  }

  /** Seleciona uma coluna → abre painel; clica novamente → recolhe */
  function handleSelectColumn(columnName: string) {
    if (effectiveView === "column" && board.activeColumnName === columnName) {
      startExit();
    } else {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      setPanelExiting(false);
      closeConfig();        // fecha config ao trocar de coluna
      forceCloseDetail();   // fecha detalhe imediatamente ao trocar de coluna
      board.selectColumn(columnName);
      setView("column");
    }
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (settingsLoading || board.loading) {
    return (
      <div className="w-full h-full flex items-end justify-end p-2">
        <div className="sidebar-bar w-12 flex items-center justify-center" style={{ height: 80 }}>
          <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ─── Conteúdo do painel ─────────────────────────────────────────────────────

  function renderPanel() {
    switch (effectiveView) {
      case "board-setup":
        return (
          <BoardSetup
            settings={settings}
            currentConfig={board.config}
            onBack={() => setView(null)}
            onConfigured={async (cfg) => {
              await board.configure(cfg);
              setView(null); // fecha o painel — colunas aparecem na sidebar
            }}
          />
        );

      case "column": {
        const col = board.columns.find((c) => c.name === board.activeColumnName);
        if (!col || !board.config) return null;
        const colCfg = board.columnConfigs[col.name] ?? {};
        return (
          <div className="flex flex-row h-full overflow-hidden">
            {/* Detalhe da issue — fica no DOM durante a animação de saída */}
            {(issueDetailVisible || issueDetailExiting) && selectedIssue && (
              <div
                className={`${issueDetailExiting ? "detail-panel-out" : "detail-panel-in"} w-80 shrink-0 border-r overflow-hidden`}
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <IssueDetailPanel
                  issue={selectedIssue}
                  settings={settings}
                  jiraBaseUrl={settings.jira_base_url}
                  onClose={closeDetail}
                />
              </div>
            )}

            {/* Config panel — montado apenas quando visível (após resize) */}
            {columnConfigVisible && (
              <div className="config-panel-in w-72 shrink-0 border-r overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
                <ColumnConfigPanel
                  columnName={col.name}
                  config={colCfg}
                  issueTypes={board.issueTypes}
                  customFields={board.customFields}
                  onSave={(cfg) => {
                    board.updateColumnConfig(col.name, cfg);
                    closeConfig();
                  }}
                  onClose={closeConfig}
                />
              </div>
            )}

            {/* Painel de issues — ocupa o espaço restante */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <ColumnPanel
                column={col}
                boardName={board.config.boardName}
                projectKey={board.config.projectKey}
                syncing={board.syncing}
                enriching={board.enriching}
                lastSyncAt={board.lastSyncAt}
                error={board.error}
                columnConfig={colCfg}
                onSync={board.syncNow}
                jiraBaseUrl={settings.jira_base_url}
                loadMoreMeta={board.loadMoreMeta[col.name]}
                onLoadMore={() => board.loadMoreColumnIssues(col.name)}
                onToggleConfig={() => columnConfigVisible ? closeConfig() : openConfig()}
                configPanelOpen={columnConfigVisible}
                onSelectIssue={(issue) =>
                  issueDetailVisible && selectedIssue?.key === issue.key
                    ? closeDetail()     // clique no mesmo card fecha o detalhe
                    : openDetail(issue)
                }
                selectedIssueKey={issueDetailVisible ? selectedIssue?.key : null}
              />
            </div>
          </div>
        );
      }

      case "settings":
        return (
          <Settings
            settings={settings}
            onSave={updateSettings}
            onBack={() => setView(null)}
            workSchedule={board.workSchedule}
            onSaveSchedule={board.updateWorkSchedule}
          />
        );

      case "alerts":
        return (
          <AlertPanel
            alerts={board.alerts}
            onSilence={board.silenceAlert}
            onSilenceAll={board.silenceAllAlerts}
            jiraBaseUrl={settings.jira_base_url}
          />
        );

      case "history":
        return (
          <HistoryPanel
            settings={settings}
            projectKey={board.config?.projectKey}
            jiraBaseUrl={settings.jira_base_url}
          />
        );

      case "drafts":
        return (
          <div className="flex flex-row h-full overflow-hidden">
            {/* Painel de formulário — secundário, igual ao ColumnConfigPanel */}
            {draftFormDraft && (
              <div
                className="config-panel-in w-72 shrink-0 border-r overflow-hidden"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <DraftFormPanel
                  draft={draftFormDraft}
                  isNew={draftFormIsNew}
                  issueTypes={board.issueTypes}
                  settings={settings}
                  projectKey={board.config?.projectKey}
                  jiraBaseUrl={settings.jira_base_url}
                  onSave={handleDraftSave}
                  onClose={closeDraftForm}
                  onDelete={() => handleDraftDelete(draftFormDraft.id)}
                />
              </div>
            )}
            {/* Lista de rascunhos — painel principal */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <DraftsPanel
                issueTypes={board.issueTypes}
                activeDraftId={draftFormDraft?.id ?? null}
                onNew={openNewDraft}
                onEdit={openEditDraft}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  const panelOnRight = panelSide === "right";

  // Animação do painel: direção depende do lado onde ele abriu
  const panelAnim = panelExiting
    ? (panelOnRight ? "panel-slide-out-right" : "panel-slide-out")
    : (panelOnRight ? "panel-slide-in-right"  : "panel-slide-in");

  const sidebar = (
    <Sidebar
      activeView={effectiveView}
      activeColumnName={board.activeColumnName}
      onToggle={handleToggle}
      onSelectColumn={handleSelectColumn}
      hasCredentials={hasCredentials}
      boardConfig={board.config}
      columns={board.columns}
      syncing={board.syncing}
      syncError={board.error}
      onSync={board.syncNow}
      alertCount={board.alerts.length}
      draftCount={draftCount}
    />
  );

  const panel = (effectiveView !== null || panelExiting) && (
    <div className={`flex-1 panel-container overflow-hidden ${panelAnim}`}>
      {renderPanel()}
    </div>
  );

  return (
    <div
      className={`w-full h-full flex flex-row items-stretch gap-2 p-2 ${panelOnRight ? "justify-start" : "justify-end"}`}
    >
      {panelOnRight ? <>{sidebar}{panel}</> : <>{panel}{sidebar}</>}
    </div>
  );
}
