import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { OrderModel } from "../models/Order.js";
import { TaskSessionModel, taskSessionKinds, type TaskSessionKind } from "../models/TaskSession.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      startSession: "POST /progress/sessions/start",
      stopSession: "POST /progress/sessions/:id/stop",
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

  const doc = await TaskSessionModel.create({
    tenantId,
    userId: auth.id,
    kind,
    startedAt: new Date(),
    meta,
  });

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

  res.json({ ok: true, session });
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
      OrderModel.countDocuments({ tenantId, status: { $in: ["created", "picking"] } }).exec(),
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
      continue;
    }

    const secs = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
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
