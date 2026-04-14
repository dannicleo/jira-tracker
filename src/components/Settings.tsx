import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, CheckCircle, XCircle, Loader2, Plus, X, Sun, Moon, Monitor } from "lucide-react";
import type { AppSettings, WorkSchedule } from "../types";
import { validateCredentials } from "../services/jira";
import { applyDark } from "../hooks/useTheme";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onBack: () => void;
  workSchedule: WorkSchedule;
  onSaveSchedule: (schedule: WorkSchedule) => Promise<void>;
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

export function Settings({ settings, onSave, onBack, workSchedule, onSaveSchedule }: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [schedule, setSchedule] = useState<WorkSchedule>({ ...workSchedule });
  const [newHoliday, setNewHoliday] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  function handleChange(key: keyof AppSettings, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Em dev: sincroniza credenciais com o proxy antes de testar
      if (import.meta.env.DEV) {
        try {
          await fetch("/dev/set-credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl: form.jira_base_url,
              email: form.jira_email,
              token: form.jira_api_token,
            }),
          });
        } catch {
          // ignora falha no sync do proxy
        }
      }

      const result = await validateCredentials(form);
      setTestResult({
        success: result.success,
        message: result.success
          ? `Conectado como ${result.user?.displayName}`
          : result.error ?? "Falha na validação",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(form);
      await onSaveSchedule(schedule);

      // Em dev: informa o proxy Vite das novas credenciais para que ele
      // injete o Authorization header sem precisar de restart ou .env
      if (import.meta.env.DEV) {
        try {
          await fetch("/dev/set-credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl: form.jira_base_url,
              email: form.jira_email,
              token: form.jira_api_token,
            }),
          });
        } catch {
          // Não bloqueia o save se o endpoint falhar
        }
      }

      onBack();
    } finally {
      setSaving(false);
    }
  }

  function toggleWorkDay(day: number) {
    setSchedule((prev) => ({
      ...prev,
      workDays: prev.workDays.includes(day)
        ? prev.workDays.filter((d) => d !== day)
        : [...prev.workDays, day].sort(),
    }));
  }

  function addHoliday() {
    const trimmed = newHoliday.trim();
    // Valida formato YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return;
    if (schedule.holidays.includes(trimmed)) return;
    setSchedule((prev) => ({
      ...prev,
      holidays: [...prev.holidays, trimmed].sort(),
    }));
    setNewHoliday("");
  }

  function removeHoliday(date: string) {
    setSchedule((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((h) => h !== date),
    }));
  }

  // Minutos úteis por dia (para exibição)
  const workMinutes =
    (schedule.workEndHour * 60 + schedule.workEndMinute) -
    (schedule.workStartHour * 60 + schedule.workStartMinute) -
    schedule.lunchDurationMinutes;
  const workHours = (workMinutes / 60).toFixed(1).replace(".0", "");

  const isComplete =
    form.jira_base_url.trim() !== "" &&
    form.jira_email.trim() !== "" &&
    form.jira_api_token.trim() !== "";

  return (
    <div className="flex flex-col h-full fade-in panel-content">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-gray-700/60 drag-region">
        <button
          onClick={onBack}
          className="p-1 text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Configurações</span>
      </div>

      {/* Formulário */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Seção Jira */}
        <section>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Credenciais Jira
          </p>

          <div className="space-y-3">
            <Field label="Base URL" hint="Ex: https://empresa.atlassian.net">
              <input
                type="url"
                value={form.jira_base_url}
                onChange={(e) => handleChange("jira_base_url", e.target.value)}
                placeholder="https://empresa.atlassian.net"
                className="input-field"
              />
            </Field>

            <Field label="Email" hint="Email da sua conta Atlassian">
              <input
                type="email"
                value={form.jira_email}
                onChange={(e) => handleChange("jira_email", e.target.value)}
                placeholder="voce@empresa.com"
                className="input-field"
              />
            </Field>

            <Field
              label="API Token"
              hint={
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  className="text-blue-500 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Gerar token →
                </a>
              }
            >
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={form.jira_api_token}
                  onChange={(e) => handleChange("jira_api_token", e.target.value)}
                  placeholder="••••••••••••••••"
                  className="input-field pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
          </div>

          {/* Botão de teste */}
          <button
            onClick={handleTest}
            disabled={!isComplete || testing}
            className="mt-3 w-full py-2 text-xs font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
          >
            {testing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              "Testar conexão"
            )}
          </button>

          {testResult && (
            <div
              className={`mt-2 p-2 rounded-lg flex items-start gap-2 text-xs ${
                testResult.success
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              }`}
            >
              {testResult.success ? (
                <CheckCircle size={14} className="shrink-0 mt-0.5" />
              ) : (
                <XCircle size={14} className="shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </section>

        {/* Seção Aparência */}
        <section>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Aparência
          </p>
          <div className="flex gap-2">
            {([
              { value: "light",  label: "Claro",   icon: Sun },
              { value: "dark",   label: "Escuro",  icon: Moon },
              { value: "system", label: "Sistema", icon: Monitor },
            ] as const).map(({ value, label, icon: Icon }) => {
              const active = form.theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    handleChange("theme", value);
                    // Aplica imediatamente sem esperar o Save
                    const root = document.documentElement;
                    if (value === "dark") {
                      applyDark(root, true);
                    } else if (value === "light") {
                      applyDark(root, false);
                    } else {
                      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                      applyDark(root, prefersDark);
                    }
                  }}
                  className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-colors no-drag"
                  style={{
                    background:   active ? "var(--ctrl-selected-bg)"     : "var(--ctrl-inactive-bg)",
                    borderColor:  active ? "var(--ctrl-selected-border)"  : "var(--ctrl-inactive-border)",
                    color:        active ? "var(--ctrl-selected-text)"    : "var(--ctrl-inactive-text)",
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Seção Sincronização + Comportamento */}
        <section>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Sincronização
          </p>
          <Field label="Intervalo de sync (minutos)" hint="0 para desativar o auto-sync">
            <input
              type="number"
              min="0"
              max="60"
              value={form.sync_interval_minutes}
              onChange={(e) =>
                handleChange("sync_interval_minutes", Number(e.target.value))
              }
              className="input-field"
            />
          </Field>
          <Field
            label="Recolher após inatividade"
            hint="0 para desativar · mouse fora da janela"
          >
            <div className="relative">
              <input
                type="number"
                min="0"
                max="60"
                value={form.inactivity_timeout_minutes}
                onChange={(e) =>
                  handleChange("inactivity_timeout_minutes", Number(e.target.value))
                }
                className="input-field pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 pointer-events-none">
                min
              </span>
            </div>
          </Field>
        </section>

        {/* Seção Horário de Trabalho */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Horário de Trabalho
            </p>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
              {workHours}h/dia útil
            </span>
          </div>

          <div className="space-y-3">
            {/* Expediente */}
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1.5">Expediente</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={`${String(schedule.workStartHour).padStart(2, "0")}:${String(schedule.workStartMinute).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setSchedule((p) => ({ ...p, workStartHour: h, workStartMinute: m }));
                  }}
                  className="input-field flex-1"
                />
                <span className="text-xs text-gray-400 dark:text-gray-500">até</span>
                <input
                  type="time"
                  value={`${String(schedule.workEndHour).padStart(2, "0")}:${String(schedule.workEndMinute).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setSchedule((p) => ({ ...p, workEndHour: h, workEndMinute: m }));
                  }}
                  className="input-field flex-1"
                />
              </div>
            </div>

            {/* Almoço */}
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1.5">Almoço</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={`${String(schedule.lunchStartHour).padStart(2, "0")}:${String(schedule.lunchStartMinute).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setSchedule((p) => ({ ...p, lunchStartHour: h, lunchStartMinute: m }));
                  }}
                  className="input-field flex-1"
                />
                <span className="text-xs text-gray-400 dark:text-gray-500">por</span>
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    max="180"
                    step="15"
                    value={schedule.lunchDurationMinutes}
                    onChange={(e) =>
                      setSchedule((p) => ({ ...p, lunchDurationMinutes: Number(e.target.value) }))
                    }
                    className="input-field pr-6"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">min</span>
                </div>
              </div>
            </div>

            {/* Dias úteis */}
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1.5">Dias úteis</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleWorkDay(idx)}
                    className="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors no-drag"
                    style={schedule.workDays.includes(idx)
                      ? { background: "#2563eb", color: "#ffffff" }
                      : { background: "var(--ctrl-inactive-bg)", color: "var(--ctrl-inactive-text)" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Feriados */}
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1.5">
                Feriados
                {schedule.holidays.length > 0 && (
                  <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">({schedule.holidays.length})</span>
                )}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={newHoliday}
                  onChange={(e) => setNewHoliday(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHoliday()}
                  className="input-field flex-1"
                  placeholder="YYYY-MM-DD"
                />
                <button
                  type="button"
                  onClick={addHoliday}
                  disabled={!newHoliday}
                  className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-40 transition-colors no-drag"
                >
                  <Plus size={13} />
                </button>
              </div>

              {schedule.holidays.length > 0 && (
                <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
                  {schedule.holidays.map((date) => (
                    <div
                      key={date}
                      className="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-md"
                    >
                      <span className="text-xs text-gray-600 dark:text-gray-300">{date}</span>
                      <button
                        type="button"
                        onClick={() => removeHoliday(date)}
                        className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors no-drag"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Botão salvar */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/60">
        <button
          onClick={handleSave}
          disabled={!isComplete || saving}
          className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Salvar
        </button>
      </div>

      <style>{`
        .input-field {
          width: 100%;
          padding: 0.5rem 0.625rem;
          font-size: 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          outline: none;
          background: white;
          color: #374151;
          transition: border-color 0.15s, box-shadow 0.15s;
          -webkit-app-region: no-drag;
        }
        .input-field:focus {
          border-color: #93c5fd;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }
        .dark .input-field {
          background: #111827;
          border-color: #4b5563;
          color: #e5e7eb;
        }
        .dark .input-field:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
        {hint && <span className="text-xs text-gray-400 dark:text-gray-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
