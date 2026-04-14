/**
 * Persistência via localStorage — funciona nativamente no Tauri
 * (o webview mantém os dados entre sessões na pasta de dados do app)
 *
 * O campo jira_api_token é salvo/lido criptografado via Web Crypto (AES-GCM).
 */
import type {
  TrackedIssue,
  IssueSnapshot,
  IssueInsight,
  AppSettings,
  BoardMonitorConfig,
  MonitoredIssue,
  SelectedBoardConfig,
  BoardColumnWithIssues,
  ColumnConfig,
  WorkSchedule,
  CachedIssueEnrichment,
  BoardStatusMap,
  AppAlert,
  CachedIssueType,
  CachedCustomField,
  IssueDraft,
} from "../types";
import { DEFAULT_WORK_SCHEDULE } from "../types";
import { encrypt, decrypt } from "./crypto";

// ─── Migração de cache ────────────────────────────────────────────────────────
// Limpa caches incompatíveis em novas versões do app

const CACHE_VERSION_KEY = "jt:cache-version";
const CURRENT_CACHE_VERSION = "2"; // bump ao mudar campos de enrichment

(function runMigrations() {
  const stored = localStorage.getItem(CACHE_VERSION_KEY);
  if (stored !== CURRENT_CACHE_VERSION) {
    // Limpa todos os caches de enrichment — serão recriados com o novo campo (customfield_10003)
    const prefix = "jt:enrich:";
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
    console.log(`[db] Migração de cache v${CURRENT_CACHE_VERSION}: ${toRemove.length} enrichment(s) limpos.`);
  }
})();

const KEYS = {
  drafts:         "jt:drafts",
  issues:         "jt:issues",
  snapshots:      (key: string) => `jt:snapshots:${key}`,
  insights:       (key: string) => `jt:insights:${key}`,
  settings:       "jt:settings",
  boardConfig:    "jt:board-monitor-config",
  monitorIssues:  "jt:monitor-issues",
  // Board View (nova jornada)
  boardViewConfig:   "jt:board-view-config",
  boardViewColumns:  (boardId: number) => `jt:board-view-columns:${boardId}`,
  // Configurações por coluna: { [columnName]: ColumnConfig }
  columnConfigs:  (boardId: number) => `jt:column-configs:${boardId}`,
  // Horário de trabalho (global)
  workSchedule:   "jt:work-schedule",
  // Cache de enrichment por issue (enteredAt + flagPeriods — evita re-fetch de changelog)
  issueEnrichment: (issueKey: string) => `jt:enrich:${issueKey}`,
  // Mapa de status por board — base para detecção de mudanças e notificações
  statusMap: (boardId: number) => `jt:status-map:${boardId}`,
  // Alertas ativos (persistidos entre syncs)
  alerts:   "jt:alerts",
  // IDs de alertas silenciados pelo usuário
  silenced: "jt:silenced",
  // Metadados do Jira (tipos de issue e campos personalizados)
  issueTypes:   "jt:issue-types",
  customFields: "jt:custom-fields",
};

// ─── Issues ──────────────────────────────────────────────────────────────────

export async function getAllTrackedIssues(): Promise<TrackedIssue[]> {
  const raw = localStorage.getItem(KEYS.issues);
  return raw ? (JSON.parse(raw) as TrackedIssue[]) : [];
}

export async function getTrackedIssue(issueKey: string): Promise<TrackedIssue | null> {
  const issues = await getAllTrackedIssues();
  return issues.find((i) => i.issue_key === issueKey.toUpperCase()) ?? null;
}

export async function upsertTrackedIssue(issue: TrackedIssue): Promise<void> {
  const issues = await getAllTrackedIssues();
  const idx = issues.findIndex((i) => i.issue_key === issue.issue_key);
  if (idx >= 0) {
    issues[idx] = issue;
  } else {
    issues.unshift(issue);
  }
  localStorage.setItem(KEYS.issues, JSON.stringify(issues));
}

export async function deleteTrackedIssue(issueKey: string): Promise<void> {
  const issues = await getAllTrackedIssues();
  localStorage.setItem(
    KEYS.issues,
    JSON.stringify(issues.filter((i) => i.issue_key !== issueKey))
  );
  localStorage.removeItem(KEYS.snapshots(issueKey));
  localStorage.removeItem(KEYS.insights(issueKey));
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export async function saveSnapshot(snapshot: IssueSnapshot): Promise<void> {
  const key = KEYS.snapshots(snapshot.issue_key);
  const raw = localStorage.getItem(key);
  const snaps: IssueSnapshot[] = raw ? JSON.parse(raw) : [];
  snaps.unshift({ ...snapshot, id: Date.now() });
  localStorage.setItem(key, JSON.stringify(snaps.slice(0, 50)));
}

export async function getSnapshots(issueKey: string): Promise<IssueSnapshot[]> {
  const raw = localStorage.getItem(KEYS.snapshots(issueKey));
  return raw ? JSON.parse(raw) : [];
}

// ─── Insights ────────────────────────────────────────────────────────────────

export async function saveInsight(insight: IssueInsight): Promise<void> {
  const key = KEYS.insights(insight.issue_key);
  const raw = localStorage.getItem(key);
  const insights: IssueInsight[] = raw ? JSON.parse(raw) : [];
  insights.unshift({ ...insight, id: Date.now() });
  localStorage.setItem(key, JSON.stringify(insights));
}

export async function getInsights(issueKey: string): Promise<IssueInsight[]> {
  const raw = localStorage.getItem(KEYS.insights(issueKey));
  return raw ? JSON.parse(raw) : [];
}

export async function deleteInsight(id: number): Promise<void> {
  const issues = await getAllTrackedIssues();
  for (const issue of issues) {
    const key = KEYS.insights(issue.issue_key);
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const insights: IssueInsight[] = JSON.parse(raw);
    const filtered = insights.filter((i) => i.id !== id);
    if (filtered.length !== insights.length) {
      localStorage.setItem(key, JSON.stringify(filtered));
      break;
    }
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  jira_base_url: "",
  jira_email: "",
  jira_api_token: "",
  sync_interval_minutes: 15,
  theme: "system",
  inactivity_timeout_minutes: 2,
};

export async function getAllSettings(): Promise<AppSettings> {
  const raw = localStorage.getItem(KEYS.settings);
  if (!raw) return { ...DEFAULT_SETTINGS };

  const stored = JSON.parse(raw) as AppSettings & { _token_enc?: string };

  // Descriptografa o token se ele foi salvo criptografado
  let token = "";
  if (stored._token_enc) {
    token = await decrypt(stored._token_enc);
  }

  const { _token_enc: _, ...rest } = stored;
  return { ...DEFAULT_SETTINGS, ...rest, jira_api_token: token };
}

export async function saveAllSettings(settings: AppSettings): Promise<void> {
  // Criptografa o token antes de salvar — nunca armazena em claro
  const encryptedToken = await encrypt(settings.jira_api_token);
  const toStore = {
    ...settings,
    jira_api_token: "", // nunca em claro no localStorage
    _token_enc: encryptedToken,
  };
  localStorage.setItem(KEYS.settings, JSON.stringify(toStore));
}

// ─── Board Monitor Config ─────────────────────────────────────────────────────

export async function getBoardMonitorConfig(): Promise<BoardMonitorConfig | null> {
  const raw = localStorage.getItem(KEYS.boardConfig);
  return raw ? (JSON.parse(raw) as BoardMonitorConfig) : null;
}

export async function saveBoardMonitorConfig(config: BoardMonitorConfig): Promise<void> {
  localStorage.setItem(KEYS.boardConfig, JSON.stringify(config));
}

export async function clearBoardMonitorConfig(): Promise<void> {
  localStorage.removeItem(KEYS.boardConfig);
  localStorage.removeItem(KEYS.monitorIssues);
}

// ─── Monitored Issues ─────────────────────────────────────────────────────────

export async function getMonitoredIssues(): Promise<MonitoredIssue[]> {
  const raw = localStorage.getItem(KEYS.monitorIssues);
  return raw ? (JSON.parse(raw) as MonitoredIssue[]) : [];
}

export async function saveMonitoredIssues(issues: MonitoredIssue[]): Promise<void> {
  localStorage.setItem(KEYS.monitorIssues, JSON.stringify(issues));
}

export async function upsertMonitoredIssue(issue: MonitoredIssue): Promise<void> {
  const issues = await getMonitoredIssues();
  const idx = issues.findIndex((i) => i.issueKey === issue.issueKey);
  if (idx >= 0) {
    issues[idx] = issue;
  } else {
    issues.unshift(issue);
  }
  localStorage.setItem(KEYS.monitorIssues, JSON.stringify(issues));
}

// ─── Board View Config ────────────────────────────────────────────────────────

export function getBoardViewConfig(): SelectedBoardConfig | null {
  const raw = localStorage.getItem(KEYS.boardViewConfig);
  return raw ? (JSON.parse(raw) as SelectedBoardConfig) : null;
}

export function saveBoardViewConfig(config: SelectedBoardConfig): void {
  localStorage.setItem(KEYS.boardViewConfig, JSON.stringify(config));
}

export function clearBoardViewConfig(boardId?: number): void {
  localStorage.removeItem(KEYS.boardViewConfig);
  if (boardId != null) {
    localStorage.removeItem(KEYS.boardViewColumns(boardId));
    localStorage.removeItem(KEYS.statusMap(boardId));
  }
}

/** Limpa apenas o cache de dados de um board (colunas + statusMap + enrichment), sem tocar no config global */
export function clearBoardCache(boardId: number): void {
  localStorage.removeItem(KEYS.boardViewColumns(boardId));
  localStorage.removeItem(KEYS.statusMap(boardId));
  clearAllEnrichmentCache();
}

export function getBoardViewColumns(boardId: number): BoardColumnWithIssues[] {
  const raw = localStorage.getItem(KEYS.boardViewColumns(boardId));
  return raw ? (JSON.parse(raw) as BoardColumnWithIssues[]) : [];
}

export function saveBoardViewColumns(boardId: number, columns: BoardColumnWithIssues[]): void {
  localStorage.setItem(KEYS.boardViewColumns(boardId), JSON.stringify(columns));
}

// ─── Column Configs ───────────────────────────────────────────────────────────

/** Retorna todas as configs de colunas para um board */
export function getColumnConfigs(boardId: number): Record<string, ColumnConfig> {
  const raw = localStorage.getItem(KEYS.columnConfigs(boardId));
  return raw ? (JSON.parse(raw) as Record<string, ColumnConfig>) : {};
}

/** Salva (upsert) a config de uma coluna específica */
export function saveColumnConfig(
  boardId: number,
  columnName: string,
  config: ColumnConfig
): void {
  const all = getColumnConfigs(boardId);
  all[columnName] = config;
  localStorage.setItem(KEYS.columnConfigs(boardId), JSON.stringify(all));
}

// ─── Work Schedule ────────────────────────────────────────────────────────────

export function getWorkSchedule(): WorkSchedule {
  const raw = localStorage.getItem(KEYS.workSchedule);
  if (!raw) return { ...DEFAULT_WORK_SCHEDULE };
  try {
    return { ...DEFAULT_WORK_SCHEDULE, ...(JSON.parse(raw) as Partial<WorkSchedule>) };
  } catch {
    return { ...DEFAULT_WORK_SCHEDULE };
  }
}

export function saveWorkSchedule(schedule: WorkSchedule): void {
  localStorage.setItem(KEYS.workSchedule, JSON.stringify(schedule));
}

// ─── Settings ─────────────────────────────────────────────────────────────────

// ─── Board Status Map (para notificações de mudança de status) ────────────────

/**
 * Retorna o mapa de status do board — usado para detectar mudanças entre syncs.
 * Retorna {} se ainda não houver dados (primeiro sync).
 */
export function getStatusMap(boardId: number): BoardStatusMap {
  const raw = localStorage.getItem(KEYS.statusMap(boardId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BoardStatusMap;
  } catch {
    return {};
  }
}

/** Salva o mapa de status atualizado após um sync */
export function saveStatusMap(boardId: number, map: BoardStatusMap): void {
  localStorage.setItem(KEYS.statusMap(boardId), JSON.stringify(map));
}

// ─── Issue Enrichment Cache ───────────────────────────────────────────────────

/**
 * Retorna o cache de enrichment de uma issue, ou null se não existir.
 * O cache é invalidado quando o status da issue muda (ela saiu da coluna).
 */
export function getIssueEnrichment(issueKey: string): CachedIssueEnrichment | null {
  const raw = localStorage.getItem(KEYS.issueEnrichment(issueKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedIssueEnrichment;
  } catch {
    return null;
  }
}

/** Salva ou atualiza o cache de enrichment de uma issue */
export function saveIssueEnrichment(issueKey: string, data: CachedIssueEnrichment): void {
  localStorage.setItem(KEYS.issueEnrichment(issueKey), JSON.stringify(data));
}

/** Remove o cache de enrichment de uma issue (ex: ao trocar de status) */
export function clearIssueEnrichment(issueKey: string): void {
  localStorage.removeItem(KEYS.issueEnrichment(issueKey));
}

/** Remove todos os caches de enrichment (prefixo jt:enrich:) */
export function clearAllEnrichmentCache(): void {
  const prefix = "jt:enrich:";
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

/** Retorna todos os alertas ativos persistidos */
export function getAlerts(): AppAlert[] {
  try {
    const raw = localStorage.getItem(KEYS.alerts);
    return raw ? (JSON.parse(raw) as AppAlert[]) : [];
  } catch {
    return [];
  }
}

/** Persiste a lista de alertas ativos */
export function saveAlerts(alerts: AppAlert[]): void {
  localStorage.setItem(KEYS.alerts, JSON.stringify(alerts));
}

/** Retorna o conjunto de IDs de alertas silenciados pelo usuário */
export function getSilencedAlerts(): Set<string> {
  try {
    const raw = localStorage.getItem(KEYS.silenced);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Silencia um alerta pelo ID (persiste entre sessões) */
export function silenceAlert(alertId: string): void {
  const silenced = getSilencedAlerts();
  silenced.add(alertId);
  localStorage.setItem(KEYS.silenced, JSON.stringify([...silenced]));
}

/** Remove o silêncio de um alerta */
export function unsilenceAlert(alertId: string): void {
  const silenced = getSilencedAlerts();
  silenced.delete(alertId);
  localStorage.setItem(KEYS.silenced, JSON.stringify([...silenced]));
}

/** Silencia todos os alertas de uma vez */
export function silenceAllAlerts(alertIds: string[]): void {
  const silenced = getSilencedAlerts();
  alertIds.forEach((id) => silenced.add(id));
  localStorage.setItem(KEYS.silenced, JSON.stringify([...silenced]));
}

// ─── Issue Types Cache ────────────────────────────────────────────────────────

/** Retorna os tipos de issue cacheados, ou [] se não houver cache */
export function getCachedIssueTypes(): CachedIssueType[] {
  try {
    const raw = localStorage.getItem(KEYS.issueTypes);
    return raw ? (JSON.parse(raw) as CachedIssueType[]) : [];
  } catch {
    return [];
  }
}

/** Salva os tipos de issue no cache local */
export function saveCachedIssueTypes(types: CachedIssueType[]): void {
  localStorage.setItem(KEYS.issueTypes, JSON.stringify(types));
}

// ─── Custom Fields Cache ──────────────────────────────────────────────────────

/** Retorna os campos personalizados numéricos cacheados, ou [] se não houver cache */
export function getCachedCustomFields(): CachedCustomField[] {
  try {
    const raw = localStorage.getItem(KEYS.customFields);
    return raw ? (JSON.parse(raw) as CachedCustomField[]) : [];
  } catch {
    return [];
  }
}

/** Salva os campos personalizados numéricos no cache local */
export function saveCachedCustomFields(fields: CachedCustomField[]): void {
  localStorage.setItem(KEYS.customFields, JSON.stringify(fields));
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const settings = await getAllSettings();
  return (settings as unknown as Record<string, string>)[key] ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const settings = await getAllSettings();
  (settings as unknown as Record<string, string>)[key] = value;
  await saveAllSettings(settings);
}

// ─── Issue Drafts ─────────────────────────────────────────────────────────────

/** Retorna todos os rascunhos ordenados do mais recente ao mais antigo */
export function getDrafts(): IssueDraft[] {
  try {
    const raw = localStorage.getItem(KEYS.drafts);
    const list = raw ? (JSON.parse(raw) as IssueDraft[]) : [];
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/** Salva (cria ou atualiza) um rascunho pelo id */
export function saveDraft(draft: IssueDraft): void {
  const list = getDrafts();
  const idx  = list.findIndex((d) => d.id === draft.id);
  if (idx >= 0) {
    list[idx] = draft;
  } else {
    list.push(draft);
  }
  localStorage.setItem(KEYS.drafts, JSON.stringify(list));
}

/** Remove um rascunho pelo id */
export function deleteDraft(id: string): void {
  const list = getDrafts().filter((d) => d.id !== id);
  localStorage.setItem(KEYS.drafts, JSON.stringify(list));
}

/** Gera um id único para um novo rascunho */
export function newDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
