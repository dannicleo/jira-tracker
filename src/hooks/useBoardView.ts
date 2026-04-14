/**
 * useBoardView — gerencia o board selecionado e suas colunas com issues.
 *
 * Fluxo:
 *   1. Usuário configura um board (configure)
 *   2. Hook busca colunas + issues do board e agrupa por coluna
 *   3. Auto-refresh a cada config.syncIntervalMinutes
 *   4. selectColumn controla qual coluna está ativa na sidebar
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, SelectedBoardConfig, BoardColumnWithIssues, ColumnConfig, WorkSchedule, AppAlert, CachedIssueType, CachedCustomField } from "../types";
import { DEFAULT_WORK_SCHEDULE } from "../types";
import {
  getBoardViewConfig,
  saveBoardViewConfig,
  clearBoardViewConfig,
  clearBoardCache,
  getBoardViewColumns,
  saveBoardViewColumns,
  getColumnConfigs,
  saveColumnConfig,
  getWorkSchedule,
  saveWorkSchedule,
  getStatusMap,
  saveStatusMap,
  getAlerts,
  silenceAlert as dbSilenceAlert,
  silenceAllAlerts as dbSilenceAllAlerts,
  getSilencedAlerts,
  getCachedIssueTypes,
  saveCachedIssueTypes,
  getCachedCustomFields,
  saveCachedCustomFields,
} from "../services/db";
import { notifyAlerts } from "../services/notifications";
import { runAlertEngine } from "../services/alertEngine";
import type { BoardStatusMap, StatusChange } from "../types";
import {
  fetchBoardColumns,
  fetchBoardIssues,
  fetchSprintIssues,
  fetchActiveSprint,
  fetchIssuesByStatusIds,
  enrichColumnIssues,
  applyEnrichmentCache,
  fetchIssueTypes,
  fetchCustomFields,
} from "../services/jira";

export interface UseBoardViewReturn {
  config: SelectedBoardConfig | null;
  columns: BoardColumnWithIssues[];
  activeColumnName: string | null;
  selectColumn: (name: string | null) => void;
  loading: boolean;
  syncing: boolean;
  enriching: boolean; // buscando changelog para a coluna ativa
  lastSyncAt: Date | null;
  error: string | null;
  configure: (config: SelectedBoardConfig) => Promise<void>;
  clearConfig: () => void;
  syncNow: () => Promise<void>;
  /** Configs de limite/estimativa por nome de coluna */
  columnConfigs: Record<string, ColumnConfig>;
  /** Salva/atualiza a config de uma coluna e re-enriquece se ela estiver ativa */
  updateColumnConfig: (columnName: string, cfg: ColumnConfig) => Promise<void>;
  /** Configuração do horário de trabalho */
  workSchedule: WorkSchedule;
  /** Salva horário de trabalho e re-enriquece a coluna ativa */
  updateWorkSchedule: (schedule: WorkSchedule) => Promise<void>;
  /** Alertas ativos (não silenciados) do último sync */
  alerts: AppAlert[];
  /** Silencia um alerta pelo ID */
  silenceAlert: (id: string) => void;
  /** Silencia todos os alertas ativos */
  silenceAllAlerts: () => void;
  /** Metadados de "carregar mais" por nome de coluna */
  loadMoreMeta: Record<string, LoadMoreMeta>;
  /** Carrega mais issues de uma coluna via JQL (além do filtro do board) */
  loadMoreColumnIssues: (columnName: string) => Promise<void>;
  /** Tipos de issue do Jira (cacheados localmente) */
  issueTypes: CachedIssueType[];
  /** Campos personalizados numéricos do Jira (cacheados localmente) */
  customFields: CachedCustomField[];
}

/** Controla o estado de paginação do "carregar mais" por coluna */
export interface LoadMoreMeta {
  /** Offset do próximo fetch JQL */
  nextOffset: number;
  /** Total de issues reportado pelo Jira para esse JQL */
  total: number;
  /** true enquanto o fetch está em andamento */
  loading: boolean;
}

export function useBoardView(settings: AppSettings): UseBoardViewReturn {
  const [config, setConfig]               = useState<SelectedBoardConfig | null>(null);
  const [columns, setColumns]             = useState<BoardColumnWithIssues[]>([]);
  const [activeColumnName, setActiveColumnName] = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [syncing, setSyncing]             = useState(false);
  const [enriching, setEnriching]         = useState(false);
  const [lastSyncAt, setLastSyncAt]       = useState<Date | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [columnConfigs, setColumnConfigs] = useState<Record<string, ColumnConfig>>({});
  const [workSchedule, setWorkSchedule]   = useState<WorkSchedule>(DEFAULT_WORK_SCHEDULE);
  const [alerts, setAlerts]               = useState<AppAlert[]>(() => {
    // Carrega alertas persistidos filtrando os silenciados
    const all      = getAlerts();
    const silenced = getSilencedAlerts();
    return all.filter((a) => !silenced.has(a.id));
  });
  const [loadMoreMeta, setLoadMoreMeta]   = useState<Record<string, LoadMoreMeta>>({});
  const [issueTypes, setIssueTypes]       = useState<CachedIssueType[]>(() => getCachedIssueTypes());
  const [customFields, setCustomFields]   = useState<CachedCustomField[]>(() => getCachedCustomFields());

  const configRef   = useRef(config);
  configRef.current = config;

  // Refs para valores acessíveis dentro de syncNow sem invalidar o useCallback
  const activeColumnNameRef = useRef<string | null>(null);
  activeColumnNameRef.current = activeColumnName;

  const columnConfigsRef = useRef<Record<string, ColumnConfig>>({});
  const columnsRef       = useRef<BoardColumnWithIssues[]>([]);
  columnsRef.current     = columns;
  const loadMoreMetaRef  = useRef<Record<string, LoadMoreMeta>>({});
  loadMoreMetaRef.current = loadMoreMeta;
  columnConfigsRef.current = columnConfigs;

  const workScheduleRef = useRef<WorkSchedule>(DEFAULT_WORK_SCHEDULE);
  workScheduleRef.current = workSchedule;

  // Controla se já disparamos o sync inicial nesta sessão
  const initialSyncDoneRef = useRef(false);

  // ── Carrega estado persistido ao montar ──────────────────────────────────
  useEffect(() => {
    const savedConfig   = getBoardViewConfig();
    const savedColumns  = savedConfig ? getBoardViewColumns(savedConfig.boardId) : [];
    const savedSchedule = getWorkSchedule();
    setConfig(savedConfig);
    setColumns(savedColumns);
    setWorkSchedule(savedSchedule);
    if (savedConfig) setColumnConfigs(getColumnConfigs(savedConfig.boardId));
    setLoading(false);
  }, []);

  // ── Busca metadados do Jira (tipos de issue + campos personalizados) ──────
  // Disparado assim que o token fica disponível. Atualiza em segundo plano;
  // se já há cache local, o estado já foi inicializado pelo useState acima.
  useEffect(() => {
    if (!settings.jira_api_token) return;
    let cancelled = false;
    (async () => {
      try {
        const [types, fields] = await Promise.all([
          fetchIssueTypes(settings),
          fetchCustomFields(settings),
        ]);
        if (cancelled) return;
        saveCachedIssueTypes(types);
        saveCachedCustomFields(fields);
        setIssueTypes(types);
        setCustomFields(fields);
      } catch {
        // Silencioso — usa cache anterior se houver
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jira_api_token]);

  // ── Sync principal ───────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || !settings.jira_api_token) return;

    setSyncing(true);
    setError(null);

    try {
      // 1. Colunas do board (configuram quais status pertencem a cada coluna)
      // Boards next-gen (team-managed) podem retornar 404 ou colunas sem statuses
      // neste endpoint — tratamos silenciosamente e fazemos o fallback adiante.
      let validCols: import("../types").JiraBoardColumn[] = [];
      try {
        const rawCols = await fetchBoardColumns(cfg.boardId, settings);
        validCols = rawCols.filter((c) => c.statuses.length > 0);
      } catch {
        // Ignora erro de configuração — colunas serão derivadas das issues
      }

      // 2. Issues: estratégia depende do tipo de board
      let allIssues = await fetchAllIssues(cfg, settings);

      // Fallback para boards next-gen (team-managed): o endpoint de configuração
      // retorna 404 ou colunas sem statuses mapeados. Nesse caso, criamos colunas
      // dinamicamente a partir dos statuses reais das issues.
      if (validCols.length === 0 && allIssues.length > 0) {
        const seenOrder: string[] = [];
        const statusMeta = new Map<string, { name: string }>();
        for (const issue of allIssues) {
          const { id, name } = issue.fields.status;
          if (!statusMeta.has(id)) {
            statusMeta.set(id, { name });
            seenOrder.push(id);
          }
        }
        validCols = seenOrder.map((id) => ({
          name: statusMeta.get(id)!.name,
          statuses: [{ id, self: "" }],
        }));
      }

      // 3. Agrupa issues por coluna e aplica cache de enrichment quando disponível
      //    → timeInColumnMs fica atualizado em todo sync, sem chamadas à API
      const columnsWithIssues: BoardColumnWithIssues[] = validCols.map((col) => {
        const statusIds = col.statuses.map((s) => s.id);
        const issues = allIssues
          .filter((i) => statusIds.includes(i.fields.status.id))
          .map((issue) => applyEnrichmentCache(issue, workScheduleRef.current));
        return { name: col.name, statusIds, issues };
      });

      // ── Detecção de mudanças de status e notificações ─────────────────────
      const prevStatusMap = getStatusMap(cfg.boardId);
      const nextStatusMap: BoardStatusMap = {};
      const statusChanges: StatusChange[] = [];

      for (const col of columnsWithIssues) {
        for (const issue of col.issues) {
          const currentStatusId   = issue.fields.status.id;
          const currentStatusName = issue.fields.status.name;

          nextStatusMap[issue.key] = {
            statusId:     currentStatusId,
            statusName:   currentStatusName,
            columnName:   col.name,
            summary:      issue.fields.summary,
            assigneeName: issue.fields.assignee?.displayName ?? null,
            capturedAt:   new Date().toISOString(),
          };

          const prev = prevStatusMap[issue.key];
          // Notifica apenas se já havia dados anteriores (não é o primeiro sync)
          // e o status mudou de fato
          if (prev && prev.statusId !== currentStatusId) {
            statusChanges.push({
              issueKey:     issue.key,
              summary:      issue.fields.summary,
              assigneeName: issue.fields.assignee?.displayName ?? null,
              fromStatus:   prev.statusName,
              toStatus:     currentStatusName,
              fromColumn:   prev.columnName,
              toColumn:     col.name,
            });
          }
        }
      }

      // Persiste o novo mapa de status
      saveStatusMap(cfg.boardId, nextStatusMap);

      // ── Motor de alertas ────────────────────────────────────────────────────
      const isFirstSync = Object.keys(prevStatusMap).length === 0;
      const { activeAlerts, toNotify } = runAlertEngine(
        columnsWithIssues,
        columnConfigsRef.current,
        prevStatusMap,
        cfg.boardName,
        isFirstSync
      );

      setAlerts(activeAlerts);

      // Envia notificações nativas para os alertas novos/persistentes deste ciclo
      if (toNotify.length > 0) {
        notifyAlerts(toNotify);
      }

      // Diagnóstico: loga no console para facilitar debug de issues não mapeadas
      if (import.meta.env.DEV || true) {
        const totalMatched = columnsWithIssues.reduce((s, c) => s + c.issues.length, 0);
        const unmatchedStatusIds = [...new Set(
          allIssues
            .filter((i) => !columnsWithIssues.some((c) => c.issues.includes(i)))
            .map((i) => `${i.fields.status.id} (${i.fields.status.name})`)
        )];
        console.debug(
          `[BoardSync] board=${cfg.boardId} cols=${validCols.length} issues=${allIssues.length} matched=${totalMatched}`,
          columnsWithIssues.map((c) => `${c.name}(${c.issues.length})`).join(", "),
          unmatchedStatusIds.length ? `⚠️ unmatched statuses: ${unmatchedStatusIds.join(", ")}` : "✅ all matched"
        );
      }

      // 4. Se há coluna ativa, enriquece ANTES de atualizar o estado
      //    → elimina o flash visual onde cards aparecem sem dados de horas
      let finalColumns = columnsWithIssues;
      const activeName = activeColumnNameRef.current;
      if (activeName) {
        const activeCol = columnsWithIssues.find((c) => c.name === activeName);
        if (activeCol && activeCol.issues.length > 0) {
          const colCfg = columnConfigsRef.current[activeName] ?? {};
          setEnriching(true);
          try {
            const enriched = await enrichColumnIssues(
              activeCol.issues, activeCol.statusIds, settings,
              colCfg.estimateFieldId, workScheduleRef.current, colCfg.limitRules
            );
            // Monta a lista final com a coluna ativa já enriquecida
            finalColumns = columnsWithIssues.map((c) =>
              c.name === activeName ? { ...c, issues: enriched } : c
            );
          } catch {
            // silencioso — em caso de falha, usa dados sem enriquecimento
          } finally {
            setEnriching(false);
          }
        }
      }

      // 5. Persiste e atualiza estado em uma única operação, já com dados enriquecidos
      saveBoardViewColumns(cfg.boardId, finalColumns);
      setColumns(finalColumns);
      setLastSyncAt(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }, [settings]);

  // ── Configura um novo board ──────────────────────────────────────────────
  const configure = useCallback(
    async (newConfig: SelectedBoardConfig) => {
      // Limpa cache do board anterior (se trocou de board)
      if (configRef.current && configRef.current.boardId !== newConfig.boardId) {
        clearBoardCache(configRef.current.boardId);
      }
      // Sempre descarta cache do board selecionado → garante fresh start
      clearBoardCache(newConfig.boardId);

      saveBoardViewConfig(newConfig);
      setConfig(newConfig);
      setColumns([]);
      setActiveColumnName(null);
      setError(null);
      setColumnConfigs(getColumnConfigs(newConfig.boardId));
      // Dispara sync imediato após configurar
      configRef.current = newConfig;
      await syncNow();
    },
    [syncNow]
  );

  // ── Enriquece issues de uma coluna (changelog + estimativa + campos de regras) ─
  const enrichColumn = useCallback(
    async (name: string, colsSnapshot: typeof columns, cfgsSnapshot: typeof columnConfigs) => {
      if (!settings.jira_api_token) return;
      const col = colsSnapshot.find((c) => c.name === name);
      if (!col || col.issues.length === 0) return;

      const cfg = cfgsSnapshot[name] ?? {};
      setEnriching(true);
      try {
        const enriched = await enrichColumnIssues(
          col.issues, col.statusIds, settings, cfg.estimateFieldId,
          workScheduleRef.current, cfg.limitRules
        );
        setColumns((prev) =>
          prev.map((c) => (c.name === name ? { ...c, issues: enriched } : c))
        );
      } catch {
        // Silencioso — issues aparecem sem badge de tempo
      } finally {
        setEnriching(false);
      }
    },
    [settings]
  );

  // ── Seleciona coluna → dispara enriquecimento ─────────────────────────────
  const selectColumn = useCallback(
    async (name: string | null) => {
      setActiveColumnName(name);
      if (!name) return;
      await enrichColumn(name, columns, columnConfigs);
    },
    [columns, columnConfigs, enrichColumn]
  );

  // ── Salva config de coluna e re-enriquece se ela estiver ativa ────────────
  const updateColumnConfig = useCallback(
    async (columnName: string, cfg: ColumnConfig) => {
      if (!config) return;
      saveColumnConfig(config.boardId, columnName, cfg);
      const nextCfgs = { ...columnConfigs, [columnName]: cfg };
      setColumnConfigs(nextCfgs);
      // Se a coluna está ativa, re-enriquece para refletir novo campo de estimativa
      if (columnName === activeColumnName) {
        await enrichColumn(columnName, columns, nextCfgs);
      }
    },
    [config, columnConfigs, activeColumnName, columns, enrichColumn]
  );

  // ── Salva horário de trabalho e re-enriquece coluna ativa ────────────────
  const updateWorkSchedule = useCallback(
    async (schedule: WorkSchedule) => {
      saveWorkSchedule(schedule);
      setWorkSchedule(schedule);
      // Re-enriquece a coluna ativa para refletir o novo cálculo de horas
      const activeName = activeColumnNameRef.current;
      if (activeName) {
        const col = columns.find((c) => c.name === activeName);
        if (col && col.issues.length > 0) {
          const colCfg = columnConfigsRef.current[activeName] ?? {};
          setEnriching(true);
          try {
            const enriched = await enrichColumnIssues(
              col.issues, col.statusIds, settings, colCfg.estimateFieldId,
              schedule, colCfg.limitRules
            );
            setColumns((prev) =>
              prev.map((c) => (c.name === activeName ? { ...c, issues: enriched } : c))
            );
          } catch {
            // silencioso
          } finally {
            setEnriching(false);
          }
        }
      }
    },
    [columns, settings]
  );

  // ── Limpa configuração ───────────────────────────────────────────────────
  const clearConfig = useCallback(() => {
    clearBoardViewConfig(configRef.current?.boardId);
    setConfig(null);
    setColumns([]);
    setActiveColumnName(null);
    setLastSyncAt(null);
    setError(null);
  }, []);

  // ── Auto-refresh via timer Rust (imune ao App Nap do macOS) ─────────────
  //
  // setInterval JS é suspenso pelo macOS quando o app não está em primeiro
  // plano. Usamos um timer Tokio no Rust que emite "background-sync-tick";
  // o JS apenas reage ao evento — nunca perde um ciclo de sync.
  //
  // syncNowRef garante que o listener sempre chame a versão mais recente de
  // syncNow, sem precisar re-registrar o listener a cada mudança de deps.
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  useEffect(() => {
    if (!config || !settings.jira_api_token) return;

    const intervalSecs = config.syncIntervalMinutes * 60;

    // Inicia (ou reinicia) o timer Rust com o intervalo atual
    invoke("start_background_sync", { intervalSecs }).catch(() => {
      // Fallback para setInterval se não estiver rodando no Tauri (dev browser)
      const timer = setInterval(() => syncNowRef.current(), intervalSecs * 1000);
      return () => clearInterval(timer);
    });

    // Ouve o evento emitido pelo Rust a cada intervalo
    let unlisten: (() => void) | null = null;
    listen("background-sync-tick", () => {
      syncNowRef.current();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      invoke("stop_background_sync").catch(() => {/* silencioso no browser */});
    };
  // syncNow intencionalmente fora das deps — usamos a ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.syncIntervalMinutes, settings.jira_api_token]);

  // ── Sync inicial — dispara quando o token fica disponível ───────────────
  // Usa ref para garantir que ocorre apenas uma vez por sessão.
  // O token chega async (decrypt), então não podemos depender só de [loading].
  useEffect(() => {
    if (!loading && config && settings.jira_api_token && !initialSyncDoneRef.current) {
      initialSyncDoneRef.current = true;
      syncNow();
    }
  }, [loading, settings.jira_api_token, config, syncNow]);

  // ── Funções de silêncio de alertas ──────────────────────────────────────
  const silenceAlert = useCallback((id: string) => {
    dbSilenceAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const silenceAllAlerts = useCallback(() => {
    const ids = alerts.map((a) => a.id);
    dbSilenceAllAlerts(ids);
    setAlerts([]);
  }, [alerts]);

  // ── Carregar mais issues via JQL (ignora filtro do board) ─────────────────
  const loadMoreColumnIssues = useCallback(async (columnName: string) => {
    const cfg = configRef.current;
    if (!cfg || !settings.jira_api_token) return;

    const col = columnsRef.current.find((c) => c.name === columnName);
    if (!col) return;

    const meta = loadMoreMetaRef.current[columnName] ?? { nextOffset: 0, total: Infinity, loading: false };
    if (meta.loading) return;
    // Sem mais páginas
    if (meta.nextOffset > 0 && meta.nextOffset >= meta.total) return;

    setLoadMoreMeta((prev) => ({
      ...prev,
      [columnName]: { ...meta, loading: true },
    }));

    try {
      const { issues: fetched, total } = await fetchIssuesByStatusIds(
        col.statusIds,
        cfg.projectKey,
        settings,
        meta.nextOffset,
        100
      );

      // Deduplica: remove issues que já estão na coluna
      const existingKeys = new Set(col.issues.map((i) => i.key));
      const fresh = fetched
        .filter((i) => !existingKeys.has(i.key))
        .map((i) => applyEnrichmentCache(i, workScheduleRef.current));

      // Acrescenta ao estado de colunas
      setColumns((prev) =>
        prev.map((c) =>
          c.name === columnName ? { ...c, issues: [...c.issues, ...fresh] } : c
        )
      );

      const nextOffset = meta.nextOffset + fetched.length;
      setLoadMoreMeta((prev) => ({
        ...prev,
        [columnName]: { nextOffset, total, loading: false },
      }));
    } catch {
      setLoadMoreMeta((prev) => ({
        ...prev,
        [columnName]: { ...meta, loading: false },
      }));
    }
  }, [settings]);

  return {
    config,
    columns,
    activeColumnName,
    selectColumn,
    loading,
    syncing,
    enriching,
    lastSyncAt,
    error,
    configure,
    clearConfig,
    syncNow,
    columnConfigs,
    updateColumnConfig,
    workSchedule,
    updateWorkSchedule,
    alerts,
    silenceAlert,
    silenceAllAlerts,
    loadMoreMeta,
    loadMoreColumnIssues,
    issueTypes,
    customFields,
  };
}

// ─── Helper: busca todas as issues do board ───────────────────────────────────

async function fetchAllIssues(
  cfg: SelectedBoardConfig,
  settings: AppSettings
) {
  if (cfg.boardType === "kanban") {
    return fetchBoardIssues(cfg.boardId, settings);
  }

  // Scrum: usa sprint ativa (pode ter mudado desde a última configuração)
  const sprint = await fetchActiveSprint(cfg.boardId, settings);
  if (!sprint) return [];

  // Atualiza o sprintId no config persistido se mudou
  if (sprint.id !== cfg.sprintId) {
    saveBoardViewConfig({ ...cfg, sprintId: sprint.id, sprintName: sprint.name });
  }

  return fetchSprintIssues(sprint.id, settings);
}
