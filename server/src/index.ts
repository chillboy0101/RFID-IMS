import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import crypto from "crypto";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import inventoryRouter from "./routes/inventory.js";
import ordersRouter from "./routes/orders.js";
import dashboardRouter from "./routes/dashboard.js";
import alertsRouter from "./routes/alerts.js";
import reportsRouter from "./routes/reports.js";
import feedbackRouter from "./routes/feedback.js";
import progressRouter from "./routes/progress.js";
import rfidRouter from "./routes/rfid.js";
import vendorsRouter from "./routes/vendors.js";
import reordersRouter from "./routes/reorders.js";
import integrationsRouter from "./routes/integrations.js";
import tenantsRouter from "./routes/tenants.js";
import auditRouter from "./routes/audit.js";
import { auditRequestLogger, captureAuditResponse } from "./middleware/audit.js";
import { resolveAppBaseUrl } from "./utils/appUrl.js";

dotenv.config();

const app = express();

app.disable("etag");

type MetricsSnapshot = {
  startedAtMs: number;
  httpRequestsTotal: number;
  httpRequestsByMethod: Record<string, number>;
  httpResponsesByStatusClass: Record<string, number>;
};

const metrics: MetricsSnapshot = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpRequestsByMethod: {},
  httpResponsesByStatusClass: {},
};

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", true);
}

type ReqWithId = Request & { requestId?: string };

app.use((req: ReqWithId, res, next) => {
  const header = req.header("x-request-id") ?? "";
  const requestId = header.trim() || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

app.use((req: ReqWithId, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const authHeader = req.header("authorization") ?? "";
    const hasAuth = /^Bearer\s+/i.test(authHeader);

    metrics.httpRequestsTotal += 1;
    metrics.httpRequestsByMethod[req.method] = (metrics.httpRequestsByMethod[req.method] ?? 0) + 1;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    metrics.httpResponsesByStatusClass[statusClass] = (metrics.httpResponsesByStatusClass[statusClass] ?? 0) + 1;

    const isOk = res.statusCode < 400;
    const isHealth = req.originalUrl === "/health";
    const isPreflight = req.method === "OPTIONS";
    if (isOk && (isHealth || isPreflight)) {
      return;
    }

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms,
        ip: req.ip,
        hasAuth,
      })
    );
  });
  next();
});

app.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  next();
});

type RateBucket = { count: number; resetAtMs: number };
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    const key = `${opts.keyPrefix}:${ip}`;
    const existing = rateBuckets.get(key);
    const fresh = !existing || existing.resetAtMs <= now;
    const bucket: RateBucket = fresh ? { count: 0, resetAtMs: now + opts.windowMs } : existing!;

    bucket.count += 1;
    rateBuckets.set(key, bucket);

    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader("x-ratelimit-limit", String(opts.max));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.floor(bucket.resetAtMs / 1000)));

    if (bucket.count > opts.max) {
      res.status(429).json({ ok: false, error: "Too many requests" });
      return;
    }

    next();
  };
}

app.use(express.json({ limit: "1mb" }));
app.use(captureAuditResponse);

const corsOrigin = process.env.CORS_ORIGIN;
const corsAllowed = corsOrigin ? corsOrigin.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";

app.use(
  cors({
    origin: corsAllowed.length ? corsAllowed : isProd ? false : true,
    credentials: corsAllowed.length ? true : false,
    maxAge: 60 * 60 * 24,
  })
);

app.use((req, res, next) => {
  const isApiRequest =
    req.path === "/health" ||
    req.path === "/metrics" ||
    req.path.startsWith("/auth") ||
    req.path.startsWith("/admin") ||
    req.path.startsWith("/tenants") ||
    req.path.startsWith("/inventory") ||
    req.path.startsWith("/orders") ||
    req.path.startsWith("/dashboard") ||
    req.path.startsWith("/alerts") ||
    req.path.startsWith("/reports") ||
    req.path.startsWith("/feedback") ||
    req.path.startsWith("/progress") ||
    req.path.startsWith("/rfid") ||
    req.path.startsWith("/vendors") ||
    req.path.startsWith("/reorders") ||
    req.path.startsWith("/integrations") ||
    req.path.startsWith("/audit");

  if (isApiRequest) {
    res.setHeader("cache-control", "no-store");
  }
  next();
});

app.use(rateLimit({ windowMs: 60_000, max: 300, keyPrefix: "global" }));
app.use(auditRequestLogger);

app.use("/auth", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "auth" }));

app.use((_req, res, next) => {
  if (res.getHeader("content-security-policy")) {
    next();
    return;
  }

  if (isProd) {
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  }
  next();
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function requestOrigin(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.header("host") || "localhost";
  return `${proto}://${host}`;
}

function renderApiHome(req: Request): string {
  const origin = requestOrigin(req);
  const dbConnected = mongoose.connection.readyState === 1;
  const dbStateLabels: Record<number, string> = {
    0: "Disconnected",
    1: "Connected",
    2: "Connecting",
    3: "Disconnecting",
  };
  const dbState = dbStateLabels[mongoose.connection.readyState] ?? "Unknown";
  const env = isProd ? "Production" : "Development";
  const uptime = formatDuration(Date.now() - metrics.startedAtMs);
  const version = process.env.npm_package_version ?? "0.1.0";

  const endpointGroups = [
    {
      title: "System",
      links: [
        { label: "Health", path: "/health" },
        { label: "Metrics", path: "/metrics" },
        { label: "Auth", path: "/auth" },
      ],
    },
    {
      title: "Warehouse",
      links: [
        { label: "Inventory", path: "/inventory" },
        { label: "Orders", path: "/orders" },
        { label: "Dashboard", path: "/dashboard" },
        { label: "Audit", path: "/audit" },
      ],
    },
    {
      title: "Hardware",
      links: [
        { label: "RFID hub", path: "/rfid" },
        { label: "Readers", path: "/rfid/receiving-events" },
        { label: "Gates", path: "/rfid/gate-events" },
      ],
    },
  ];

  const endpointMarkup = endpointGroups
    .map(
      (group) => `
        <section class="endpoint-card">
          <h2>${escapeHtml(group.title)}</h2>
          <div class="endpoint-list">
            ${group.links
              .map(
                (link) => `
                  <a href="${escapeHtml(link.path)}">
                    <span>${escapeHtml(link.label)}</span>
                    <code>${escapeHtml(link.path)}</code>
                  </a>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VDL Fulfilment Ops API</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --ink: #071225;
        --muted: #536176;
        --line: #dce4ee;
        --soft: #eef3f8;
        --accent: #0f9f8f;
        --accent-2: #ffdc38;
        --ok: #16a765;
        --warn: #e57b00;
        --danger: #d92d20;
        --shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 16% 12%, rgba(15, 159, 143, 0.14), transparent 28%),
          radial-gradient(circle at 84% 6%, rgba(255, 220, 56, 0.2), transparent 24%),
          linear-gradient(180deg, #ffffff 0%, var(--bg) 48%, #edf3f8 100%);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 36px 0 32px;
      }

      .topbar,
      .hero,
      .endpoint-card,
      .startup-panel,
      .signal-card {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.86);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-radius: 22px;
        padding: 14px 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .mark {
        display: grid;
        width: 44px;
        height: 44px;
        place-items: center;
        border-radius: 14px;
        background: #071225;
        color: #ffffff;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      .brand strong {
        display: block;
        font-size: 15px;
        line-height: 1.2;
      }

      .brand span {
        display: block;
        margin-top: 2px;
        color: var(--muted);
        font-size: 13px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 0 13px;
        border: 1px solid #bfe7d3;
        border-radius: 999px;
        background: #e8f8f0;
        color: #087044;
        font-size: 13px;
        font-weight: 800;
        white-space: nowrap;
      }

      .pulse {
        position: relative;
        width: 9px;
        height: 9px;
        border-radius: 99px;
        background: var(--ok);
      }

      .pulse::after {
        content: "";
        position: absolute;
        inset: -6px;
        border-radius: inherit;
        border: 2px solid rgba(22, 167, 101, 0.24);
        animation: ping 1.8s ease-out infinite;
      }

      @keyframes ping {
        0% {
          transform: scale(0.72);
          opacity: 1;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
        }
      }

      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
        gap: 20px;
        margin-top: 22px;
      }

      .hero {
        border-radius: 28px;
        padding: 34px;
        overflow: hidden;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #bfe3df;
        border-radius: 999px;
        background: #ecfbf8;
        color: #087568;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 760px;
        margin: 18px 0 12px;
        font-size: clamp(36px, 6vw, 72px);
        line-height: 0.94;
        letter-spacing: -0.06em;
      }

      .hero p {
        max-width: 720px;
        margin: 0;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.6;
      }

      .signals {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 28px;
      }

      .signal-card {
        border-radius: 18px;
        padding: 16px;
        box-shadow: none;
      }

      .signal-card span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .signal-card strong {
        display: block;
        margin-top: 8px;
        overflow: hidden;
        font-size: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .startup-panel {
        border-radius: 28px;
        padding: 24px;
      }

      .startup-panel h2,
      .endpoint-card h2 {
        margin: 0;
        font-size: 16px;
        letter-spacing: -0.02em;
      }

      .startup-list {
        display: grid;
        gap: 12px;
        margin-top: 22px;
      }

      .startup-row {
        display: grid;
        grid-template-columns: 20px 1fr auto;
        align-items: center;
        gap: 12px;
        padding: 13px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--soft);
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 5px rgba(22, 167, 101, 0.12);
      }

      .dot.warn {
        background: var(--warn);
        box-shadow: 0 0 0 5px rgba(229, 123, 0, 0.14);
      }

      .startup-row strong {
        display: block;
        font-size: 14px;
      }

      .startup-row small {
        color: var(--muted);
        font-size: 12px;
      }

      .startup-row code {
        color: var(--muted);
        font-size: 12px;
      }

      .endpoint-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-top: 20px;
      }

      .endpoint-card {
        border-radius: 24px;
        padding: 20px;
      }

      .endpoint-list {
        display: grid;
        gap: 9px;
        margin-top: 16px;
      }

      .endpoint-list a {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        min-height: 48px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 15px;
        background: #f8fafc;
      }

      .endpoint-list a:hover {
        border-color: #a9d8d2;
        background: #eefbf8;
      }

      .endpoint-list span {
        font-weight: 800;
      }

      .endpoint-list code {
        color: var(--muted);
        font-size: 12px;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 20px;
        color: var(--muted);
        font-size: 13px;
      }

      .footer code {
        color: var(--ink);
        font-weight: 800;
      }

      @media (max-width: 860px) {
        .shell {
          width: min(100% - 22px, 680px);
          padding-top: 18px;
        }

        .topbar,
        .footer {
          align-items: flex-start;
          flex-direction: column;
        }

        .hero-grid,
        .signals,
        .endpoint-grid {
          grid-template-columns: 1fr;
        }

        .hero,
        .startup-panel,
        .endpoint-card {
          border-radius: 22px;
        }

        .hero {
          padding: 24px;
        }

        .startup-row {
          grid-template-columns: 18px 1fr;
        }

        .startup-row code {
          grid-column: 2;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <nav class="topbar" aria-label="Service summary">
        <div class="brand">
          <div class="mark">vdl</div>
          <div>
            <strong>VDL Fulfilment Ops</strong>
            <span>${escapeHtml(origin)}</span>
          </div>
        </div>
        <div class="status-pill"><span class="pulse"></span> API online</div>
      </nav>

      <section class="hero-grid">
        <div class="hero">
          <div class="eyebrow">Inventory Eye API</div>
          <h1>Warehouse service layer is running.</h1>
          <p>
            RFID intake, inventory control, order fulfilment, gate verification, auditing,
            and tenant operations are available from this backend.
          </p>

          <div class="signals">
            <div class="signal-card">
              <span>Environment</span>
              <strong>${escapeHtml(env)}</strong>
            </div>
            <div class="signal-card">
              <span>Database</span>
              <strong>${escapeHtml(dbState)}</strong>
            </div>
            <div class="signal-card">
              <span>Uptime</span>
              <strong>${escapeHtml(uptime)}</strong>
            </div>
          </div>
        </div>

        <aside class="startup-panel">
          <h2>Service startup</h2>
          <div class="startup-list">
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>HTTP gateway</strong>
                <small>Express request pipeline active</small>
              </div>
              <code>v${escapeHtml(version)}</code>
            </div>
            <div class="startup-row">
              <span class="dot${dbConnected ? "" : " warn"}"></span>
              <div>
                <strong>MongoDB</strong>
                <small>${escapeHtml(dbConnected ? "Connected and accepting operations" : dbState)}</small>
              </div>
              <code>/health</code>
            </div>
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>RFID gateway</strong>
                <small>Reader and gate event routes mounted</small>
              </div>
              <code>/rfid</code>
            </div>
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>Audit trail</strong>
                <small>Protected API activity logging enabled</small>
              </div>
              <code>/audit</code>
            </div>
          </div>
        </aside>
      </section>

      <section class="endpoint-grid" aria-label="Endpoint groups">
        ${endpointMarkup}
      </section>

      <footer class="footer">
        <span>Machine-readable service status remains available at <code>/health</code>.</span>
        <span>Requests served since boot: ${escapeHtml(String(metrics.httpRequestsTotal))}</span>
      </footer>
    </main>
  </body>
</html>`;
}

app.get("/", (req: Request, res: Response) => {
  if (req.accepts(["html", "json"]) === "json") {
    res.json({
      ok: true,
      message: "Inventory Eye API running. See /health",
    });
    return;
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  res.type("html").send(renderApiHome(req));
});

app.get("/status.json", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Inventory Eye API running. See /health",
  });
});

app.get("/verify-email", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const appBaseUrl = resolveAppBaseUrl(req);

  if (appBaseUrl) {
    res.redirect(302, `${appBaseUrl}/verify-email${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    return;
  }

  res.redirect(302, `/auth/verify-email${token ? `?token=${encodeURIComponent(token)}` : ""}`);
});

app.get("/reset-password", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const appBaseUrl = resolveAppBaseUrl(req);

  if (appBaseUrl) {
    res.redirect(302, `${appBaseUrl}/reset-password${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    return;
  }

  res.status(500).json({
    ok: false,
    error: "Password reset UI is not configured. Set APP_BASE_URL or CORS_ORIGIN to your web app origin.",
  });
});

app.get("/health", async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    dbConnected: mongoose.connection.readyState === 1,
  });
});

app.get("/metrics", async (req: Request, res: Response) => {
  const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const token = process.env.METRICS_TOKEN;

  if (isProd && token) {
    const provided = (req.header("x-metrics-token") ?? "").trim();
    if (!provided || provided !== token) {
      res.status(404).send("Not found");
      return;
    }
  }

  const uptimeSeconds = Math.floor((Date.now() - metrics.startedAtMs) / 1000);
  const dbConnected = mongoose.connection.readyState === 1 ? 1 : 0;

  const lines: string[] = [];
  lines.push("# HELP inventory_eye_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE inventory_eye_uptime_seconds gauge");
  lines.push(`inventory_eye_uptime_seconds ${uptimeSeconds}`);
  lines.push("# HELP inventory_eye_db_connected MongoDB connection state (1=connected,0=not)");
  lines.push("# TYPE inventory_eye_db_connected gauge");
  lines.push(`inventory_eye_db_connected ${dbConnected}`);
  lines.push("# HELP inventory_eye_http_requests_total Total HTTP requests");
  lines.push("# TYPE inventory_eye_http_requests_total counter");
  lines.push(`inventory_eye_http_requests_total ${metrics.httpRequestsTotal}`);

  lines.push("# HELP inventory_eye_http_requests_by_method_total Total HTTP requests by method");
  lines.push("# TYPE inventory_eye_http_requests_by_method_total counter");
  for (const [method, count] of Object.entries(metrics.httpRequestsByMethod)) {
    lines.push(`inventory_eye_http_requests_by_method_total{method=\"${method}\"} ${count}`);
  }

  lines.push("# HELP inventory_eye_http_responses_by_status_class_total Total HTTP responses by status class");
  lines.push("# TYPE inventory_eye_http_responses_by_status_class_total counter");
  for (const [cls, count] of Object.entries(metrics.httpResponsesByStatusClass)) {
    lines.push(`inventory_eye_http_responses_by_status_class_total{class=\"${cls}\"} ${count}`);
  }

  res.setHeader("content-type", "text/plain; version=0.0.4");
  res.status(200).send(lines.join("\n") + "\n");
});

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/inventory", inventoryRouter);
app.use("/orders", ordersRouter);
app.use("/dashboard", dashboardRouter);
app.use("/alerts", alertsRouter);
app.use("/reports", reportsRouter);
app.use("/feedback", feedbackRouter);
app.use("/progress", progressRouter);
app.use("/rfid", rfidRouter);
app.use("/vendors", vendorsRouter);
app.use("/reorders", reordersRouter);
app.use("/integrations", integrationsRouter);
app.use("/audit", auditRouter);
app.use("/tenants", tenantsRouter);

app.use((err: unknown, req: ReqWithId, res: Response, _next: express.NextFunction) => {
  const requestId = req.requestId;
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
  );
  res.status(500).json({ ok: false, error: "Internal server error", requestId });
});

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  const mongoUri = process.env.MONGODB_URI;

  const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const requireDb = String(process.env.REQUIRE_DB ?? "").toLowerCase() === "true";
  const failFast = isProd || requireDb;
  const retryMs = Number(process.env.MONGODB_RETRY_MS ?? 5000);

  let connecting = false;
  async function ensureMongoConnected(): Promise<void> {
    if (!mongoUri) return;
    if (mongoose.connection.readyState === 1) return;
    if (connecting) return;
    connecting = true;
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      console.log("mongodb connected");
    } catch (err) {
      console.error("mongodb connect failed", err);
      if (failFast) {
        throw err;
      }
      setTimeout(() => {
        ensureMongoConnected().catch(() => {
        });
      }, retryMs);
    } finally {
      connecting = false;
    }
  }

  await ensureMongoConnected();

  mongoose.connection.on("disconnected", () => {
    if (!failFast) {
      setTimeout(() => {
        ensureMongoConnected().catch(() => {
        });
      }, retryMs);
    }
  });

  app.listen(port, () => {
    console.log(`inventory-eye-server listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
