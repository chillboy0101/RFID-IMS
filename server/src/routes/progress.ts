import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { setAuditContext } from "../middleware/audit.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { OrderModel } from "../models/Order.js";
import { TaskSessionModel, taskSessionKinds, type TaskSessionKind } from "../models/TaskSession.js";

const router = express.Router();

const taskSessionKindLabels: Record<TaskSessionKind, string> = {
  inventory_update: "Inventory updates",
  order_fulfillment: "Order fulfillment",
  other: "Other",
};

function openSessionFilter(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    $or: [{ endedAt: { $exists: false } }, { endedAt: null }],
  };
}

function formatTaskSessionKind(kind: TaskSessionKind): string {
  return taskSessionKindLabels[kind] ?? kind;
}

function normalizeProgressMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  return { ...(meta as Record<string, unknown>) };
}

function applyProgressAuditContext(
  res: express.Response,
  session: mongoose.HydratedDocument<any>,
  summary: string,
  metadata?: Record<string, unknown>
): void {
  const kind = String(session.kind) as TaskSessionKind;
  const kindLabel = formatTaskSessionKind(kind);
  const sessionMeta = normalizeProgressMeta(session.meta) ?? {};
  const routeLabel =
    typeof sessionMeta.routeLabel === "string" && sessionMeta.routeLabel.trim() ? sessionMeta.routeLabel.trim() : undefined;

  setAuditContext(res, {
    type: String(metadata?.auditType ?? "progress.session.start"),
    category: "progress",
    entityType: "task_session",
    entityId: session._id.toString(),
    entityLabel: routeLabel || kindLabel,
    summary,
    metadata: {
      kind,
      kindLabel,
      ...sessionMeta,
      ...(metadata ?? {}),
    },
  });
}

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      startSession: "POST /progress/sessions/start",
      stopSession: "POST /progress/sessions/:id/stop",
      autoSync: "POST /progress/sessions/auto-sync",
      mySessions: "GET /progress/sessions/me",
      summary: "GET /progress/summary?days=7",
      allSessions: "GET /progress/sessions/all (admin)",
    },
  });
});

router.post("/sessions/start", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { kind, meta } = req.body as { kind?: TaskSessionKind; meta?: unknown };

  if (!kind || !taskSessionKinds.includes(kind)) {
    res.status(400).json({ ok: false, error: "Invalid kind" });
    return;
  }

  const existingOpenSession = await TaskSessionModel.findOne(openSessionFilter(tenantId, auth.id)).sort({ startedAt: -1 }).exec();
  if (existingOpenSession) {
    res.status(409).json({ ok: false, error: "A work session is already running" });
    return;
  }

  const doc = await TaskSessionModel.create({
    tenantId,
    userId: auth.id,
    kind,
    startedAt: new Date(),
    meta,
  });

  applyProgressAuditContext(res, doc, `Started ${formatTaskSessionKind(kind).toLowerCase()} session`, { mode: "manual" });

  res.status(201).json({ ok: true, session: doc });
});

router.post("/sessions/:id/stop", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const session = await TaskSessionModel.findOne({ _id: id, tenantId }).exec();
  if (!session) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  if (session.userId.toString() !== auth.id && auth.role !== "admin") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  if (session.endedAt) {
    res.status(409).json({ ok: false, error: "Already stopped" });
    return;
  }

  session.endedAt = new Date();
  await session.save();

  applyProgressAuditContext(res, session, `Stopped ${formatTaskSessionKind(session.kind as TaskSessionKind).toLowerCase()} session`, {
    auditType: "progress.session.stop",
  });

  res.json({ ok: true, session });
});

router.post("/sessions/auto-sync", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const {
    kind,
    routeName,
    routeLabel,
    reason,
  } = req.body as {
    kind?: TaskSessionKind | null;
    reason?: string;
    routeName?: string;
    routeLabel?: string;
  };

  if (kind !== null && kind !== undefined && !taskSessionKinds.includes(kind)) {
    res.status(400).json({ ok: false, error: "Invalid kind" });
    return;
  }

  const openSessions = await TaskSessionModel.find(openSessionFilter(tenantId, auth.id)).sort({ startedAt: -1 }).exec();
  const [latestOpenSession, ...extraOpenSessions] = openSessions;
  const now = new Date();

  for (const extraSession of extraOpenSessions) {
    if (!extraSession.endedAt) {
      extraSession.endedAt = now;
      await extraSession.save();
    }
  }

  if (kind === null || kind === undefined) {
    if (!latestOpenSession) {
      setAuditContext(res, { skip: true });
      res.json({ ok: true, action: "none" });
      return;
    }

    latestOpenSession.endedAt = now;
    latestOpenSession.meta = {
      ...(normalizeProgressMeta(latestOpenSession.meta) ?? {}),
      mode: "automatic",
      stopReason: reason ?? "hidden",
    };
    await latestOpenSession.save();

    applyProgressAuditContext(
      res,
      latestOpenSession,
      `Paused automatic ${formatTaskSessionKind(latestOpenSession.kind as TaskSessionKind).toLowerCase()} tracking`,
      {
        auditType: "progress.session.stop",
        mode: "automatic",
        stopReason: reason ?? "hidden",
      }
    );

    res.json({ ok: true, action: "stopped", session: latestOpenSession });
    return;
  }

  const automaticMeta = {
    mode: "automatic",
    routeName: typeof routeName === "string" && routeName.trim() ? routeName.trim() : undefined,
    routeLabel: typeof routeLabel === "string" && routeLabel.trim() ? routeLabel.trim() : undefined,
    syncReason: typeof reason === "string" && reason.trim() ? reason.trim() : "route",
  };

  if (latestOpenSession && latestOpenSession.kind === kind) {
    latestOpenSession.meta = {
      ...(normalizeProgressMeta(latestOpenSession.meta) ?? {}),
      ...automaticMeta,
    };
    await latestOpenSession.save();
    setAuditContext(res, { skip: true });
    res.json({ ok: true, action: "continued", session: latestOpenSession });
    return;
  }

  if (latestOpenSession && !latestOpenSession.endedAt) {
    latestOpenSession.endedAt = now;
    latestOpenSession.meta = {
      ...(normalizeProgressMeta(latestOpenSession.meta) ?? {}),
      mode: "automatic",
      stopReason: "workflow_switch",
    };
    await latestOpenSession.save();
  }

  const nextSession = await TaskSessionModel.create({
    tenantId,
    userId: auth.id,
    kind,
    startedAt: now,
    meta: automaticMeta,
  });

  applyProgressAuditContext(
    res,
    nextSession,
    latestOpenSession
      ? `Switched automatic work tracking to ${formatTaskSessionKind(kind).toLowerCase()}`
      : `Started automatic ${formatTaskSessionKind(kind).toLowerCase()} tracking`,
    {
      auditType: latestOpenSession ? "progress.session.switch" : "progress.session.start",
      mode: "automatic",
      previousSessionId: latestOpenSession?._id?.toString(),
    }
  );

  res.status(latestOpenSession ? 200 : 201).json({
    ok: true,
    action: latestOpenSession ? "switched" : "started",
    session: nextSession,
  });
});

router.get("/sessions/me", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const sessions = await TaskSessionModel.find({ tenantId, userId: auth.id }).sort({ startedAt: -1 }).limit(200).exec();
  res.json({ ok: true, sessions });
});

router.get("/sessions/all", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const sessions = await TaskSessionModel.find({ tenantId }).sort({ startedAt: -1 }).limit(500).exec();
  res.json({ ok: true, sessions });
});

router.get("/summary", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const daysRaw = (req.query.days as string | undefined) ?? "7";
  const days = Math.min(365, Math.max(1, Number(daysRaw) || 7));

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [sessions, inventoryLogs, fulfillmentLogs, orderCounts] = await Promise.all([
    TaskSessionModel.find({ tenantId, userId: auth.id, startedAt: { $gte: since } }).exec(),
    InventoryLogModel.find({ tenantId, actorUserId: auth.id, createdAt: { $gte: since } }).exec(),
    InventoryLogModel.find({ tenantId, actorUserId: auth.id, reason: "Order fulfillment", createdAt: { $gte: since } }).exec(),
    Promise.all([
      OrderModel.countDocuments({ tenantId, status: { $in: ["created", "picking", "authorized"] } }).exec(),
      OrderModel.countDocuments({ tenantId, status: "fulfilled", fulfilledAt: { $gte: since } }).exec(),
    ]),
  ]);

  let totalSeconds = 0;
  let openSessions = 0;

  for (const s of sessions) {
    const startedAt = (s as unknown as { startedAt?: Date }).startedAt;
    const endedAt = (s as unknown as { endedAt?: Date | null }).endedAt;
    if (!(startedAt instanceof Date)) continue;

    if (!endedAt) {
      openSessions += 1;
    }

    const effectiveEnd = endedAt instanceof Date ? endedAt : now;
    const secs = Math.max(0, Math.floor((effectiveEnd.getTime() - startedAt.getTime()) / 1000));
    totalSeconds += secs;
  }

  const [openOrdersCount, fulfilledOrdersCount] = orderCounts;

  res.json({
    ok: true,
    window: { days, since },
    timeSpent: { totalSeconds, openSessions },
    completedInventoryUpdates: { count: inventoryLogs.length },
    orderFulfillmentProgress: {
      fulfilledByUserCount: fulfillmentLogs.length,
      openOrdersCount,
      fulfilledOrdersCount,
    },
  });
});

export default router;
