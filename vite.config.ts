import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { Buffer } from "buffer";
import * as https from "https";
import * as http from "http";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "http";

// ─── Credenciais dinâmicas (em memória no processo Node.js) ──────────────────

interface DevCredentials {
  baseUrl: string;
  email: string;
  token: string;
}

const devCreds: DevCredentials = { baseUrl: "", email: "", token: "" };

function makeBasicAuth(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

// ─── Plugin Vite: proxy dinâmico + endpoint de credenciais ───────────────────

function devJiraPlugin(): Plugin {
  return {
    name: "dev-jira",
    configureServer(server) {
      // ── POST /dev/set-credentials — recebe credenciais do Settings.tsx ──────
      server.middlewares.use(
        "/dev/set-credentials",
        (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");

          if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }
          if (req.method !== "POST") {
            res.writeHead(405);
            res.end();
            return;
          }

          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { baseUrl, email, token } = JSON.parse(body) as DevCredentials;
              devCreds.baseUrl = (baseUrl ?? "").replace(/\/$/, "");
              devCreds.email   = email  ?? "";
              devCreds.token   = token  ?? "";
              console.log(`\n[jira-proxy] ✓ Credenciais atualizadas: ${devCreds.email} → ${devCreds.baseUrl}\n`);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: String(e) }));
            }
          });
        }
      );

      // ── GET|POST /jira/* — proxy reverso dinâmico para o Jira ───────────────
      server.middlewares.use(
        "/jira",
        (req: IncomingMessage, res: ServerResponse) => {
          if (!devCreds.baseUrl || !devCreds.email || !devCreds.token) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Credenciais não configuradas. Acesse Configurações e salve as credenciais Jira.",
              })
            );
            return;
          }

          let targetPath = req.url ?? "/";
          // Remove o prefixo /jira se ainda estiver presente (depende de como o middleware é chamado)
          if (targetPath.startsWith("/jira")) {
            targetPath = targetPath.slice(5);
          }

          let targetUrl: URL;
          try {
            targetUrl = new URL(`${devCreds.baseUrl}${targetPath}`);
          } catch {
            res.writeHead(400);
            res.end("URL inválida");
            return;
          }

          const auth = makeBasicAuth(devCreds.email, devCreds.token);
          const isHttps = targetUrl.protocol === "https:";
          const transport = isHttps ? https : http;

          const options: http.RequestOptions = {
            hostname: targetUrl.hostname,
            port: isHttps ? 443 : 80,
            path: targetUrl.pathname + targetUrl.search,
            method: req.method ?? "GET",
            headers: {
              Authorization: auth,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          };

          const proxyReq = transport.request(options, (proxyRes) => {
            // Repassa headers relevantes
            const passHeaders: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(proxyRes.headers)) {
              if (v !== undefined) passHeaders[k] = v;
            }
            res.writeHead(proxyRes.statusCode ?? 200, passHeaders);
            proxyRes.pipe(res, { end: true });
          });

          proxyReq.on("error", (e) => {
            console.error("[jira-proxy] erro:", e.message);
            if (!res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Proxy error: ${e.message}` }));
            }
          });

          req.pipe(proxyReq, { end: true });
        }
      );
    },
  };
}

// ─── Config Principal ─────────────────────────────────────────────────────────

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = process.env.TAURI_DEV_HOST;

  // Seed inicial: se ainda houver vars no .env, usa como ponto de partida
  const seedBase  = (env.JIRA_BASE_URL  ?? "").replace(/\/$/, "");
  const seedEmail = env.JIRA_EMAIL      ?? "";
  const seedToken = env.JIRA_API_TOKEN  ?? "";

  if (seedBase && seedEmail && seedToken) {
    devCreds.baseUrl = seedBase;
    devCreds.email   = seedEmail;
    devCreds.token   = seedToken;
    console.log(`[jira-proxy] Seed do .env: ${seedEmail} → ${seedBase}`);
  }

  return {
    plugins: [react(), devJiraPlugin()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
  };
});
