/**
 * alertEngine — detecta e gerencia alertas do board após cada sync.
 *
 * Tipos de alerta:
 *   time_warning  → issue ≥75% do limite de tempo (persiste até silenciar)
 *   time_breach   → issue ≥100% do limite (persiste até silenciar)
 *   column_change → issue mudou de coluna (dispara uma vez)
 *   flagged       → issue foi flegada (dispara uma vez)
 *
 * Alertas de tempo são re-disparados a cada sync até o usuário silenciar.
 * Alertas one-shot (coluna/flag) são gerados apenas quando são novos.
 * O silêncio é automaticamente limpo se o alerta não for mais aplicável
 * (ex: issue saiu da coluna, flag removida, tempo resetou).
 */
import type {
  AppAlert,
  AlertKind,
  BoardColumnWithIssues,
  ColumnConfig,
  BoardStatusMap,
  LimitRule,
  JiraBoardIssue,
} from "../types";
import {
  getAlerts,
  saveAlerts,
  getSilencedAlerts,
  unsilenceAlert,
} from "./db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAlertId(kind: AlertKind, issueKey: string): string {
  return `${kind}:${issueKey}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Formata percentual de forma legível */
function fmtPct(pct: number): string {
  return Math.round(pct) + "%";
}

// ─── Helpers para regras de limite ────────────────────────────────────────────

/**
 * Retorna todas as horas-limite resolvidas para um issue (uma por regra aplicável).
 * Espelha a lógica de `getApplicableLimits` no ColumnPanel para consistência.
 */
function getApplicableLimitHours(
  issue: JiraBoardIssue,
  rules: LimitRule[] | undefined
): number[] {
  if (!rules || rules.length === 0) return [];
  const issueTypeName = issue.fields.issuetype?.name ?? "";

  const specificRules = rules.filter(
    (r) => r.issueTypes.length > 0 && r.issueTypes.includes(issueTypeName)
  );
  const catchAllRules = rules.filter((r) => r.issueTypes.length === 0);
  const candidates = specificRules.length > 0 ? specificRules : catchAllRules;

  const result: number[] = [];
  for (const rule of candidates) {
    if (rule.timeMode === "fixed" && (rule.fixedHours ?? 0) > 0) {
      result.push(rule.fixedHours!);
    } else if (rule.timeMode === "field" && rule.fieldId) {
      const raw = issue.ruleFieldValues?.[rule.fieldId];
      if (raw != null) {
        result.push((rule.fieldUnit ?? "hours") === "minutes" ? raw / 60 : raw);
      }
    }
  }
  return result;
}

// ─── Detecção de alertas de tempo ─────────────────────────────────────────────

interface TimeAlert {
  kind: "time_warning" | "time_breach";
  issueKey: string;
  summary: string;
  pct: number;
  columnName: string;
}

/**
 * Varre todas as colunas que têm limite de tempo configurado e
 * retorna alertas para issues que atingiram ≥75% ou ≥100%.
 * Suporta tanto regras flexíveis (limitRules) quanto o campo legado (limitHours).
 */
function detectTimeAlerts(
  columns: BoardColumnWithIssues[],
  columnConfigs: Record<string, ColumnConfig>
): TimeAlert[] {
  const alerts: TimeAlert[] = [];

  for (const col of columns) {
    const cfg = columnConfigs[col.name];
    // Coluna sem nenhuma configuração de limite
    if (!cfg) continue;
    const hasRules   = (cfg.limitRules?.length ?? 0) > 0;
    const hasLegacy  = (cfg.limitHours ?? 0) > 0;
    if (!hasRules && !hasLegacy) continue;

    for (const issue of col.issues) {
      const timeMs = issue.timeInColumnMs ?? 0;
      if (timeMs <= 0) continue;

      // Coleta todos os limites resolvidos para esta issue (uma entrada por regra)
      const limitHoursList: number[] = hasRules
        ? getApplicableLimitHours(issue, cfg.limitRules)
        : [];
      // Fallback para o campo legado quando não há regras ou nenhuma se aplica
      if (limitHoursList.length === 0 && hasLegacy && (cfg.limitHours ?? 0) > 0) {
        limitHoursList.push(cfg.limitHours!);
      }
      if (limitHoursList.length === 0) continue;

      // Dispara alerta se qualquer limite for atingido (mais restritivo = maior % percorrida)
      const maxPct = Math.max(
        ...limitHoursList.map((h) => (timeMs / (h * 3_600_000)) * 100)
      );

      if (maxPct >= 100) {
        alerts.push({
          kind: "time_breach",
          issueKey: issue.key,
          summary: issue.fields.summary,
          pct: maxPct,
          columnName: col.name,
        });
      } else if (maxPct >= 75) {
        alerts.push({
          kind: "time_warning",
          issueKey: issue.key,
          summary: issue.fields.summary,
          pct: maxPct,
          columnName: col.name,
        });
      }
    }
  }

  return alerts;
}

// ─── Detecção de alertas de flag ──────────────────────────────────────────────

interface FlagAlert {
  issueKey: string;
  summary: string;
  assigneeName: string | null;
  columnName: string;
}

/**
 * Compara o status atual das issues com o mapa anterior para detectar
 * issues que foram flegadas entre um sync e outro.
 */
function detectFlagAlerts(
  columns: BoardColumnWithIssues[],
  prevStatusMap: BoardStatusMap
): FlagAlert[] {
  const alerts: FlagAlert[] = [];

  for (const col of columns) {
    for (const issue of col.issues) {
      if (!issue.isFlagged) continue;
      const prev = prevStatusMap[issue.key];
      // Só alerta se antes não estava flegada (ou não havia registro)
      if (prev && (prev as BoardStatusMap[string] & { isFlagged?: boolean }).isFlagged) continue;
      alerts.push({
        issueKey: issue.key,
        summary: issue.fields.summary,
        assigneeName: issue.fields.assignee?.displayName ?? null,
        columnName: col.name,
      });
    }
  }

  return alerts;
}

// ─── Detecção de mudanças de coluna ───────────────────────────────────────────

interface ColumnChangeAlert {
  issueKey: string;
  summary: string;
  fromColumn: string;
  toColumn: string;
  assigneeName: string | null;
}

function detectColumnChangeAlerts(
  columns: BoardColumnWithIssues[],
  prevStatusMap: BoardStatusMap
): ColumnChangeAlert[] {
  const alerts: ColumnChangeAlert[] = [];

  for (const col of columns) {
    for (const issue of col.issues) {
      const prev = prevStatusMap[issue.key];
      if (!prev) continue; // issue nova, sem histórico
      if (prev.columnName === col.name) continue; // mesma coluna
      alerts.push({
        issueKey: issue.key,
        summary: issue.fields.summary,
        fromColumn: prev.columnName,
        toColumn: col.name,
        assigneeName: issue.fields.assignee?.displayName ?? null,
      });
    }
  }

  return alerts;
}

// ─── Engine principal ─────────────────────────────────────────────────────────

export interface AlertEngineResult {
  /** Todos os alertas ativos (não silenciados) após este sync */
  activeAlerts: AppAlert[];
  /** Alertas novos que devem gerar notificação OS neste ciclo */
  toNotify: AppAlert[];
}

/**
 * Executa o motor de alertas após um sync completo.
 *
 * @param columns        Colunas com issues já processadas
 * @param columnConfigs  Configs de limite por coluna
 * @param prevStatusMap  Mapa de status do sync anterior (para detectar mudanças)
 * @param boardName      Nome do board (para exibição nas notificações)
 * @param isFirstSync    Se true, não gera alertas one-shot (sem comparação válida)
 */
export function runAlertEngine(
  columns: BoardColumnWithIssues[],
  columnConfigs: Record<string, ColumnConfig>,
  prevStatusMap: BoardStatusMap,
  boardName: string,
  isFirstSync: boolean
): AlertEngineResult {
  const silenced  = getSilencedAlerts();
  const existing  = getAlerts();
  const now       = nowIso();

  // ── 1. Constrói mapa de alertas existentes por ID ──────────────────────────
  const existingById = new Map(existing.map((a) => [a.id, a]));

  // ── 2. Detecta todas as condições de alerta ────────────────────────────────
  const timeAlerts   = detectTimeAlerts(columns, columnConfigs);
  const flagAlerts   = isFirstSync ? [] : detectFlagAlerts(columns, prevStatusMap);
  const columnAlerts = isFirstSync ? [] : detectColumnChangeAlerts(columns, prevStatusMap);

  // ── 3. Conjunto de issue-keys ainda relevantes por tipo ────────────────────
  // Usamos para limpar silêncios de alertas que não existem mais
  const activeTimeIds = new Set(timeAlerts.map((a) => makeAlertId(a.kind, a.issueKey)));

  // Limpa silêncios de alertas de tempo que não são mais aplicáveis
  // (ex: issue saiu da coluna ou o tempo resetou)
  for (const id of silenced) {
    if ((id.startsWith("time_warning:") || id.startsWith("time_breach:")) &&
        !activeTimeIds.has(id)) {
      unsilenceAlert(id);
    }
  }

  // Re-lê silenciados após a limpeza automática
  const silencedFresh = getSilencedAlerts();

  // ── 4. Monta lista de alertas resultante ──────────────────────────────────
  const nextAlerts: AppAlert[] = [];
  const toNotify: AppAlert[]   = [];

  // ── 4a. Alertas de tempo (persistentes — re-disparam todo sync) ────────────
  for (const ta of timeAlerts) {
    const id = makeAlertId(ta.kind, ta.issueKey);
    const existing = existingById.get(id);

    const alert: AppAlert = {
      id,
      kind: ta.kind,
      issueKey: ta.issueKey,
      summary: ta.summary,
      boardName,
      columnName: ta.columnName,
      message:
        ta.kind === "time_breach"
          ? `${ta.issueKey} ultrapassou o limite de tempo! (${fmtPct(ta.pct)} — coluna "${ta.columnName}")`
          : `${ta.issueKey} está em ${fmtPct(ta.pct)} do limite de tempo (coluna "${ta.columnName}")`,
      pct: ta.pct,
      createdAt: existing?.createdAt ?? now,
    };

    nextAlerts.push(alert);

    // Notifica OS se não silenciado: sempre (alertas de tempo são persistentes)
    if (!silencedFresh.has(id)) {
      toNotify.push(alert);
    }
  }

  // ── 4b. Alertas one-shot: flag ─────────────────────────────────────────────
  for (const fa of flagAlerts) {
    const id = makeAlertId("flagged", fa.issueKey);
    // Se já existe (foi gerado antes), mantém sem re-notificar
    const prev = existingById.get(id);

    const alert: AppAlert = {
      id,
      kind: "flagged",
      issueKey: fa.issueKey,
      summary: fa.summary,
      boardName,
      columnName: fa.columnName,
      message: fa.assigneeName
        ? `${fa.assigneeName} flegou ${fa.issueKey} (coluna "${fa.columnName}")`
        : `${fa.issueKey} foi flegado como impedimento (coluna "${fa.columnName}")`,
      createdAt: prev?.createdAt ?? now,
    };

    nextAlerts.push(alert);

    // Notifica apenas se é novo (não havia no sync anterior)
    if (!prev && !silencedFresh.has(id)) {
      toNotify.push(alert);
    }
  }

  // ── 4c. Alertas one-shot: mudança de coluna ────────────────────────────────
  for (const ca of columnAlerts) {
    const id = makeAlertId("column_change", ca.issueKey);
    const prev = existingById.get(id);

    const alert: AppAlert = {
      id,
      kind: "column_change",
      issueKey: ca.issueKey,
      summary: ca.summary,
      boardName,
      columnName: ca.toColumn,
      message: `${ca.issueKey} movido de "${ca.fromColumn}" → "${ca.toColumn}"`,
      createdAt: now, // sempre atualiza — cada mudança de coluna é nova
    };

    nextAlerts.push(alert);

    // Notifica se é novo ou se a coluna mudou novamente
    if ((!prev || prev.message !== alert.message) && !silencedFresh.has(id)) {
      toNotify.push(alert);
    }
  }

  // ── 4d. Mantém alertas one-shot existentes que não foram re-detectados ──────
  // (ex: flag ou coluna que não aparece mais no sync atual mas usuário não silenciou)
  // Isso garante que o badge não desapareça entre syncs
  for (const [id, alert] of existingById) {
    const alreadyInNext = nextAlerts.some((a) => a.id === id);
    if (alreadyInNext) continue;
    if (alert.kind === "time_warning" || alert.kind === "time_breach") continue; // tempo: só se detectado
    // Mantém one-shot por até 24h
    const ageMs = Date.now() - new Date(alert.createdAt).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      nextAlerts.push(alert);
    }
  }

  // ── 5. Persiste e retorna ──────────────────────────────────────────────────
  saveAlerts(nextAlerts);

  const activeAlerts = nextAlerts.filter((a) => !silencedFresh.has(a.id));

  return { activeAlerts, toNotify };
}
