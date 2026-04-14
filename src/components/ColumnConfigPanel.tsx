/**
 * ColumnConfigPanel — painel lateral de configuração de uma coluna.
 *
 * Aparece à ESQUERDA do ColumnPanel quando o usuário clica no ícone de
 * configuração. Oferece espaço generoso para o editor de regras de limite.
 */
import { useState } from "react";
import { X, Plus, Trash2, Check, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import type { ColumnConfig, LimitRule, CachedIssueType, CachedCustomField } from "../types";

function newRuleId(): string {
  return crypto.randomUUID();
}

interface Props {
  columnName: string;
  config: ColumnConfig;
  issueTypes: CachedIssueType[];
  customFields: CachedCustomField[];
  onSave: (cfg: ColumnConfig) => void;
  onClose: () => void;
}

// Estilo base para inputs/selects — usa CSS variables para seguir o tema
const inputStyle: React.CSSProperties = {
  background:   "var(--panel-bg)",
  borderColor:  "var(--ctrl-inactive-border)",
  color:        "var(--text-primary)",
};

const inputCls =
  "w-full px-2.5 py-1.5 text-xs border rounded-lg outline-none " +
  "focus:border-blue-300 focus:ring-1 focus:ring-blue-100 transition-colors";

export function ColumnConfigPanel({
  columnName,
  config,
  issueTypes,
  customFields,
  onSave,
  onClose,
}: Props) {
  const [maxAgeDays, setMaxAgeDays] = useState(config.maxAgeDays?.toString() ?? "");
  const [rules, setRules]           = useState<LimitRule[]>(config.limitRules ?? []);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  // Ordena tipos: subtasks por último
  const sortedTypes = [...issueTypes].sort((a, b) => {
    if (a.subtask !== b.subtask) return a.subtask ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  function addRule() {
    const rule: LimitRule = {
      id: newRuleId(),
      description: "",
      issueTypes: [],
      timeMode: "fixed",
    };
    setRules((r) => [...r, rule]);
  }

  function removeRule(id: string) {
    setRules((r) => r.filter((rule) => rule.id !== id));
    setExpandedType((v) => (v === id ? null : v));
  }

  function updateRule(id: string, patch: Partial<LimitRule>) {
    setRules((r) => r.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function toggleIssueType(ruleId: string, typeName: string) {
    setRules((r) =>
      r.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const already = rule.issueTypes.includes(typeName);
        return {
          ...rule,
          issueTypes: already
            ? rule.issueTypes.filter((t) => t !== typeName)
            : [...rule.issueTypes, typeName],
        };
      })
    );
  }

  function handleSave() {
    const parsedAge = parseInt(maxAgeDays, 10);
    const validRules = rules.filter((r) =>
      r.timeMode === "fixed"
        ? (r.fixedHours ?? 0) > 0
        : !!(r.fieldId?.trim())
    );
    onSave({
      limitRules: validRules.length > 0 ? validRules : undefined,
      maxAgeDays: !isNaN(parsedAge) && parsedAge > 0 ? parsedAge : undefined,
    });
  }

  return (
    <div
      className="flex flex-col h-full panel-content shadow-sm"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0 drag-region"
           style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2 no-drag">
          <div className="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center">
            <Settings2 size={11} className="text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold truncate leading-tight"
               style={{ color: "var(--text-primary)" }}>
              Configurar coluna
            </p>
            <p className="text-[10px] truncate leading-tight"
               style={{ color: "var(--text-secondary)" }}>{columnName}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="no-drag p-1 hover:text-gray-500 transition-colors rounded-md hover:bg-gray-100"
          style={{ color: "var(--text-muted)" }}
          title="Fechar"
        >
          <X size={13} />
        </button>
      </div>

      {/* Body — scrollável */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

        {/* ── Regras de limite ──────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold"
                style={{ color: "var(--text-primary)" }}>Regras de limite</h3>
            <button
              onClick={addRule}
              className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors"
            >
              <Plus size={11} />
              Adicionar
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-center rounded-xl border border-dashed"
                 style={{ borderColor: "var(--ctrl-inactive-border)", background: "var(--bg-secondary)" }}>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Nenhuma regra configurada</p>
              <button
                onClick={addRule}
                className="mt-1.5 text-[10px] text-blue-500 hover:text-blue-700 font-medium"
              >
                + Criar primeira regra
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  sortedTypes={sortedTypes}
                  customFields={customFields}
                  typeDropdownOpen={expandedType === rule.id}
                  onToggleTypeDropdown={() =>
                    setExpandedType((v) => (v === rule.id ? null : rule.id))
                  }
                  onUpdate={(patch) => updateRule(rule.id, patch)}
                  onToggleIssueType={(name) => toggleIssueType(rule.id, name)}
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Filtro por idade ──────────────────────────────────────────── */}
        <section>
          <h3 className="text-[11px] font-semibold mb-2"
              style={{ color: "var(--text-primary)" }}>Filtro de antiguidade</h3>
          <div>
            <label className="block text-[10px] mb-1"
                   style={{ color: "var(--text-secondary)" }}>
              Exibir apenas issues dos últimos N dias
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="ex: 7  (vazio = mostrar tudo)"
              value={maxAgeDays}
              onChange={(e) => setMaxAgeDays(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Baseado na data de entrada na coluna. Útil em colunas Done.
            </p>
          </div>
        </section>
      </div>

      {/* Footer — ações fixas */}
      <div className="shrink-0 px-3 py-2.5 border-t flex items-center gap-2"
           style={{ borderColor: "var(--border-subtle)" }}>
        <button
          onClick={handleSave}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          <Check size={12} />
          Salvar
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 text-xs font-medium rounded-lg transition-colors hover:opacity-80"
          style={{ background: "var(--ctrl-inactive-bg)", color: "var(--text-secondary)" }}
        >
          Cancelar
        </button>
        {(config.limitRules?.length || config.maxAgeDays) && (
          <button
            onClick={() => onSave({})}
            className="text-[10px] text-red-400 hover:text-red-600 transition-colors ml-auto"
            title="Limpar todas as configurações desta coluna"
          >
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Card de regra individual ─────────────────────────────────────────────────

function RuleCard({
  rule,
  sortedTypes,
  customFields,
  typeDropdownOpen,
  onToggleTypeDropdown,
  onUpdate,
  onToggleIssueType,
  onRemove,
}: {
  rule: LimitRule;
  sortedTypes: CachedIssueType[];
  customFields: CachedCustomField[];
  typeDropdownOpen: boolean;
  onToggleTypeDropdown: () => void;
  onUpdate: (patch: Partial<LimitRule>) => void;
  onToggleIssueType: (name: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border p-3 space-y-2.5"
         style={{ borderColor: "var(--ctrl-inactive-border)", background: "var(--bg-secondary)" }}>
      {/* Linha: descrição + botão remover */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Descrição (ex: Bug > 8h)"
          value={rule.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className={`flex-1 ${inputCls}`}
          style={inputStyle}
        />
        <button
          onClick={onRemove}
          className="p-1.5 hover:text-red-400 transition-colors rounded-md hover:bg-red-50"
          style={{ color: "var(--text-muted)" }}
          title="Remover regra"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Tipos de issue — multi-select dropdown */}
      <div>
        <label className="block text-[10px] font-medium mb-1"
               style={{ color: "var(--text-secondary)" }}>
          Tipos de issue
        </label>
        <button
          onClick={onToggleTypeDropdown}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs border rounded-lg transition-colors text-left hover:opacity-90"
          style={{
            borderColor: "var(--ctrl-inactive-border)",
            background:  "var(--panel-bg)",
            color:       rule.issueTypes.length === 0 ? "var(--text-secondary)" : "var(--text-primary)",
          }}
        >
          <span>
            {rule.issueTypes.length === 0
              ? "Todos os tipos (catch-all)"
              : rule.issueTypes.join(", ")}
          </span>
          {typeDropdownOpen
            ? <ChevronUp size={11} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
            : <ChevronDown size={11} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
        </button>

        {typeDropdownOpen && (
          <div className="mt-1 rounded-lg border max-h-40 overflow-y-auto divide-y shadow-sm"
               style={{
                 borderColor: "var(--ctrl-inactive-border)",
                 background:  "var(--panel-bg)",
               }}>
            {sortedTypes.length === 0 ? (
              <p className="px-3 py-2 text-[10px] italic" style={{ color: "var(--text-secondary)" }}>
                Carregando tipos do Jira…
              </p>
            ) : (
              sortedTypes.map((t) => {
                const selected = rule.issueTypes.includes(t.name);
                return (
                  <button
                    key={t.id}
                    onClick={() => onToggleIssueType(t.name)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                    style={{
                      background: selected ? "rgba(239,246,255,0.7)" : undefined,
                      color:      selected ? "#2563eb" : "var(--text-primary)",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) (e.currentTarget as HTMLElement).style.background = "";
                    }}
                  >
                    {/* Checkbox visual */}
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors
                      ${selected ? "bg-blue-500 border-blue-500" : ""}`}
                      style={!selected ? { borderColor: "var(--ctrl-inactive-border)" } : undefined}>
                      {selected && <Check size={9} className="text-white" />}
                    </span>
                    {t.iconUrl && (
                      <img src={t.iconUrl} alt={t.name} className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span style={t.subtask ? { color: "var(--text-secondary)" } : undefined}>{t.name}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
        <p className="text-[9px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
          Vazio = aplica a todos os tipos (fallback)
        </p>
      </div>

      {/* Modo de tempo */}
      <div>
        <label className="block text-[10px] font-medium mb-1.5"
               style={{ color: "var(--text-secondary)" }}>
          Limite de tempo
        </label>

        {/* Toggle fixed / field */}
        <div className="flex items-center gap-1 mb-2 rounded-lg p-0.5 w-fit"
             style={{ background: "var(--ctrl-inactive-bg)" }}>
          {(["fixed", "field"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onUpdate({ timeMode: mode })}
              className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
              style={rule.timeMode === mode
                ? { background: "var(--panel-bg)", color: "#2563eb", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }
                : { color: "var(--text-secondary)" }}
            >
              {mode === "fixed" ? "Horas fixas" : "Campo do Jira"}
            </button>
          ))}
        </div>

        {rule.timeMode === "fixed" ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.25"
              step="0.25"
              placeholder="ex: 8"
              value={rule.fixedHours?.toString() ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdate({ fixedHours: isNaN(v) ? undefined : v });
              }}
              className="w-28 px-2.5 py-1.5 text-xs border rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              style={inputStyle}
            />
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>horas</span>
          </div>
        ) : (
          <div className="space-y-2">
            <select
              value={rule.fieldId ?? ""}
              onChange={(e) => onUpdate({ fieldId: e.target.value || undefined })}
              className="w-full px-2.5 py-1.5 text-xs border rounded-lg outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              style={inputStyle}
            >
              <option value="">Selecione um campo…</option>
              {customFields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>

            {/* Unidade do campo */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-medium" style={{ color: "var(--text-secondary)" }}>Unidade do campo:</span>
              <div className="flex items-center gap-1 rounded-md p-0.5"
                   style={{ background: "var(--ctrl-inactive-bg)" }}>
                {(["hours", "minutes"] as const).map((unit) => (
                  <button
                    key={unit}
                    onClick={() => onUpdate({ fieldUnit: unit })}
                    className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors"
                    style={(rule.fieldUnit ?? "hours") === unit
                      ? { background: "var(--panel-bg)", color: "#2563eb", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }
                      : { color: "var(--text-secondary)" }}
                  >
                    {unit === "hours" ? "Horas" : "Minutos"}
                  </button>
                ))}
              </div>
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                {(rule.fieldUnit ?? "hours") === "minutes"
                  ? "60 min = 1 h · ex: 90 = 1,5 h"
                  : "valor em horas · ex: 0.75 = 45 min"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
