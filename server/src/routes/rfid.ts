import express from "express";
import mongoose from "mongoose";

import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel, type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { RfidEventModel, rfidEventTypes, type RfidEventType } from "../models/RfidEvent.js";

const router = express.Router();

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

export default router;
