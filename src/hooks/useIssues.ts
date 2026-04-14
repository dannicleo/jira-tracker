import { useState, useEffect, useCallback, useRef } from "react";
import type { TrackedIssue, AppSettings } from "../types";
import {
  getAllTrackedIssues,
  deleteTrackedIssue,
  getAllSettings,
  saveAllSettings,
} from "../services/db";
import { fetchAndTrackIssue, syncAllIssues } from "../services/jira";

interface UseIssuesReturn {
  issues: TrackedIssue[];
  settings: AppSettings;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  addIssue: (issueKey: string) => Promise<void>;
  removeIssue: (issueKey: string) => Promise<void>;
  syncAll: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useIssues(): UseIssuesReturn {
  const [issues, setIssues] = useState<TrackedIssue[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    jira_base_url: "",
    jira_email: "",
    jira_api_token: "",
    sync_interval_minutes: 15,
    theme: "system",
    inactivity_timeout_minutes: 2,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const data = await getAllTrackedIssues();
    setIssues(data);
  }, []);

  // Carrega dados iniciais
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [issuesData, settingsData] = await Promise.all([
          getAllTrackedIssues(),
          getAllSettings(),
        ]);
        setIssues(issuesData);
        setSettings(settingsData);

        // Em dev: sincroniza credenciais com o proxy Vite ao iniciar o app,
        // para que o proxy tenha auth mesmo após restart do `tauri dev`.
        if (import.meta.env.DEV && settingsData.jira_base_url && settingsData.jira_api_token) {
          fetch("/dev/set-credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl: settingsData.jira_base_url,
              email: settingsData.jira_email,
              token: settingsData.jira_api_token,
            }),
          }).catch(() => {/* silencioso */});
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Auto-sync periódico
  useEffect(() => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
    }

    if (settings.sync_interval_minutes > 0 && settings.jira_api_token) {
      const intervalMs = settings.sync_interval_minutes * 60 * 1000;
      syncTimerRef.current = setInterval(async () => {
        const currentIssues = await getAllTrackedIssues();
        if (currentIssues.length === 0) return;

        try {
          await syncAllIssues(
            currentIssues.map((i) => i.issue_key),
            settings
          );
          await refresh();
        } catch {
          // silencioso no auto-sync
        }
      }, intervalMs);
    }

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [settings, refresh]);

  const addIssue = useCallback(
    async (issueKey: string) => {
      if (!settings.jira_api_token) {
        throw new Error("Configure as credenciais do Jira primeiro nas configurações.");
      }
      setError(null);
      const tracked = await fetchAndTrackIssue(issueKey, settings);
      setIssues((prev) => {
        const exists = prev.find((i) => i.issue_key === tracked.issue_key);
        if (exists) {
          return prev.map((i) => (i.issue_key === tracked.issue_key ? tracked : i));
        }
        return [tracked, ...prev];
      });
    },
    [settings]
  );

  const removeIssue = useCallback(async (issueKey: string) => {
    await deleteTrackedIssue(issueKey);
    setIssues((prev) => prev.filter((i) => i.issue_key !== issueKey));
  }, []);

  const syncAll = useCallback(async () => {
    if (issues.length === 0) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await syncAllIssues(
        issues.map((i) => i.issue_key),
        settings
      );
      await refresh();
      if (result.errors.length > 0) {
        setError(`Erros ao sincronizar: ${result.errors.join(", ")}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [issues, settings, refresh]);

  const updateSettings = useCallback(async (newSettings: AppSettings) => {
    await saveAllSettings(newSettings);
    setSettings(newSettings);
  }, []);

  return {
    issues,
    settings,
    loading,
    syncing,
    error,
    addIssue,
    removeIssue,
    syncAll,
    updateSettings,
    refresh,
  };
}
