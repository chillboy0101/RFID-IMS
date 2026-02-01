import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireGateApiKey, requireGateTenant, type GateRequest } from "../middleware/gate.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { ExitAuthorizationModel } from "../models/ExitAuthorization.js";
import { InventoryItemModel, type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { RfidEventModel, rfidEventTypes, type RfidEventType } from "../models/RfidEvent.js";
import { SecurityAlertModel } from "../models/SecurityAlert.js";

const router = express.Router();

router.post("/gate-events", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;

  const { tagId, location, observedAt, source, itemId } = req.body as {
    tagId?: string;
    location?: string;
    observedAt?: string;
    source?: string;
    itemId?: string;
  };

  if (!tagId || !tagId.trim()) {
    res.status(400).json({ ok: false, error: "tagId is required" });
    return;
  }

  const loc = (location ?? "").trim() || "EXIT_MAIN";

  let resolvedItem: InventoryItemDocument | null = null;
  if (itemId) {
    if (!mongoose.isValidObjectId(itemId)) {
      res.status(400).json({ ok: false, error: "Invalid itemId" });
      return;
    }
    resolvedItem = (await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec()) as InventoryItemDocument | null;
  } else {
    resolvedItem = (await InventoryItemModel.findOne({ tenantId, rfidTagId: tagId.trim() }).exec()) as InventoryItemDocument | null;
  }

  const eventDoc = await RfidEventModel.create({
    tenantId,
    tagId: tagId.trim(),
    eventType: "scan",
    itemId: resolvedItem?._id,
    location: loc,
    observedAt: observedAt ? new Date(observedAt) : new Date(),
    source: source?.trim() || "gate",
    raw: req.body,
  });

  const now = new Date();
  const authDoc = await ExitAuthorizationModel.findOne({
    tenantId,
    tagId: tagId.trim(),
    location: loc,
    status: "active",
    expiresAt: { $gt: now },
  })
    .sort({ expiresAt: -1 })
    .exec();

  if (authDoc) {
    authDoc.lastSeenAt = now;
    authDoc.lastSeenSource = source?.trim() || "gate";
    await authDoc.save();
    res.json({ ok: true, decision: "ALLOW", authorized: true, authorizationId: authDoc._id, event: eventDoc, item: resolvedItem });
    return;
  }

  const alertDoc = await SecurityAlertModel.create({
    tenantId,
    tagId: tagId.trim(),
    itemId: resolvedItem?._id,
    location: loc,
    source: source?.trim() || "gate",
    observedAt: eventDoc.observedAt,
    status: "open",
    severity: "critical",
    message: "Unauthorized exit detection",
    meta: { rfidEventId: eventDoc._id.toString() },
  });

  res.json({ ok: true, decision: "DENY", authorized: false, event: eventDoc, item: resolvedItem, alert: alertDoc });
});

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      ingest: "POST /rfid/events",
    },
  });
});

router.post("/events", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { tagId, eventType, location, delta, observedAt, source, itemId } = req.body as {
    tagId?: string;
    eventType?: RfidEventType;
    location?: string;
    delta?: number;
    observedAt?: string;
    source?: string;
    itemId?: string;
  };

  if (!tagId || !tagId.trim()) {
    res.status(400).json({ ok: false, error: "tagId is required" });
    return;
  }

  const type = eventType ?? "scan";
  if (!rfidEventTypes.includes(type)) {
    res.status(400).json({ ok: false, error: "Invalid eventType" });
    return;
  }

  let resolvedItem: InventoryItemDocument | null = null;

  if (itemId) {
    if (!mongoose.isValidObjectId(itemId)) {
      res.status(400).json({ ok: false, error: "Invalid itemId" });
      return;
    }
    resolvedItem = (await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec()) as InventoryItemDocument | null;
  } else {
    resolvedItem = (await InventoryItemModel.findOne({ tenantId, rfidTagId: tagId.trim() }).exec()) as InventoryItemDocument | null;
  }

  const eventDoc = await RfidEventModel.create({
    tenantId,
    tagId: tagId.trim(),
    eventType: type,
    itemId: resolvedItem?._id,
    location: location?.trim(),
    delta,
    observedAt: observedAt ? new Date(observedAt) : new Date(),
    source,
    raw: req.body,
  });

  if (!resolvedItem) {
    res.status(202).json({ ok: true, processed: false, event: eventDoc });
    return;
  }

  let wroteLog = false;

  if (typeof location === "string" && location.trim() && location.trim() !== (resolvedItem.location ?? "")) {
    const prevLocation = resolvedItem.location;
    resolvedItem.location = location.trim();
    await resolvedItem.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: resolvedItem._id,
      action: "update",
      actorUserId: auth.id,
      newQuantity: resolvedItem.quantity,
      reason: "RFID location update",
      meta: { prevLocation, newLocation: resolvedItem.location, rfidEventId: eventDoc._id.toString() },
    });

    wroteLog = true;
  }

  if (typeof delta === "number" && Number.isFinite(delta) && delta !== 0) {
    const previousQuantity = resolvedItem.quantity;
    const newQuantity = previousQuantity + delta;

    if (newQuantity < 0) {
      res.status(409).json({ ok: false, error: "Insufficient stock for RFID delta" });
      return;
    }

    resolvedItem.quantity = newQuantity;
    await resolvedItem.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: resolvedItem._id,
      action: "adjust",
      delta,
      previousQuantity,
      newQuantity,
      actorUserId: auth.id,
      reason: "RFID quantity adjustment",
      meta: { rfidEventId: eventDoc._id.toString(), eventType: type },
    });

    wroteLog = true;
  }

  res.json({ ok: true, processed: true, wroteLog, event: eventDoc, item: resolvedItem });
});

router.post("/exit-authorizations", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { tagId, tagIds, location, minutes, orderId } = req.body as {
    tagId?: string;
    tagIds?: string[];
    location?: string;
    minutes?: number;
    orderId?: string;
  };

  const tagsRaw = Array.isArray(tagIds) ? tagIds : tagId ? [tagId] : [];
  const tags = tagsRaw.map((t) => String(t ?? "").trim()).filter(Boolean);
  if (tags.length === 0) {
    res.status(400).json({ ok: false, error: "tagId or tagIds is required" });
    return;
  }

  const loc = (location ?? "").trim() || "EXIT_MAIN";
  const mins = Math.min(240, Math.max(1, Number(minutes) || 10));
  const expiresAt = new Date(Date.now() + mins * 60 * 1000);

  let orderObjectId: string | undefined;
  if (orderId !== undefined && orderId !== null && String(orderId).trim()) {
    if (!mongoose.isValidObjectId(orderId)) {
      res.status(400).json({ ok: false, error: "Invalid orderId" });
      return;
    }
    orderObjectId = String(orderId).trim();
  }

  await ExitAuthorizationModel.updateMany(
    { tenantId, tagId: { $in: tags }, location: loc, status: "active" },
    { $set: { status: "revoked" } }
  ).exec();

  const created = await ExitAuthorizationModel.insertMany(
    tags.map((t) => ({
      tenantId,
      tagId: t,
      location: loc,
      status: "active",
      orderId: orderObjectId,
      createdByUserId: auth.id,
      expiresAt,
    }))
  );

  res.status(201).json({ ok: true, authorizations: created, expiresAt, location: loc });
});

router.get("/exit-authorizations", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const location = (req.query.location as string | undefined)?.trim();
  const tagId = (req.query.tagId as string | undefined)?.trim();

  const filter: Record<string, unknown> = { tenantId };
  if (status) filter.status = status;
  if (location) filter.location = location;
  if (tagId) filter.tagId = tagId;

  const docs = await ExitAuthorizationModel.find(filter).sort({ createdAt: -1 }).limit(500).exec();
  res.json({ ok: true, authorizations: docs });
});

export default router;
