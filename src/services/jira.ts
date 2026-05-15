import type {
  JiraIssueRaw,
  JiraProject,
  JiraBoard,
  JiraBoardColumn,
  JiraSprint,
  JiraBoardIssue,
  MonitoredIssue,
  ColumnEntry,
  TrackedIssue,
  IssueSnapshot,
  AppSettings,
  WorkSchedule,
  LimitRule,
  CachedIssueType,
  CachedCustomField,
  IssueDraft,
} from "../types";
import { DEFAULT_WORK_SCHEDULE } from "../types";
import {
  upsertTrackedIssue,
  saveSnapshot,
  getTrackedIssue,
  getIssueEnrichment,
  saveIssueEnrichment,
} from "./db";

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

function makeAuthHeader(email: string, token: string): string {
  return "Basic " + btoa(`${email}:${token}`);
}

/**
 * Em dev (Vite), usa o proxy /jira/* para evitar CORS.
 * Em produção (build), usa a URL direta do Jira.
 */
function resolveUrl(baseUrl: string, path: string): string {
  if (import.meta.env.DEV) {
    // Vite proxy: /jira/rest/api/... → https://empresa.atlassian.net/rest/api/...
    return `/jira${path}`;
  }
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function jiraFetch<T>(
  baseUrl: string,
  email: string,
  apiToken: string,
  path: string
): Promise<T> {
  const url = resolveUrl(baseUrl, path);
  // Em dev, o proxy Vite injeta o Authorization via .env (server-side)
  // Em produção, enviamos direto do browser
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!import.meta.env.DEV) {
    headers.Authorization = makeAuthHeader(email, apiToken);
  }

  const response = await fetch(url, { method: "GET", headers });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Jira API ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/** POST genérico para a API do Jira — mesmo padrão de auth de jiraFetch */
async function jiraPost<T>(
  baseUrl: string,
  email: string,
  apiToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const url = resolveUrl(baseUrl, path);
  const headers: Record<string, string> = {
    "Accept":       "application/json",
    "Content-Type": "application/json",
  };
  if (!import.meta.env.DEV) {
    headers.Authorization = makeAuthHeader(email, apiToken);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Jira API ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractProjectKey(issueKey: string): string {
  return issueKey.split("-")[0];
}

function now(): string {
  return new Date().toISOString();
}

export function rawToTracked(raw: JiraIssueRaw, trackedSince?: string): TrackedIssue {
  const fields = raw.fields;
  const statusCat = fields.status.statusCategory.key;

  return {
    id: raw.key,
    issue_key: raw.key,
    project_key: extractProjectKey(raw.key),
    summary: fields.summary,
    status: fields.status.name,
    status_category: statusCat,
    assignee_name: fields.assignee?.displayName ?? null,
    assignee_avatar: fields.assignee?.avatarUrls["48x48"] ?? null,
    priority: fields.priority?.name ?? "None",
    issue_type: fields.issuetype?.name ?? "Task",
    reporter_name: fields.reporter?.displayName ?? "",
    created_at: fields.created,
    updated_at: fields.updated,
    raw_data: JSON.stringify(raw),
    tracked_since: trackedSince ?? now(),
    last_synced: now(),
  };
}

// ─── API Calls (fetch nativo, sem Tauri invoke) ───────────────────────────────

export async function validateCredentials(settings: AppSettings): Promise<{
  success: boolean;
  user?: { displayName: string; emailAddress: string };
  error?: string;
}> {
  try {
    const user = await jiraFetch<{ displayName: string; emailAddress: string }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      "/rest/api/3/myself"
    );
    return { success: true, user };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function fetchAndTrackIssue(
  issueKey: string,
  settings: AppSettings
): Promise<TrackedIssue> {
  const upperKey = issueKey.toUpperCase().trim();

  const raw = await jiraFetch<JiraIssueRaw>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/api/3/issue/${upperKey}?expand=changelog`
  );

  const existing = await getTrackedIssue(upperKey);
  const tracked = rawToTracked(raw, existing?.tracked_since);

  if (existing && existing.status !== tracked.status) {
    await saveSnapshot({
      issue_key: upperKey,
      status: tracked.status,
      assignee_name: tracked.assignee_name,
      snapshot_data: JSON.stringify({
        prev_status: existing.status,
        new_status: tracked.status,
      }),
      captured_at: now(),
    });
  } else if (!existing) {
    await saveSnapshot({
      issue_key: upperKey,
      status: tracked.status,
      assignee_name: tracked.assignee_name,
      snapshot_data: JSON.stringify({ initial: true }),
      captured_at: now(),
    });
  }

  await upsertTrackedIssue(tracked);
  return tracked;
}

export async function syncAllIssues(
  trackedKeys: string[],
  settings: AppSettings,
  onProgress?: (current: number, total: number) => void
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  for (let i = 0; i < trackedKeys.length; i++) {
    try {
      await fetchAndTrackIssue(trackedKeys[i], settings);
      updated++;
    } catch (e) {
      errors.push(`${trackedKeys[i]}: ${String(e)}`);
    }
    onProgress?.(i + 1, trackedKeys.length);
  }

  return { updated, errors };
}

// ─── Agile API ────────────────────────────────────────────────────────────────

/** Lista todos os projetos acessíveis pela conta */
export async function fetchProjects(settings: AppSettings): Promise<JiraProject[]> {
  const data = await jiraFetch<{ values: JiraProject[] }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    "/rest/api/3/project/search?maxResults=100&orderBy=name&typeKey=software"
  );
  return data.values ?? [];
}

/** Lista todos os boards acessíveis pela conta */
export async function fetchBoards(settings: AppSettings): Promise<JiraBoard[]> {
  const data = await jiraFetch<{ values: JiraBoard[] }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    "/rest/agile/1.0/board?maxResults=50"
  );
  return data.values ?? [];
}

/** Lista boards de um projeto específico (pela project key, ex: "AUT") */
export async function fetchBoardsByProject(
  projectKey: string,
  settings: AppSettings
): Promise<JiraBoard[]> {
  const data = await jiraFetch<{ values: JiraBoard[] }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=50`
  );
  return data.values ?? [];
}

/** Busca a sprint ativa de um board. Retorna null se não houver sprint ativa. */
export async function fetchActiveSprint(
  boardId: number,
  settings: AppSettings
): Promise<JiraSprint | null> {
  const data = await jiraFetch<{ values: JiraSprint[] }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`
  );
  return data.values?.[0] ?? null;
}

// Campos comuns para busca de issues do board view
const BOARD_ISSUE_FIELDS = "summary,status,assignee,issuetype,priority,customfield_10003,parent,customfield_10014";

/**
 * Busca todas as páginas de um endpoint paginado da API Agile.
 * O Jira retorna `total` + `maxResults` + `startAt` para controle de paginação.
 */
async function fetchAllPages<T>(
  settings: AppSettings,
  buildPath: (startAt: number) => string,
  pageSize = 100
): Promise<T[]> {
  const all: T[] = [];
  let startAt = 0;

  while (true) {
    const data = await jiraFetch<{ issues: T[]; total: number; maxResults: number }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      buildPath(startAt)
    );

    const page = data.issues ?? [];
    all.push(...page);

    // Sem mais páginas: retornou menos que o solicitado ou já coletamos tudo
    if (page.length < pageSize || all.length >= data.total) break;
    startAt += page.length;
  }

  return all;
}

/** Busca as issues de uma sprint específica (boards Scrum) */
export async function fetchSprintIssues(
  sprintId: number,
  settings: AppSettings
): Promise<JiraBoardIssue[]> {
  return fetchAllPages<JiraBoardIssue>(
    settings,
    (startAt) =>
      `/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=100&fields=${BOARD_ISSUE_FIELDS}`
  );
}

/** Busca as issues diretamente do board (boards Kanban, sem sprint) */
export async function fetchBoardIssues(
  boardId: number,
  settings: AppSettings
): Promise<JiraBoardIssue[]> {
  return fetchAllPages<JiraBoardIssue>(
    settings,
    (startAt) =>
      `/rest/agile/1.0/board/${boardId}/issue?startAt=${startAt}&maxResults=100&fields=${BOARD_ISSUE_FIELDS}`
  );
}

/**
 * Busca issues por status IDs via JQL, ignorando o filtro do board.
 * Usado pelo "Carregar mais" para trazer issues antigas de colunas Done.
 *
 * @param statusIds  IDs dos statuses da coluna
 * @param projectKey Chave do projeto (ex: "RTF")
 * @param startAt    Offset para paginação
 * @param maxResults Quantidade máxima por página (default 100)
 */
export async function fetchIssuesByStatusIds(
  statusIds: string[],
  projectKey: string,
  settings: AppSettings,
  startAt = 0,
  maxResults = 100
): Promise<{ issues: JiraBoardIssue[]; total: number }> {
  const jql = encodeURIComponent(
    `project = "${projectKey}" AND status in (${statusIds.join(",")}) ORDER BY updated DESC`
  );
  const data = await jiraFetch<{ issues: JiraBoardIssue[]; total: number }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${BOARD_ISSUE_FIELDS}`
  );
  return { issues: data.issues ?? [], total: data.total ?? 0 };
}

// ─── Activity History ──────────────────────────────────────────────────────────

/** Shape bruta da API de search com expand=changelog */
interface RawActivityIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    updated: string;
    assignee?: { displayName: string; avatarUrls: { "32x32": string } };
    issuetype?: { name: string; iconUrl: string };
    priority?: { name: string };
  };
  changelog?: {
    histories: Array<{
      created: string;
      author: { displayName: string };
      items: Array<{ field: string; fromString: string; toString: string }>;
    }>;
  };
}

function formatJqlDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Busca de usuários ────────────────────────────────────────────────────────

interface RawJiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active?: boolean;
}

export interface JiraUser {
  accountId:    string;
  displayName:  string;
  avatarUrl?:   string;
  emailAddress?: string;
}

/**
 * Busca usuários no Jira pela query (nome, e-mail, username).
 * Retorna no máximo 10 resultados ativos.
 */
export async function searchJiraUsers(
  query: string,
  settings: AppSettings,
  projectKey?: string
): Promise<JiraUser[]> {
  if (!query.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const projectParam = projectKey ? `&project=${encodeURIComponent(projectKey)}` : "";
  try {
    const users = await jiraFetch<RawJiraUser[]>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      `/rest/api/3/user/search?query=${q}&maxResults=10${projectParam}`
    );
    return (users ?? [])
      .filter((u) => u.active !== false)
      .map((u) => ({
        accountId:    u.accountId,
        displayName:  u.displayName,
        avatarUrl:    u.avatarUrls?.["32x32"],
        emailAddress: u.emailAddress,
      }));
  } catch {
    return [];
  }
}

// ─── Histórico de atividade ───────────────────────────────────────────────────

/**
 * Retorna issues atribuídas ao usuário que foram atualizadas no período,
 * com as transições de status que ocorreram dentro do intervalo.
 *
 * Usa currentUser() no JQL — funciona com autenticação via API token e
 * é compatível com Jira Cloud moderno (que não aceita email direto no JQL).
 *
 * @param targetAccountId  accountId do usuário alvo; null = currentUser()
 * @param startDate        Início do período (inclusive)
 * @param endDate          Fim do período (inclusive, até 23:59:59)
 * @param projectKey       Opcional — restringe ao projeto do board ativo
 */
export async function fetchActivityHistory(
  targetAccountId: string | null,
  startDate: Date,
  endDate: Date,
  settings: AppSettings,
  projectKey?: string
): Promise<import("../types").ActivityIssue[]> {
  const start = formatJqlDate(startDate);
  // Jira trata datas como dia todo; para incluir endDate completamente
  // usamos o dia seguinte com operador <
  const dayAfter = new Date(endDate);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const end = formatJqlDate(dayAfter);

  const projectFilter = projectKey ? ` AND project = "${projectKey}"` : "";
  // "assignee was X" inclui issues em que o usuário foi assignee em algum
  // momento — essencial para capturar tarefas entregues/reatribuídas.
  const assigneeClause = targetAccountId
    ? `(assignee = "${targetAccountId}" OR assignee was "${targetAccountId}")`
    : `(assignee = currentUser() OR assignee was currentUser())`;
  const jql = encodeURIComponent(
    `${assigneeClause}${projectFilter}` +
    ` AND updated >= "${start}" AND updated < "${end}" ORDER BY updated DESC`
  );

  const data = await jiraFetch<{ issues: RawActivityIssue[]; total: number }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=100` +
      `&fields=summary,status,assignee,issuetype,priority,updated&expand=changelog`
  );

  const startMs = startDate.getTime();
  const endMs   = new Date(endDate).setHours(23, 59, 59, 999);

  return (data.issues ?? []).map((raw): import("../types").ActivityIssue => {
    const transitions: import("../types").ActivityTransition[] = [];
    for (const history of raw.changelog?.histories ?? []) {
      const histMs = new Date(history.created).getTime();
      if (histMs < startMs || histMs > endMs) continue;
      for (const item of history.items) {
        if (item.field !== "status") continue;
        transitions.push({
          fromStatus: item.fromString,
          toStatus:   item.toString,
          at:         history.created,
          authorName: history.author.displayName,
        });
      }
    }
    return {
      id:                raw.id,
      key:               raw.key,
      summary:           raw.fields.summary,
      currentStatusName: raw.fields.status.name,
      issuetype:         raw.fields.issuetype,
      priority:          raw.fields.priority,
      assignee:          raw.fields.assignee
        ? { displayName: raw.fields.assignee.displayName, avatarUrl: raw.fields.assignee.avatarUrls["32x32"] }
        : undefined,
      transitions,
      updatedAt: raw.fields.updated,
    };
  });
}

// ─── Detalhe completo de uma issue ───────────────────────────────────────────

export interface IssueAttachment {
  id:         string;
  filename:   string;
  mimeType:   string;
  content:    string;    // URL de download (requer auth)
  thumbnail?: string;    // URL de thumbnail (apenas imagens, requer auth)
  size:       number;    // bytes
}

export interface IssueDetail {
  id:         string;
  key:        string;
  summary:    string;
  description: string;        // texto extraído do ADF
  status:     { name: string; statusCategory: { colorName: string } };
  issuetype?: { name: string; iconUrl: string };
  priority?:  { name: string; iconUrl?: string };
  assignee?:  { displayName: string; avatarUrl: string; emailAddress?: string };
  reporter?:  { displayName: string; avatarUrl: string };
  labels:     string[];
  created:    string;  // ISO
  updated:    string;  // ISO
  parent?: { key: string; summary: string };
  attachments: IssueAttachment[];
  comments: Array<{
    id:          string;
    author:      { displayName: string; avatarUrl: string };
    body:        string;  // texto extraído
    created:     string;
  }>;
  history: Array<{
    created:   string;
    author:    { displayName: string; avatarUrl?: string };
    fromStatus?: string;
    toStatus?:   string;
    field:       string;
    fromString:  string;
    toString:    string;
  }>;
}

/**
 * Busca o detalhe completo de uma issue (descrição, reporter, labels, comentários,
 * histórico de mudanças) via REST API v3.
 */
export async function fetchIssueDetail(
  issueKey: string,
  settings: AppSettings
): Promise<IssueDetail> {
  const fields = [
    "summary", "description", "status", "issuetype", "priority",
    "assignee", "reporter", "labels", "created", "updated",
    "comment", "parent", "attachment",
  ].join(",");

  const raw = await jiraFetch<{
    id: string;
    key: string;
    fields: {
      summary: string;
      description: unknown;
      status: { name: string; statusCategory: { colorName: string } };
      issuetype?: { name: string; iconUrl: string };
      priority?: { name: string; iconUrl?: string };
      assignee?: { displayName: string; avatarUrls: Record<string, string>; emailAddress?: string } | null;
      reporter?: { displayName: string; avatarUrls: Record<string, string> } | null;
      labels?: string[];
      created: string;
      updated: string;
      parent?: { key: string; fields: { summary: string } };
      attachment?: Array<{
        id:        string;
        filename:  string;
        mimeType:  string;
        content:   string;
        thumbnail?: string;
        size:      number;
      }>;
      comment?: {
        comments: Array<{
          id: string;
          author: { displayName: string; avatarUrls: Record<string, string> };
          body: unknown;
          created: string;
        }>;
      };
    };
    changelog?: {
      histories: Array<{
        created: string;
        author: { displayName: string; avatarUrls?: Record<string, string> };
        items: Array<{ field: string; fromString: string; toString: string }>;
      }>;
    };
  }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}&expand=changelog`
  );

  const f = raw.fields;

  const comments = (f.comment?.comments ?? []).map((c) => ({
    id:     c.id,
    author: {
      displayName: c.author.displayName,
      avatarUrl:   c.author.avatarUrls?.["32x32"] ?? "",
    },
    body:    extractAdfText(c.body),
    created: c.created,
  }));

  const history = (raw.changelog?.histories ?? [])
    .flatMap((h) =>
      h.items.map((item) => ({
        created:   h.created,
        author:    {
          displayName: h.author.displayName,
          avatarUrl:   h.author.avatarUrls?.["32x32"],
        },
        field:      item.field,
        fromString: item.fromString,
        toString:   item.toString,
        ...(item.field === "status"
          ? { fromStatus: item.fromString, toStatus: item.toString }
          : {}),
      }))
    )
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  return {
    id:          raw.id,
    key:         raw.key,
    summary:     f.summary,
    description: extractAdfText(f.description),
    status:      f.status,
    issuetype:   f.issuetype,
    priority:    f.priority,
    assignee:    f.assignee
      ? { displayName: f.assignee.displayName, avatarUrl: f.assignee.avatarUrls?.["32x32"] ?? "", emailAddress: f.assignee.emailAddress }
      : undefined,
    reporter:    f.reporter
      ? { displayName: f.reporter.displayName, avatarUrl: f.reporter.avatarUrls?.["32x32"] ?? "" }
      : undefined,
    labels:      f.labels ?? [],
    created:     f.created,
    updated:     f.updated,
    parent:      f.parent ? { key: f.parent.key, summary: f.parent.fields.summary } : undefined,
    attachments: (f.attachment ?? []).map((a) => ({
      id:        a.id,
      filename:  a.filename,
      mimeType:  a.mimeType,
      content:   a.content,
      thumbnail: a.thumbnail,
      size:      a.size,
    })),
    comments,
    history,
  };
}

/**
 * Faz download de conteúdo binário (imagens, anexos) com autenticação Jira.
 * Em dev usa o proxy Vite; em produção envia o header Authorization diretamente.
 */
export async function jiraFetchBlob(
  contentUrl: string,
  settings: AppSettings
): Promise<Blob> {
  let url: string;
  if (import.meta.env.DEV) {
    // Extrai apenas o path+query e roteia pelo proxy Vite /jira/*
    try {
      const parsed = new URL(contentUrl);
      url = `/jira${parsed.pathname}${parsed.search}`;
    } catch {
      url = contentUrl;
    }
  } else {
    url = contentUrl;
  }

  const headers: Record<string, string> = {};
  if (!import.meta.env.DEV) {
    headers.Authorization = makeAuthHeader(settings.jira_email, settings.jira_api_token);
  }

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`Jira media ${response.status}: ${response.statusText}`);
  }
  return response.blob();
}

// ─── Dev Activity (rastro de ações do dev por issue) ─────────────────────────

interface RawDevIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype?: { name: string; iconUrl: string };
    priority?: { name: string };
    comment?: {
      comments: Array<{
        id: string;
        author: { accountId: string; displayName: string };
        body: unknown; // ADF (Atlassian Document Format)
        created: string;
      }>;
    };
  };
  changelog?: {
    histories: Array<{
      created: string;
      author: { accountId: string; displayName: string };
      items: Array<{
        field: string;
        fromString: string;
        toString: string;
      }>;
    }>;
  };
}

/** Extrai texto puro de um nó ADF (Atlassian Document Format) */
function extractAdfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(extractAdfText).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Busca todas as ações que um dev realizou em issues do projeto no período.
 *
 * Critério: NÃO atribuição — rastreia comentários, transições de status e
 * mudanças de flag feitas pelo usuário em QUALQUER issue atualizada no período.
 *
 * @param targetAccountId  accountId do usuário alvo (obrigatório)
 * @param startDate        Início do período (inclusive)
 * @param endDate          Fim do período (inclusive, até 23:59:59)
 * @param projectKey       Opcional — restringe ao projeto do board ativo
 */
export interface DevActivityResult {
  issues: import("../types").DevActivityIssue[];
  /** true quando a paginação atingiu o limite (300 issues) e pode haver mais */
  truncated: boolean;
}

export async function fetchDevActivity(
  targetAccountId: string,
  startDate: Date,
  endDate: Date,
  settings: AppSettings,
  projectKey?: string
): Promise<DevActivityResult> {
  const start = formatJqlDate(startDate);

  // Não usamos limite superior no JQL — se usássemos `updated < endDate`,
  // issues em que o dev trabalhou no período mas foram atualizados *depois*
  // não apareceriam (o campo `updated` reflete a data de atualização atual,
  // não quando o dev agiu). O filtro preciso por data é feito client-side
  // usando `history.created` e `comment.created`.
  const projectFilter = projectKey ? `project = "${projectKey}" AND ` : "";
  const jql = encodeURIComponent(
    `${projectFilter}updated >= "${start}" ORDER BY updated DESC`
  );

  const startMs = startDate.getTime();
  const endMs   = new Date(endDate).setHours(23, 59, 59, 999);

  // Pagina até 3 páginas (300 issues) para cobrir projetos com muita movimentação.
  // Para períodos recentes isso é mais que suficiente; para períodos distantes
  // o filtro client-side garante que só apareça o que realmente ocorreu no período.
  const PAGE_SIZE = 100;
  const MAX_PAGES = 3;
  const allRaw: RawDevIssue[] = [];
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await jiraFetch<{ issues: RawDevIssue[]; total: number }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      `/rest/api/3/search/jql?jql=${jql}&maxResults=${PAGE_SIZE}&startAt=${page * PAGE_SIZE}` +
        `&fields=summary,issuetype,priority,comment&expand=changelog`
    );
    allRaw.push(...(data.issues ?? []));
    if ((data.issues ?? []).length < PAGE_SIZE) break; // última página
    if (page === MAX_PAGES - 1) truncated = true; // atingiu o limite
  }

  // Deduplica por id — a paginação por `updated DESC` pode repetir issues
  // se uma delas for atualizada enquanto a busca está em andamento.
  const seenIds = new Set<string>();
  const uniqueRaw = allRaw.filter(r => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });

  const results: import("../types").DevActivityIssue[] = [];

  for (const raw of uniqueRaw) {
    const actions: import("../types").DevAction[] = [];

    // ── Changelog: transições de status e mudanças de flag ─────────────────
    for (const history of raw.changelog?.histories ?? []) {
      if (history.author.accountId !== targetAccountId) continue;
      const histMs = new Date(history.created).getTime();
      if (histMs < startMs || histMs > endMs) continue;

      for (const item of history.items) {
        if (item.field === "status") {
          actions.push({
            type: "transition",
            label: `Moveu para ${item.toString}`,
            at: history.created,
          });
        } else if (item.field === "Flagged") {
          const isAdd = item.toString === "Impediment";
          actions.push({
            type: "flag",
            label: isAdd ? "Adicionou Flag" : "Removeu Flag",
            at: history.created,
          });
        }
      }
    }

    // ── Comentários ────────────────────────────────────────────────────────
    for (const comment of raw.fields.comment?.comments ?? []) {
      if (comment.author.accountId !== targetAccountId) continue;
      const commentMs = new Date(comment.created).getTime();
      if (commentMs < startMs || commentMs > endMs) continue;

      const text = extractAdfText(comment.body);
      const snippet = text.length > 60 ? text.slice(0, 60).trimEnd() + "…" : text;
      actions.push({
        type: "comment",
        label: `Adicionou comentário${snippet ? `: ${snippet}` : ""}`,
        at: comment.created,
      });
    }

    if (actions.length === 0) continue;

    // Ordena cronologicamente
    actions.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    results.push({
      id:       raw.id,
      key:      raw.key,
      summary:  raw.fields.summary,
      issuetype: raw.fields.issuetype,
      priority:  raw.fields.priority,
      actions,
    });
  }

  return { issues: results, truncated };
}

/** Retorna o accountId do usuário autenticado via /rest/api/3/myself */
export async function fetchCurrentUserAccountId(settings: AppSettings): Promise<string | null> {
  try {
    const me = await jiraFetch<{ accountId: string }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      "/rest/api/3/myself"
    );
    return me.accountId ?? null;
  } catch {
    return null;
  }
}

// ─── Metadados: Issue Types e Custom Fields ────────────────────────────────────

/**
 * Busca todos os tipos de issue do Jira e retorna como CachedIssueType[].
 * Use o resultado para popular o multi-select de tipos no editor de regras.
 */
export async function fetchIssueTypes(settings: AppSettings): Promise<CachedIssueType[]> {
  const raw = await jiraFetch<Array<{
    id: string;
    name: string;
    iconUrl?: string;
    subtask: boolean;
  }>>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    "/rest/api/3/issuetype"
  );
  const now = new Date().toISOString();
  return raw.map((t) => ({
    id: t.id,
    name: t.name,
    iconUrl: t.iconUrl,
    subtask: t.subtask,
    cachedAt: now,
  }));
}

/**
 * Busca todos os campos personalizados do Jira e filtra os de tipo numérico.
 * Campos numéricos (schema.type === "number") são candidatos a armazenar estimativas em horas.
 */
export async function fetchCustomFields(settings: AppSettings): Promise<CachedCustomField[]> {
  const raw = await jiraFetch<Array<{
    id: string;
    name: string;
    custom: boolean;
    schema?: { type: string; custom?: string };
  }>>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    "/rest/api/3/field"
  );
  const now = new Date().toISOString();
  // Filtra apenas campos personalizados numéricos (ex: estimativas de horas)
  return raw
    .filter(
      (f) =>
        f.custom &&
        f.id.startsWith("customfield_") &&
        (f.schema?.type === "number" ||
          f.schema?.custom?.toLowerCase().includes("float") ||
          f.schema?.custom?.toLowerCase().includes("number"))
    )
    .map((f) => ({ id: f.id, name: f.name, cachedAt: now }));
}

/**
 * Enriquece as issues de uma coluna com:
 *  - Changelog → tempo na coluna + detecção de flag
 *  - Campo de estimativa (opcional) → horas estimadas pelo time
 *  - Campos das regras de limite (opcional) → valores numéricos por fieldId
 *
 * Chamado apenas quando o usuário abre uma coluna — não afeta o sync do board.
 * Usa a REST API v3 (suporte a expand=changelog garantido).
 *
 * @param estimateFieldId  ID do campo customizado de estimativa (ex: "customfield_10028")
 * @param limitRules       Regras de limite flexíveis — coletamos os fieldIds para buscar
 */
export async function enrichColumnIssues(
  issues: JiraBoardIssue[],
  statusIds: string[],
  settings: AppSettings,
  estimateFieldId?: string,
  schedule: WorkSchedule = DEFAULT_WORK_SCHEDULE,
  limitRules?: LimitRule[]
): Promise<JiraBoardIssue[]> {
  if (issues.length === 0) return issues;

  // Coleta os fieldIds únicos das regras de limite com timeMode === "field"
  const ruleFieldIds = [
    ...new Set(
      (limitRules ?? [])
        .filter((r) => r.timeMode === "field" && r.fieldId)
        .map((r) => r.fieldId as string)
    ),
  ];

  // Monta lista de fields a buscar (flag + estimativa + campos de regras)
  const extraFields = ["customfield_10003", estimateFieldId, ...ruleFieldIds]
    .filter(Boolean)
    .join(",");

  // Busca changelog em paralelo (máx 6 simultâneas para não sobrecarregar)
  const CHUNK = 6;
  const enriched: JiraBoardIssue[] = [...issues];

  for (let i = 0; i < issues.length; i += CHUNK) {
    const chunk = issues.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (issue, idx) => {
        try {
          // ── Verifica cache antes de chamar a API ───────────────────────────
          const cached = getIssueEnrichment(issue.key);
          const flagField = issue.fields.customfield_10003;
          const currentlyFlagged = Array.isArray(flagField)
            ? flagField.some((f: { value?: string }) => f?.value === "Impediment")
            : flagField === "Impediment";

          const cacheValid =
            cached !== null &&
            cached.statusId === issue.fields.status.id &&
            // Se a issue está flagada agora, garante que o cache tem um período aberto
            (!currentlyFlagged || cached.flagPeriods.some((p) => !p.end));

          if (cacheValid && !estimateFieldId && ruleFieldIds.length === 0) {
            // Cache hit sem campos extras: recalcula tempo localmente, sem API
            enriched[i + idx] = applyEnrichmentCacheToIssue(issue, cached, schedule);
            return;
          }

          // ── Cache miss ou precisa de campo de estimativa: busca da API ────
          const raw = await jiraFetch<{
            changelog?: JiraBoardIssue["changelog"];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fields?: Record<string, any>;
          }>(
            settings.jira_base_url,
            settings.jira_email,
            settings.jira_api_token,
            `/rest/api/3/issue/${issue.key}?fields=${extraFields}&expand=changelog`
          );

          const withCL: JiraBoardIssue = {
            ...issue,
            changelog: raw.changelog,
            fields: {
              ...issue.fields,
              customfield_10003: raw.fields?.customfield_10003,
            },
          };

          const { timeMs, isFlagged, enteredAt, flagPeriods } = computeTimeInColumn(withCL, statusIds, schedule);

          // Extrai estimativa do campo configurado (valor numérico = horas)
          let estimateHours: number | undefined;
          if (estimateFieldId && raw.fields?.[estimateFieldId] != null) {
            const val = raw.fields[estimateFieldId];
            // Suporta: número direto (horas) ou objeto { value: number }
            const raw_val = typeof val === "object" && val !== null ? val.value ?? val : val;
            const parsed = parseFloat(String(raw_val));
            if (!isNaN(parsed) && parsed > 0) estimateHours = parsed;
          }

          // Extrai valores dos campos de regras de limite
          const ruleFieldValues: Record<string, number> = {};
          for (const fieldId of ruleFieldIds) {
            const val = raw.fields?.[fieldId];
            if (val != null) {
              const raw_val = typeof val === "object" && val !== null ? val.value ?? val : val;
              const parsed = parseFloat(String(raw_val));
              if (!isNaN(parsed) && parsed >= 0) ruleFieldValues[fieldId] = parsed;
            }
          }

          // Salva no cache para sincronizações futuras.
          // ruleFieldValues é incluído para que o motor de alertas possa
          // avaliar limites baseados em campo sem precisar de um enriquecimento completo.
          if (enteredAt) {
            saveIssueEnrichment(issue.key, {
              statusId: issue.fields.status.id,
              enteredAt,
              flagPeriods,
              isFlagged,
              fetchedAt: new Date().toISOString(),
              ruleFieldValues: Object.keys(ruleFieldValues).length > 0 ? ruleFieldValues : undefined,
            });
          }

          enriched[i + idx] = {
            ...withCL,
            timeInColumnMs: timeMs,
            isFlagged,
            estimateHours,
            enteredAt: enteredAt ?? undefined,
            ruleFieldValues: Object.keys(ruleFieldValues).length > 0 ? ruleFieldValues : undefined,
          };
        } catch {
          // Falha silenciosa: issue aparece sem tempo na coluna
          enriched[i + idx] = { ...issue, timeInColumnMs: 0, isFlagged: false };
        }
      })
    );
  }

  return enriched;
}

/**
 * Extrai o ID numérico de um status — lida com ambos os formatos que o Jira pode retornar:
 *  - Numérico direto: "10000"
 *  - URL completa: "https://empresa.atlassian.net/rest/agile/1.0/status/10000"
 */
function normalizeStatusId(idOrUrl: string): string {
  const match = idOrUrl.match(/\/(\d+)$/);
  return match ? match[1] : idOrUrl;
}

/** Busca a configuração de colunas de um board */
export async function fetchBoardColumns(
  boardId: number,
  settings: AppSettings
): Promise<JiraBoardColumn[]> {
  const data = await jiraFetch<{
    columnConfig: { columns: JiraBoardColumn[] };
  }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/agile/1.0/board/${boardId}/configuration`
  );

  const columns = data.columnConfig?.columns ?? [];

  // Normaliza os status IDs: o Jira Cloud às vezes retorna a URL completa do status
  // em vez do ID numérico, o que quebraria o matching com issue.fields.status.id
  return columns.map((col) => ({
    ...col,
    statuses: col.statuses.map((s) => ({
      ...s,
      id: normalizeStatusId(s.id),
    })),
  }));
}

// Tipo raw para issues com changelog e timetracking
interface MonitorIssueRaw {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
    assignee: RawAssignee | null;
    timetracking?: {
      originalEstimateSeconds?: number;
    };
    // Campo de flag (customfield_10003) — valor varia por instância
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customfield_10003?: any;
  };
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
}

// Tipos auxiliares para o jiraFetch interno
interface RawAssignee { displayName: string; avatarUrls: { "32x32": string; "48x48": string } }
interface JiraStatus { id: string; name: string; statusCategory: { key: string } }

/**
 * Busca as issues em determinados status (coluna monitorada) com changelog e timetracking.
 * Usa JQL para filtrar pelo board + status IDs.
 */
export async function fetchMonitorIssues(
  boardId: number,
  statusIds: string[],
  settings: AppSettings
): Promise<MonitoredIssue[]> {
  const statusList = statusIds.map((id) => `"${id}"`).join(",");
  const jql = encodeURIComponent(`status in (${statusList}) ORDER BY updated DESC`);

  const data = await jiraFetch<{ issues: MonitorIssueRaw[] }>(
    settings.jira_base_url,
    settings.jira_email,
    settings.jira_api_token,
    `/rest/agile/1.0/board/${boardId}/issue?jql=${jql}&maxResults=100` +
      `&fields=summary,status,assignee,timetracking,customfield_10003` +
      `&expand=changelog`
  );

  const now = new Date().toISOString();

  return (data.issues ?? []).map((raw): MonitoredIssue => {
    // Detecta flag atual: customfield_10003 pode ser array [{value:"Impediment"}] ou string
    const flagField = raw.fields.customfield_10003;
    const isFlagged =
      Array.isArray(flagField)
        ? flagField.some((f: { value?: string }) => f?.value === "Impediment")
        : flagField === "Impediment";

    // Encontra quando a issue entrou no status monitorado via changelog
    const enteredAt = findEntryTime(raw, statusIds) ?? now;

    // Reconstrói períodos de flag a partir do changelog desde que entrou na coluna
    // Isso garante que flags que ocorreram antes do primeiro sync sejam capturadas
    const flagPeriods = buildFlagPeriods(raw, enteredAt, isFlagged, now);

    const currentEntry: ColumnEntry = {
      enteredAt,
      flagPeriods,
    };

    return {
      issueKey: raw.key,
      summary: raw.fields.summary,
      assigneeName: raw.fields.assignee?.displayName ?? null,
      assigneeAvatar: raw.fields.assignee?.avatarUrls["48x48"] ?? null,
      estimateSeconds: raw.fields.timetracking?.originalEstimateSeconds ?? null,
      statusName: raw.fields.status.name,
      currentEntry,
      history: [],
      isFlagged,
      lastSyncedAt: now,
    };
  });
}

/**
 * Reconstrói os períodos de flag (Impediment) a partir do changelog,
 * considerando apenas eventos ocorridos APÓS a entrada na coluna monitorada.
 *
 * O changelog registra mudanças no campo "Flagged":
 *   - toString = "Impediment" → flag ativada
 *   - toString = null / "" → flag removida
 */
function buildFlagPeriods(
  raw: MonitorIssueRaw,
  enteredAt: string,
  currentlyFlagged: boolean,
  _now: string
): import("../types").FlagPeriod[] {
  if (!raw.changelog?.histories) {
    // Sem changelog: se já está flagada, cria um período aberto desde enteredAt
    return currentlyFlagged ? [{ start: enteredAt }] : [];
  }

  const enteredMs = new Date(enteredAt).getTime();

  // Filtra apenas eventos de "Flagged" depois da entrada na coluna, em ordem cronológica
  const flagEvents = raw.changelog.histories
    .filter((h) => new Date(h.created).getTime() >= enteredMs)
    .flatMap((h) =>
      h.items
        .filter((item) => item.field === "Flagged")
        .map((item) => ({
          ts: h.created,
          on: item.toString === "Impediment",
        }))
    )
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const periods: import("../types").FlagPeriod[] = [];
  let openStart: string | null = null;

  for (const event of flagEvents) {
    if (event.on && openStart === null) {
      openStart = event.ts;
    } else if (!event.on && openStart !== null) {
      periods.push({ start: openStart, end: event.ts });
      openStart = null;
    }
  }

  // Se ainda está flagada (sem evento de encerramento), mantém aberto até agora
  if (openStart !== null) {
    periods.push({ start: openStart });
  } else if (currentlyFlagged && flagEvents.length === 0) {
    // Flagada antes de entrar na coluna (sem evento dentro do período)
    periods.push({ start: enteredAt });
  }

  return periods;
}

/** Encontra o momento mais recente em que a issue entrou em um dos statusIds via changelog */
function findEntryTime(raw: MonitorIssueRaw, statusIds: string[]): string | null {
  if (!raw.changelog?.histories) return null;

  const sorted = [...raw.changelog.histories].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  for (const history of sorted) {
    for (const item of history.items) {
      if (item.field === "status" && item.to && statusIds.includes(item.to)) {
        return history.created;
      }
    }
  }
  return null;
}

// ─── Cálculos / Insights ─────────────────────────────────────────────────────

export interface TimeInStatus {
  status: string;
  durationMs: number;
  durationHuman: string;
}

export function calculateTimeInStatus(snapshots: IssueSnapshot[]): TimeInStatus[] {
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
  );

  const map = new Map<string, number>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const duration =
      new Date(next.captured_at).getTime() - new Date(current.captured_at).getTime();
    map.set(current.status, (map.get(current.status) ?? 0) + duration);
  }

  const last = sorted[sorted.length - 1];
  const sinceLastMs = Date.now() - new Date(last.captured_at).getTime();
  map.set(last.status, (map.get(last.status) ?? 0) + sinceLastMs);

  return Array.from(map.entries()).map(([status, durationMs]) => ({
    status,
    durationMs,
    durationHuman: formatDuration(durationMs),
  }));
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function calculateDaysOpen(createdAt: string): number {
  return Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ─── Tempo na coluna (board view) ─────────────────────────────────────────────

/**
 * Calcula quantos milissegundos de tempo útil existem entre dois timestamps,
 * respeitando horário de trabalho, almoço, fins de semana e feriados.
 *
 * Usa o fuso horário local do sistema (new Date + setHours).
 */
export function computeWorkingMs(
  startMs: number,
  endMs: number,
  schedule: WorkSchedule = DEFAULT_WORK_SCHEDULE
): number {
  if (startMs >= endMs) return 0;

  const {
    workStartHour, workStartMinute,
    workEndHour, workEndMinute,
    lunchStartHour, lunchStartMinute,
    lunchDurationMinutes,
    workDays,
    holidays,
  } = schedule;

  const holidaySet = new Set(holidays);
  let total = 0;

  // Começa do início do dia de startMs (hora local)
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);

  const endDay = new Date(endMs);
  endDay.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= endDay.getTime()) {
    // Verifica dia útil
    if (workDays.includes(cursor.getDay())) {
      // Formata como YYYY-MM-DD em hora local
      const y   = cursor.getFullYear();
      const m   = String(cursor.getMonth() + 1).padStart(2, "0");
      const d   = String(cursor.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;

      if (!holidaySet.has(dateStr)) {
        const dayTs = cursor.getTime();

        // Segmento manhã: [workStart, lunchStart]
        const ws = new Date(dayTs); ws.setHours(workStartHour, workStartMinute, 0, 0);
        const ls = new Date(dayTs); ls.setHours(lunchStartHour, lunchStartMinute, 0, 0);
        // Segmento tarde: [lunchEnd, workEnd]
        const le = new Date(ls.getTime() + lunchDurationMinutes * 60_000);
        const we = new Date(dayTs); we.setHours(workEndHour, workEndMinute, 0, 0);

        for (const [segStart, segEnd] of [
          [ws.getTime(), ls.getTime()],
          [le.getTime(), we.getTime()],
        ] as [number, number][]) {
          if (segEnd <= segStart) continue;
          const oStart = Math.max(segStart, startMs);
          const oEnd   = Math.min(segEnd, endMs);
          if (oEnd > oStart) total += oEnd - oStart;
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

/**
 * Calcula o tempo líquido útil que a issue ficou na coluna,
 * descontando períodos flagados, fins de semana, feriados e almoço.
 *
 * @param issue     Issue com changelog (expand=changelog)
 * @param statusIds Status IDs que compõem a coluna
 * @param schedule  Configuração do horário de trabalho (default: 9-18, seg-sex, 1h almoço)
 */
export function computeTimeInColumn(
  issue: JiraBoardIssue,
  statusIds: string[],
  schedule: WorkSchedule = DEFAULT_WORK_SCHEDULE
): { timeMs: number; isFlagged: boolean; enteredAt: string | null; flagPeriods: SimpleFlagPeriod[] } {
  const nowMs = Date.now();

  // ── Detecta flag atual ─────────────────────────────────────────────────────
  const flagField = issue.fields.customfield_10003;
  const isFlagged = Array.isArray(flagField)
    ? flagField.some((f: { value?: string }) => f?.value === "Impediment")
    : flagField === "Impediment";

  // ── Encontra quando entrou na coluna via changelog ─────────────────────────
  const enteredAt = findBoardIssueEntryTime(issue, statusIds);
  if (!enteredAt) {
    return { timeMs: 0, isFlagged, enteredAt: null, flagPeriods: [] };
  }

  const enteredMs = new Date(enteredAt).getTime();

  // ── Tempo útil total na coluna ─────────────────────────────────────────────
  const totalWorkingMs = computeWorkingMs(enteredMs, nowMs, schedule);

  // ── Desconta períodos de flag (também contados em tempo útil) ──────────────
  const flagPeriods = buildBoardFlagPeriods(issue, enteredAt, isFlagged, nowMs);
  const flaggedWorkingMs = flagPeriods.reduce((acc, p) => {
    const start = new Date(p.start).getTime();
    const end   = p.end ? new Date(p.end).getTime() : nowMs;
    return acc + computeWorkingMs(start, end, schedule);
  }, 0);

  return { timeMs: Math.max(0, totalWorkingMs - flaggedWorkingMs), isFlagged, enteredAt, flagPeriods };
}

// ─── Enrichment Cache: aplicação local ───────────────────────────────────────

/**
 * Aplica dados de um cache de enrichment a uma issue, calculando
 * timeInColumnMs localmente (sem chamada à API).
 */
function applyEnrichmentCacheToIssue(
  issue: JiraBoardIssue,
  cached: import("../types").CachedIssueEnrichment,
  schedule: WorkSchedule
): JiraBoardIssue {
  const nowMs = Date.now();
  const enteredMs = new Date(cached.enteredAt).getTime();

  // Prioridade: campo da API → cache gravado pelo enriquecimento (REST v3) → períodos abertos
  // A Agile API frequentemente não retorna customfield_10003, então confiamos no cache
  const flagField = issue.fields.customfield_10003;
  const flaggedByField = flagField != null
    ? (Array.isArray(flagField)
        ? flagField.some((f: { value?: string }) => f?.value === "Impediment")
        : flagField === "Impediment")
    : null; // null = API não retornou o campo
  const isFlagged = flaggedByField
    ?? cached.isFlagged         // gravado pelo enriquecimento (confiável)
    ?? cached.flagPeriods.some((p) => !p.end); // fallback: período aberto no cache

  const totalMs = computeWorkingMs(enteredMs, nowMs, schedule);

  const flaggedMs = cached.flagPeriods.reduce((acc, p) => {
    const start = new Date(p.start).getTime();
    const end   = p.end ? new Date(p.end).getTime() : nowMs;
    return acc + computeWorkingMs(start, end, schedule);
  }, 0);

  return {
    ...issue,
    timeInColumnMs: Math.max(0, totalMs - flaggedMs),
    isFlagged,
    enteredAt: cached.enteredAt,
    // Restaura os valores dos campos de regras de limite para que o motor
    // de alertas possa avaliar limites baseados em campo durante os syncs.
    ruleFieldValues: cached.ruleFieldValues,
  };
}

/**
 * Aplica o cache de enrichment a uma issue (chamado no syncNow após agrupar por coluna).
 * Se o cache for válido (mesmo statusId e flags consistentes), calcula timeInColumnMs
 * localmente — sem precisar de chamada à API.
 * Se o cache não existir ou for inválido, retorna a issue sem timeInColumnMs.
 */
export function applyEnrichmentCache(
  issue: JiraBoardIssue,
  schedule: WorkSchedule = DEFAULT_WORK_SCHEDULE
): JiraBoardIssue {
  // Determina isFlagged com fallback em camadas:
  // 1. customfield_10003 da Agile API (quando disponível)
  // 2. isFlagged gravado no cache pelo enriquecimento REST v3 (confiável)
  // 3. Períodos abertos no cache como último recurso
  const flagField = issue.fields.customfield_10003;
  const flaggedByField = flagField != null
    ? (Array.isArray(flagField)
        ? flagField.some((f: { value?: string }) => f?.value === "Impediment")
        : flagField === "Impediment")
    : null; // null = campo ausente na resposta da Agile API

  const cached = getIssueEnrichment(issue.key);

  const isFlagged = flaggedByField
    ?? cached?.isFlagged
    ?? (cached?.flagPeriods.some((p) => !p.end) ?? false);

  // Sem cache ou status mudou → retorna com isFlagged mas sem timeInColumnMs
  if (!cached || cached.statusId !== issue.fields.status.id) {
    return { ...issue, isFlagged };
  }

  // Cache existe mas flag está ativa sem período aberto → cache desatualizado para flags
  const hasOpenFlagPeriod = cached.flagPeriods.some((p) => !p.end);
  if ((flaggedByField === true) && !hasOpenFlagPeriod) {
    return { ...issue, isFlagged };
  }

  return applyEnrichmentCacheToIssue(issue, cached, schedule);
}

/** Encontra o momento mais recente em que a issue entrou em um dos statusIds */
function findBoardIssueEntryTime(issue: JiraBoardIssue, statusIds: string[]): string | null {
  if (!issue.changelog?.histories) return null;

  const sorted = [...issue.changelog.histories].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  for (const history of sorted) {
    for (const item of history.items) {
      if (item.field === "status" && item.to && statusIds.includes(item.to)) {
        return history.created;
      }
    }
  }
  return null;
}

interface SimpleFlagPeriod { start: string; end?: string }

/** Reconstrói períodos de flag desde enteredAt usando o changelog da issue */
function buildBoardFlagPeriods(
  issue: JiraBoardIssue,
  enteredAt: string,
  currentlyFlagged: boolean,
  nowMs: number
): SimpleFlagPeriod[] {
  if (!issue.changelog?.histories) {
    return currentlyFlagged ? [{ start: enteredAt }] : [];
  }

  const enteredMs = new Date(enteredAt).getTime();

  const flagEvents = issue.changelog.histories
    .filter((h) => new Date(h.created).getTime() >= enteredMs)
    .flatMap((h) =>
      h.items
        .filter((item) => item.field === "Flagged")
        .map((item) => ({ ts: h.created, on: item.toString === "Impediment" }))
    )
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const periods: SimpleFlagPeriod[] = [];
  let openStart: string | null = null;

  for (const event of flagEvents) {
    if (event.on && openStart === null) {
      openStart = event.ts;
    } else if (!event.on && openStart !== null) {
      periods.push({ start: openStart, end: event.ts });
      openStart = null;
    }
  }

  if (openStart !== null) {
    periods.push({ start: openStart });
  } else if (currentlyFlagged && flagEvents.length === 0) {
    // Flag anterior à entrada na coluna: conta desde a entrada
    periods.push({ start: enteredAt });
  }

  // Fecha períodos abertos com nowMs para o cálculo
  return periods.map((p) =>
    p.end ? p : { ...p, end: new Date(nowMs).toISOString() }
  );
}

/**
 * Formata milissegundos de tempo útil como "Xd Yh" / "Xh Ym" / "Xm".
 *
 * @param ms             Milissegundos de tempo útil
 * @param workDayMinutes Minutos de um dia útil (default: 480 = 8h)
 */
export function formatTimeInColumn(ms: number): string {
  if (ms <= 0) return "< 1m";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// ─── Issue Drafts — Criação no Jira ──────────────────────────────────────────

/**
 * Converte texto simples (possivelmente com quebras de linha) em
 * Atlassian Document Format (ADF) — formato obrigatório pela API v3.
 */
function textToAdf(text: string): object {
  const paragraphs = text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  return {
    version: 1,
    type: "doc",
    content: paragraphs.map((para) => ({
      type: "paragraph",
      content: [{ type: "text", text: para }],
    })),
  };
}

/**
 * Cria uma issue no Jira a partir de um rascunho local.
 *
 * @returns { key, id } da issue recém-criada (ex: { key: "AUT-42", id: "10042" })
 */
export async function createJiraIssue(
  draft: IssueDraft,
  projectKey: string,
  settings: AppSettings,
): Promise<{ key: string; id: string }> {
  const { jira_base_url: baseUrl, jira_email: email, jira_api_token: token } = settings;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = {
    project:   { key: draft.projectKey ?? projectKey },
    summary:   draft.title,
    issuetype: { name: draft.type },
    priority:  { name: draft.priority },
  };

  if (draft.description?.trim()) {
    fields.description = textToAdf(draft.description.trim());
  }

  if (draft.labels.length > 0) {
    fields.labels = draft.labels;
  }

  if (draft.parentKey?.trim()) {
    // Para Epics usa "parent"; para issues normais dentro de um Epic também
    fields.parent = { key: draft.parentKey.trim().toUpperCase() };
  }

  const result = await jiraPost<{ id: string; key: string }>(
    baseUrl, email, token,
    "/rest/api/3/issue",
    { fields },
  );

  return { key: result.key, id: result.id };
}

// ─── Relatório de Issues Concluídas ──────────────────────────────────────────

/** Um limite resolvido para exibição no relatório. */
export interface ReportIssueLimit {
  label: string;
  limitHours: number;
}

/** Issue concluída com tempo gasto na coluna e limites aplicáveis. */
export interface ReportIssue {
  key: string;
  summary: string;
  issuetype: { name: string; iconUrl?: string };
  assignee: { displayName: string; avatarUrls: Record<string, string> } | null;
  priority: { name: string } | null;
  /** Quando a issue saiu da coluna pela última vez (ISO). */
  completedAt: string;
  /** Tempo útil total na coluna (ms) — desconta almoço, fds, feriados e flags. */
  timeInColumnMs: number;
  /** Limites aplicáveis para o tipo desta issue. */
  limits: ReportIssueLimit[];
}

/**
 * Calcula o tempo total útil que uma issue ficou nos `columnStatusIds` especificados,
 * descontando períodos de flag ocorridos durante esse tempo.
 * Retorna também quando a issue saiu da coluna pela última vez.
 */
function computeHistoricalColumnTime(
  histories: Array<{ created: string; items: Array<{ field: string; from: string; to: string; toString?: string }> }>,
  columnStatusIds: Set<string>,
  workSchedule: WorkSchedule
): { timeMs: number; exitedAt: string | null } {
  // Ordena do mais antigo para o mais recente
  const sorted = [...histories].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  let totalMs    = 0;
  let enteredAt: number | null = null;
  let exitedAt: string | null  = null;

  // Rastreia flags DENTRO do período na coluna
  let flagStart: number | null = null;
  let flaggedMs = 0;

  for (const hist of sorted) {
    const ts = new Date(hist.created).getTime();
    for (const item of hist.items) {
      // ── Transições de status ──
      if (item.field === "status") {
        const fromIn = columnStatusIds.has(item.from);
        const toIn   = columnStatusIds.has(item.to);

        if (!fromIn && toIn) {
          // Entrou na coluna → abre período
          enteredAt = ts;
          flagStart = null;
          flaggedMs = 0;
        } else if (fromIn && !toIn && enteredAt !== null) {
          // Saiu da coluna → fecha período
          // Fecha flag pendente ao sair
          if (flagStart !== null) {
            flaggedMs += computeWorkingMs(flagStart, ts, workSchedule);
            flagStart = null;
          }
          const raw = computeWorkingMs(enteredAt, ts, workSchedule);
          totalMs  += Math.max(0, raw - flaggedMs);
          exitedAt  = hist.created;
          enteredAt = null;
          flaggedMs = 0;
        }
      }

      // ── Flags dentro do período na coluna ──
      if (item.field === "Flagged" && enteredAt !== null) {
        if (item.toString === "Impediment" && flagStart === null) {
          flagStart = ts;
        } else if (item.toString !== "Impediment" && flagStart !== null) {
          flaggedMs += computeWorkingMs(flagStart, ts, workSchedule);
          flagStart = null;
        }
      }
    }
  }

  // Issue ainda está na coluna (edge case para issues não finalizadas)
  if (enteredAt !== null) {
    const now = Date.now();
    if (flagStart !== null) flaggedMs += computeWorkingMs(flagStart, now, workSchedule);
    totalMs += Math.max(0, computeWorkingMs(enteredAt, now, workSchedule) - flaggedMs);
  }

  return { timeMs: totalMs, exitedAt };
}

/**
 * Resolve os limites aplicáveis a um issue para o relatório.
 * Espelha a lógica de `getApplicableLimits` do ColumnPanel.
 */
function resolveReportLimits(
  issueTypeName: string,
  ruleFieldValues: Record<string, number>,
  limitRules: LimitRule[] | undefined
): ReportIssueLimit[] {
  if (!limitRules || limitRules.length === 0) return [];

  const specific  = limitRules.filter(r => r.issueTypes.length > 0 && r.issueTypes.includes(issueTypeName));
  const catchAll  = limitRules.filter(r => r.issueTypes.length === 0);
  const candidates = specific.length > 0 ? specific : catchAll;

  const result: ReportIssueLimit[] = [];
  for (const rule of candidates) {
    const label = rule.description?.trim() || (rule.timeMode === "fixed" ? "fixo" : "campo");
    if (rule.timeMode === "fixed" && (rule.fixedHours ?? 0) > 0) {
      result.push({ label, limitHours: rule.fixedHours! });
    } else if (rule.timeMode === "field" && rule.fieldId) {
      const raw = ruleFieldValues[rule.fieldId];
      if (raw != null) {
        const hours = (rule.fieldUnit ?? "hours") === "minutes" ? raw / 60 : raw;
        result.push({ label, limitHours: hours });
      }
    }
  }
  return result;
}

/**
 * Busca issues que foram concluídas no período especificado e retorna
 * o tempo que cada uma passou na coluna alvo, comparado com os limites configurados.
 *
 * @param columnStatusIds  Status IDs da coluna cujo tempo será medido (ex: "In Progress")
 * @param limitRules       Regras de limite configuradas para a coluna
 * @param workSchedule     Horário de trabalho para cálculo de tempo útil
 */
export async function fetchReportIssues(
  startDate: Date,
  endDate: Date,
  columnStatusIds: string[],
  limitRules: LimitRule[] | undefined,
  workSchedule: WorkSchedule,
  settings: AppSettings,
  projectKey?: string
): Promise<ReportIssue[]> {
  const start    = formatJqlDate(startDate);
  const dayAfter = new Date(endDate);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const end = formatJqlDate(dayAfter);

  const projectFilter = projectKey ? ` AND project = "${projectKey}"` : "";

  // Coleta fieldIds de regras baseadas em campo para incluir na busca
  const ruleFieldIds = (limitRules ?? [])
    .filter(r => r.timeMode === "field" && r.fieldId)
    .map(r => r.fieldId as string);

  const extraFields = ruleFieldIds.length > 0 ? `,${ruleFieldIds.join(",")}` : "";

  // Busca issues em categoria "Done" atualizadas no período
  const jql = encodeURIComponent(
    `statusCategory = "Done"${projectFilter}` +
    ` AND updated >= "${start}" AND updated < "${end}"` +
    ` ORDER BY updated DESC`
  );

  const statusIdSet = new Set(columnStatusIds);
  const startMs     = startDate.getTime();
  const endMs       = new Date(endDate).setHours(23, 59, 59, 999);

  const result: ReportIssue[] = [];
  let startAt = 0;
  const pageSize = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await jiraFetch<{ issues: any[]; total: number }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      `/rest/api/3/search/jql?jql=${jql}&maxResults=${pageSize}&startAt=${startAt}` +
      `&fields=summary,status,issuetype,assignee,priority${extraFields}&expand=changelog`
    );

    for (const raw of data.issues ?? []) {
      const histories: any[] = raw.changelog?.histories ?? [];

      const { timeMs, exitedAt } = computeHistoricalColumnTime(
        histories, statusIdSet, workSchedule
      );

      // Só inclui se a issue saiu da coluna dentro do período
      if (!exitedAt) continue;
      const exitMs = new Date(exitedAt).getTime();
      if (exitMs < startMs || exitMs > endMs) continue;

      // Extrai valores de campos de regra
      const ruleFieldValues: Record<string, number> = {};
      for (const fieldId of ruleFieldIds) {
        const val = raw.fields?.[fieldId];
        if (val != null) {
          const v = typeof val === "object" && val !== null ? val.value ?? val : val;
          const parsed = parseFloat(String(v));
          if (!isNaN(parsed) && parsed >= 0) ruleFieldValues[fieldId] = parsed;
        }
      }

      const issueTypeName = raw.fields?.issuetype?.name ?? "";
      const limits = resolveReportLimits(issueTypeName, ruleFieldValues, limitRules);

      result.push({
        key:      raw.key,
        summary:  raw.fields.summary,
        issuetype: raw.fields.issuetype,
        assignee:  raw.fields.assignee
          ? { displayName: raw.fields.assignee.displayName, avatarUrls: raw.fields.assignee.avatarUrls }
          : null,
        priority:    raw.fields.priority ?? null,
        completedAt: exitedAt,
        timeInColumnMs: timeMs,
        limits,
      });
    }

    startAt += pageSize;
    if (startAt >= (data.total ?? 0)) break;
  }

  // Ordena pela data de saída mais recente primeiro
  result.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return result;
}

// ─── Consulta JQL personalizada ───────────────────────────────────────────────

export interface JqlIssue {
  key:       string;
  summary:   string;
  status:    { name: string; statusCategory: { colorName: string } };
  issuetype?: { name: string; iconUrl: string };
  assignee?:  { displayName: string; avatarUrls: { "32x32": string } } | null;
  priority?:  { name: string; iconUrl?: string } | null;
  updated:   string;
}

/**
 * Executa uma query JQL arbitrária e retorna as issues.
 * Limitado a `maxResults` issues (padrão 100) para evitar explosão de dados.
 */
export async function fetchJqlIssues(
  jql: string,
  settings: AppSettings,
  maxResults = 100
): Promise<{ issues: JqlIssue[]; total: number; truncated: boolean }> {
  const encoded  = encodeURIComponent(jql.trim());
  const result: JqlIssue[] = [];
  let startAt = 0;
  let total   = 0;
  const pageSize = 50;

  while (true) {
    const data = await jiraFetch<{ issues: any[]; total: number }>(
      settings.jira_base_url,
      settings.jira_email,
      settings.jira_api_token,
      `/rest/api/3/search/jql?jql=${encoded}&maxResults=${pageSize}&startAt=${startAt}` +
      `&fields=summary,status,issuetype,assignee,priority,updated`
    );
    total = data.total ?? 0;

    for (const raw of data.issues ?? []) {
      if (result.length >= maxResults) break;
      result.push({
        key:       raw.key,
        summary:   raw.fields.summary,
        status:    raw.fields.status,
        issuetype: raw.fields.issuetype ?? null,
        assignee:  raw.fields.assignee
          ? { displayName: raw.fields.assignee.displayName, avatarUrls: raw.fields.assignee.avatarUrls }
          : null,
        priority:  raw.fields.priority ?? null,
        updated:   raw.fields.updated,
      });
    }

    if (result.length >= maxResults) break;
    startAt += pageSize;
    if (startAt >= total) break;
  }

  return { issues: result, total, truncated: total > maxResults };
}
