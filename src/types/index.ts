// ─── Jira API Types ───────────────────────────────────────────────────────────

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls: {
    "48x48": string;
    "32x32": string;
    "24x24": string;
    "16x16": string;
  };
}

export interface JiraStatus {
  id: string;
  name: string;
  description?: string;
  statusCategory: {
    id: number;
    key: string;
    colorName: string;
    name: string;
  };
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string;
  subtask: boolean;
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown; // Atlassian Document Format
  created: string;
  updated: string;
}

export interface JiraChangelogItem {
  field: string;
  fieldtype: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface JiraChangelogHistory {
  id: string;
  author: JiraUser;
  created: string;
  items: JiraChangelogItem[];
}

export interface JiraIssueFields {
  summary: string;
  status: JiraStatus;
  assignee: JiraUser | null;
  reporter: JiraUser;
  priority: JiraPriority;
  issuetype: JiraIssueType;
  created: string;
  updated: string;
  duedate: string | null;
  description: unknown | null; // ADF
  comment: { comments: JiraComment[]; total: number };
  labels: string[];
  fixVersions: Array<{ id: string; name: string }>;
  components: Array<{ id: string; name: string }>;
  timetracking?: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
    originalEstimateSeconds?: number;
    remainingEstimateSeconds?: number;
    timeSpentSeconds?: number;
  };
  customfield_10020?: Array<{
    // Sprint (pode variar por instância)
    id: number;
    name: string;
    state: string;
    startDate?: string;
    endDate?: string;
  }>;
}

export interface JiraIssueRaw {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
  changelog?: {
    histories: JiraChangelogHistory[];
    total: number;
  };
}

// ─── Tipos locais (salvo no SQLite) ──────────────────────────────────────────

export interface TrackedIssue {
  id: string;           // issue key (ex: AUT-6722)
  issue_key: string;
  project_key: string;
  summary: string;
  status: string;
  status_category: string; // 'new' | 'indeterminate' | 'done'
  assignee_name: string | null;
  assignee_avatar: string | null;
  priority: string;
  issue_type: string;
  reporter_name: string;
  created_at: string;
  updated_at: string;
  raw_data: string;     // JSON stringify do JiraIssueRaw
  tracked_since: string;
  last_synced: string;
}

export interface IssueSnapshot {
  id?: number;
  issue_key: string;
  status: string;
  assignee_name: string | null;
  snapshot_data: string; // JSON
  captured_at: string;
}

export interface IssueInsight {
  id?: number;
  issue_key: string;
  type: InsightType;
  label: string;
  value: string;        // JSON serializable
  created_at: string;
}

export type InsightType =
  | "time_in_status"
  | "status_changes_count"
  | "days_open"
  | "assignee_changes"
  | "note";

export interface AppSettings {
  jira_base_url: string;
  jira_email: string;
  jira_api_token: string;
  sync_interval_minutes: number;
  theme: "light" | "dark" | "system";
  /** Minutos sem interação (mouse fora da janela) para recolher o painel. 0 = desativado. */
  inactivity_timeout_minutes: number;
}

/** Configuração do horário de trabalho para desconto de horas */
export interface WorkSchedule {
  /** Hora de início do expediente (0-23) */
  workStartHour: number;
  workStartMinute: number;
  /** Hora de fim do expediente (0-23) */
  workEndHour: number;
  workEndMinute: number;
  /** Hora de início do almoço */
  lunchStartHour: number;
  lunchStartMinute: number;
  /** Duração do almoço em minutos */
  lunchDurationMinutes: number;
  /**
   * Dias úteis: 0 = Dom, 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex, 6 = Sab
   */
  workDays: number[];
  /** Feriados no formato YYYY-MM-DD */
  holidays: string[];
}

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  workStartHour: 9,
  workStartMinute: 0,
  workEndHour: 18,
  workEndMinute: 0,
  lunchStartHour: 12,
  lunchStartMinute: 0,
  lunchDurationMinutes: 60,
  workDays: [1, 2, 3, 4, 5], // Segunda a Sexta
  holidays: [],
};

export type AppView =
  | "board-setup"   // selecionar projeto + board
  | "column"        // issues de uma coluna (activeColumnName controla qual)
  | "settings"      // configurações
  | "alerts"        // painel de alertas
  | "history"       // histórico de atividade por período
  | "drafts";       // rascunhos de issues a criar no Jira

// ─── Issue Drafts ─────────────────────────────────────────────────────────────

/** Nome do tipo de issue — vem dos tipos reais do projeto Jira (ex: "Story", "Bug", "Task") */
export type DraftIssueType = string;
export type DraftPriority  = "Highest" | "High" | "Medium" | "Low" | "Lowest";

/** Rascunho de issue Jira armazenado localmente, criado no Jira quando o usuário quiser */
export interface IssueDraft {
  id: string;             // UUID local
  title: string;          // summary
  description?: string;   // texto simples → convertido para ADF ao criar
  type: DraftIssueType;   // nome do tipo (Story, Bug, Task, Epic, …)
  priority: DraftPriority;
  labels: string[];
  parentKey?: string;     // chave do epic ou issue pai (ex: AUT-10)
  projectKey?: string;    // sobrescreve o project do board, se necessário
  createdAt: string;      // ISO
  updatedAt: string;      // ISO
}

// ─── Activity History Types ───────────────────────────────────────────────────

/** Uma transição de status que ocorreu dentro do período consultado */
export interface ActivityTransition {
  fromStatus: string;
  toStatus: string;
  at: string;         // ISO timestamp
  authorName: string;
}

/** Uma issue que teve atividade no período consultado */
export interface ActivityIssue {
  id: string;
  key: string;
  summary: string;
  currentStatusName: string;
  issuetype?: { name: string; iconUrl: string };
  priority?: { name: string };
  assignee?: { displayName: string; avatarUrl: string };
  /** Transições de status que ocorreram dentro do período filtrado */
  transitions: ActivityTransition[];
  updatedAt: string; // ISO — última atualização da issue
}

// ─── Dev Activity Types ───────────────────────────────────────────────────────

export type DevActionType = "transition" | "comment" | "flag";

/** Uma ação realizada pelo dev em uma issue */
export interface DevAction {
  type: DevActionType;
  /** Texto descritivo: "Moveu para X", "Adicionou comentário …", "Adicionou Flag", "Removeu Flag" */
  label: string;
  at: string; // ISO timestamp
}

/** Uma issue na qual o dev realizou alguma ação (comentou, moveu, flagou) */
export interface DevActivityIssue {
  id: string;
  key: string;
  summary: string;
  issuetype?: { name: string; iconUrl: string };
  priority?: { name: string };
  /** Ações do dev nessa issue, ordenadas cronologicamente */
  actions: DevAction[];
}

// ─── Agile API Types ──────────────────────────────────────────────────────────

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string; // "software" | "business" | "service_desk"
  avatarUrls?: { "48x48": string };
}

export interface JiraBoard {
  id: number;
  name: string;
  type: "scrum" | "kanban" | string;
  location?: {
    projectKey?: string;
    projectName?: string;
    displayName?: string;
  };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface JiraBoardIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
    assignee: JiraUser | null;
    issuetype: JiraIssueType;
    priority: JiraPriority;
    // Campo de flag (Impediment) — customfield_10003 (Flagged) varia por instância Jira
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customfield_10003?: any;
    /**
     * Issue pai — presente em subtasks (pai = a issue a que pertencem)
     * e em projetos next-gen onde o épico é representado como parent.
     */
    parent?: {
      id: string;
      key: string;
      fields: {
        summary: string;
        issuetype: JiraIssueType;
      };
    };
    /**
     * Epic Link — chave do épico pai em projetos clássicos do Jira.
     * Ex: "PROJ-42". Pode ser null quando não há épico associado.
     */
    customfield_10014?: string | null;
  };
  /** Changelog da issue — presente quando buscamos com expand=changelog */
  changelog?: {
    histories: Array<{
      created: string;
      items: Array<{
        field: string;
        to: string | null;
        toString: string | null;
      }>;
    }>;
  };
  /** Tempo líquido na coluna atual (ms), sem contar períodos flagados. Calculado localmente. */
  timeInColumnMs?: number;
  /** True se a issue estiver atualmente flagada como impedimento */
  isFlagged?: boolean;
  /** Horas estimadas para a issue (do campo customizado configurado na coluna) */
  estimateHours?: number;
  /** Quando a issue entrou no status atual (ISO). Vem do cache de enrichment. */
  enteredAt?: string;
  /**
   * Valores de campos de regra, indexados pelo fieldId.
   * Ex: { "customfield_10028": 4 } — preenchido durante enrichment quando há limitRules com timeMode === "field".
   */
  ruleFieldValues?: Record<string, number>;
}

export interface JiraBoardColumn {
  name: string;
  statuses: Array<{ id: string; self: string }>;
}

// ─── Board View Types ─────────────────────────────────────────────────────────

/** Board selecionado pelo usuário para visualização */
export interface SelectedBoardConfig {
  boardId: number;
  boardName: string;
  boardType: string;          // "scrum" | "kanban" | string
  projectKey: string;
  sprintId?: number;          // sprint ativa (boards Scrum)
  sprintName?: string;
  syncIntervalMinutes: number; // padrão: 5
}

/** Coluna do board com as issues já agrupadas */
export interface BoardColumnWithIssues {
  name: string;
  statusIds: string[];
  issues: JiraBoardIssue[];
}

// ─── Limit Rules ──────────────────────────────────────────────────────────────

/**
 * Uma regra de limite de tempo para uma coluna.
 * Pode ser aplicada a tipos de issue específicos ou a todos (issueTypes vazio).
 */
export interface LimitRule {
  /** UUID único da regra */
  id: string;
  /** Rótulo descritivo (ex: "Melhoria", "Débito Técnico > 16h") */
  description: string;
  /**
   * Tipos de issue a que esta regra se aplica.
   * Lista vazia = regra universal (catch-all / fallback).
   */
  issueTypes: string[];
  /** Modo de tempo: valor fixo em horas ou campo personalizado do Jira */
  timeMode: "fixed" | "field";
  /** Horas fixas do limite — usado quando timeMode === "fixed" */
  fixedHours?: number;
  /** ID do campo personalizado Jira com o valor de horas — timeMode === "field" */
  fieldId?: string;
  /**
   * Unidade do campo personalizado:
   *   "hours"   → valor está em horas (padrão), suporta frações (ex: 0.75 = 45 min)
   *   "minutes" → valor está em minutos (60 min = 1 h, 15 min = 0,25 h…)
   */
  fieldUnit?: "hours" | "minutes";
}

// ─── Metadata cache (Issue Types + Custom Fields) ─────────────────────────────

/** Tipo de issue do Jira, salvo localmente para uso no editor de regras */
export interface CachedIssueType {
  id: string;
  name: string;
  iconUrl?: string;
  subtask: boolean;
  cachedAt: string; // ISO
}

/** Campo personalizado do Jira (numérico), salvo localmente para o editor de regras */
export interface CachedCustomField {
  /** ID do campo — ex: "customfield_10028" */
  id: string;
  /** Nome legível — ex: "Estimativa de Horas de Dev" */
  name: string;
  cachedAt: string; // ISO
}

/** Configuração por coluna: limite de tempo e campo de estimativa */
export interface ColumnConfig {
  /**
   * Limite fixo global (legado — mantido para retrocompatibilidade).
   * Prefira usar limitRules para regras por tipo de issue.
   */
  limitHours?: number;
  /** Regras de limite flexíveis por tipo de issue */
  limitRules?: LimitRule[];
  /**
   * ID do campo customizado do Jira que armazena a estimativa de horas.
   * Ex: "customfield_10028". O valor deve ser numérico (horas).
   */
  estimateFieldId?: string;
  /**
   * Filtra issues mais antigas que N dias na coluna.
   * Útil para colunas "Done"/"Cancelados" com muitos itens históricos.
   * Baseado em enteredAt (data real de entrada, não tempo útil).
   */
  maxAgeDays?: number;
}

// ─── Monitor Types ────────────────────────────────────────────────────────────

/** Configuração do board+coluna que o usuário escolheu monitorar */
export interface BoardMonitorConfig {
  boardId: number;
  boardName: string;
  boardType: string;
  projectKey: string;
  columnName: string;
  columnStatusIds: string[];   // IDs dos statuses Jira que pertencem a esta coluna
  sprintId?: number;           // para boards Scrum
  sprintName?: string;
  syncIntervalMinutes: number; // padrão: 10
  maxColumnHours: number;      // limite de horas na coluna (padrão: 8)
}

/** Período em que o issue esteve com flag de impedimento */
export interface FlagPeriod {
  start: string;   // ISO
  end?: string;    // ISO — undefined significa que ainda está flagado
}

/** Uma passagem do issue pela coluna monitorada */
export interface ColumnEntry {
  enteredAt: string;       // ISO — quando entrou na coluna
  exitedAt?: string;       // ISO — quando saiu (undefined = ainda está lá)
  flagPeriods: FlagPeriod[];
}

/** Issue sendo monitorado (em memória + localStorage) */
export interface MonitoredIssue {
  issueKey: string;
  summary: string;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  estimateSeconds: number | null;  // originalEstimateSeconds do Jira
  statusName: string;
  currentEntry: ColumnEntry | null; // entrada atual na coluna (ainda lá)
  history: ColumnEntry[];           // entradas anteriores (já saiu)
  isFlagged: boolean;
  lastSyncedAt: string;
}

// ─── Status Tracking (para notificações) ──────────────────────────────────────

/**
 * Snapshot do status de uma issue — persistido para detectar mudanças entre syncs.
 * Chave do map: issue key (ex: "AUT-123")
 */
export interface TrackedIssueStatus {
  statusId: string;
  statusName: string;
  columnName: string;
  summary: string;
  assigneeName: string | null;
  capturedAt: string; // ISO
}

/** Map de todos os issues rastreados em um board: { issueKey → TrackedIssueStatus } */
export type BoardStatusMap = Record<string, TrackedIssueStatus>;

/** Uma mudança de status detectada durante um sync */
export interface StatusChange {
  issueKey: string;
  summary: string;
  assigneeName: string | null;
  fromStatus: string;
  toStatus: string;
  fromColumn: string;
  toColumn: string;
}

// ─── Enrichment Cache ─────────────────────────────────────────────────────────

/**
 * Cache de enrichment por issue-key, persistido no localStorage.
 * Elimina chamadas à API em syncs subsequentes: se o status não mudou,
 * recalculamos timeInColumnMs = computeWorkingMs(enteredAt, now) localmente.
 */
export interface CachedIssueEnrichment {
  /** Status ID da issue quando o changelog foi buscado — invalida se mudar */
  statusId: string;
  /** Quando a issue entrou no status atual (ISO) */
  enteredAt: string;
  /** Períodos de flag enquanto está neste status */
  flagPeriods: Array<{ start: string; end?: string }>;
  /** Quando o cache foi gerado */
  fetchedAt: string;
  /**
   * Flag atual da issue — derivado da REST API v3 durante enriquecimento.
   * A Agile API não retorna customfield_10003 de forma confiável,
   * então persistimos aqui para que o card exiba corretamente entre syncs.
   */
  isFlagged?: boolean;
  /**
   * Valores dos campos de regras de limite (fieldId → valor numérico).
   * Persistidos para que o motor de alertas possa avaliar limites
   * baseados em campo durante os syncs de fundo (sem enriquecimento completo).
   */
  ruleFieldValues?: Record<string, number>;
}

// ─── Alert System ────────────────────────────────────────────────────────────

/** Tipos de alerta suportados pelo sistema */
export type AlertKind =
  | "time_warning"   // Issue atingiu ≥75% do limite de tempo da coluna
  | "time_breach"    // Issue ultrapassou o limite de tempo (≥100%)
  | "column_change"  // Issue mudou de coluna
  | "flagged";       // Issue foi flegada como impedimento

/** Um alerta de notificação com ID determinístico para deduplicação */
export interface AppAlert {
  /** ID único: "{kind}:{issueKey}" — permite detectar duplicatas entre syncs */
  id: string;
  kind: AlertKind;
  issueKey: string;
  summary: string;
  boardName: string;
  /** Texto legível da notificação (ex: "85% do limite atingido") */
  message: string;
  /** Percentual do limite atingido (apenas para time_warning e time_breach) */
  pct?: number;
  /** Coluna onde a issue se encontra no momento do alerta */
  columnName?: string;
  /** Quando o alerta foi detectado pela primeira vez */
  createdAt: string;
  /** Quando o usuário silenciou este alerta (undefined = ativo) */
  silencedAt?: string;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

export interface StatusBadgeConfig {
  label: string;
  color: string;
  bgColor: string;
}

export const STATUS_CATEGORY_COLORS: Record<string, StatusBadgeConfig> = {
  new: {
    label: "A fazer",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
  },
  indeterminate: {
    label: "Em andamento",
    color: "text-yellow-700",
    bgColor: "bg-yellow-100",
  },
  done: {
    label: "Concluído",
    color: "text-green-700",
    bgColor: "bg-green-100",
  },
};
