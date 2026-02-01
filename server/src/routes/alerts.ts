import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { SecurityAlertModel, securityAlertStatuses } from "../models/SecurityAlert.js";
import { asEnum } from "../utils/validate.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /alerts?expiryDays=30&movementHours=24&movementDelta=50",
      securityList: "GET /alerts/security?status=open",
      securityUpdateStatus: "PATCH /alerts/security/:id/status (manager/admin)",
    },
  });
});

router.get("/security", requireRole("manager", "admin"), async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const limitRaw = (req.query.limit as string | undefined)?.trim();
  const limit = Math.min(500, Math.max(1, Number(limitRaw) || 200));

  const filter: Record<string, unknown> = { tenantId };
  if (status) filter.status = status;

  const docs = await SecurityAlertModel.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  res.json({ ok: true, alerts: docs });
});

router.patch("/security/:id/status", requireRole("manager", "admin"), async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const statusR = asEnum(body.status, securityAlertStatuses, { field: "status", required: true });
  if (!statusR.ok) {
    res.status(400).json({ ok: false, error: statusR.error });
    return;
  }

  const doc = await SecurityAlertModel.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { status: statusR.value } },
    { new: true }
  ).exec();
  if (!doc) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, alert: doc });
});

router.get("/list", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const expiryDaysRaw = (req.query.expiryDays as string | undefined) ?? "30";
  const movementHoursRaw = (req.query.movementHours as string | undefined) ?? "24";
  const movementDeltaRaw = (req.query.movementDelta as string | undefined) ?? "50";

  const expiryDays = Math.min(365, Math.max(1, Number(expiryDaysRaw) || 30));
  const movementHours = Math.min(720, Math.max(1, Number(movementHoursRaw) || 24));
  const movementDelta = Math.min(100000, Math.max(1, Number(movementDeltaRaw) || 50));

  const now = new Date();
  const expiryBefore = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const since = new Date(now.getTime() - movementHours * 60 * 60 * 1000);

  const [lowStockItems, expiringSoonItems, recentLogs] = await Promise.all([
    InventoryItemModel.find({ tenantId, $expr: { $lte: ["$quantity", "$reorderLevel"] } })
      .sort({ quantity: 1 })
      .limit(200)
      .exec(),
    InventoryItemModel.find({ tenantId, expiryDate: { $ne: null, $lte: expiryBefore } })
      .sort({ expiryDate: 1 })
      .limit(200)
      .exec(),
    InventoryLogModel.find({ tenantId, createdAt: { $gte: since }, delta: { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(500)
      .exec(),
  ]);

  const unusualMovements = recentLogs.filter((l) => {
    const d = (l as unknown as { delta?: number }).delta;
    return typeof d === "number" && Number.isFinite(d) && Math.abs(d) >= movementDelta;
  });

  res.json({
    ok: true,
    alerts: {
      lowStock: {
        count: lowStockItems.length,
        items: lowStockItems,
      },
      expiringSoon: {
        count: expiringSoonItems.length,
        items: expiringSoonItems,
        expiryDays,
      },
      unusualMovements: {
        count: unusualMovements.length,
        logs: unusualMovements,
        movementHours,
        movementDelta,
      },
    },
  });
});

export default router;
