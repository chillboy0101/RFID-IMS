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

dotenv.config();

const app = express();

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

const corsOrigin = process.env.CORS_ORIGIN;
const corsAllowed = corsOrigin ? corsOrigin.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";

app.use(
  cors({
    origin: corsAllowed.length ? corsAllowed : isProd ? false : true,
    credentials: corsAllowed.length ? true : false,
  })
);

app.use(rateLimit({ windowMs: 60_000, max: 300, keyPrefix: "global" }));

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

app.get("/", async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Inventory Eye API running. See /health",
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
