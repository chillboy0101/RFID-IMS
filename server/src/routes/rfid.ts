import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireGateApiKey, requireGateTenant, generateKey, hashKey, type GateRequest } from "../middleware/gate.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { GateApiKeyModel } from "../models/GateApiKey.js";
import { ExitAuthorizationModel } from "../models/ExitAuthorization.js";
import { InventoryItemModel, type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryUnitModel } from "../models/InventoryUnit.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { RfidEventModel, rfidEventTypes, type RfidEventType } from "../models/RfidEvent.js";
import { RfidTagModel, upsertRfidTag } from "../models/RfidTag.js";
import { SecurityAlertModel } from "../models/SecurityAlert.js";

const router = express.Router();

router.post("/gate-events", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;

  const { tagId, barcode, location, observedAt, source, itemId } = req.body as {
    tagId?: string;
    barcode?: string;
    location?: string;
    observedAt?: string;
    source?: string;
    itemId?: string;
  };

  const cleanTagId = typeof tagId === "string" ? tagId.trim() : "";
  const cleanBarcode = typeof barcode === "string" ? barcode.trim() : "";
  if (!cleanTagId && !cleanBarcode) {
    res.status(400).json({ ok: false, error: "tagId or barcode is required" });
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
    if (cleanTagId) {
      resolvedItem = (await InventoryItemModel.findOne({ tenantId, rfidTagId: cleanTagId }).exec()) as InventoryItemDocument | null;
    } else {
      resolvedItem = (await InventoryItemModel.findOne({ tenantId, barcode: cleanBarcode }).exec()) as InventoryItemDocument | null;
    }
  }

  const eventDoc = await RfidEventModel.create({
    tenantId,
    tagId: cleanTagId || cleanBarcode,
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
    ...(cleanTagId ? { tagId: cleanTagId } : { barcode: cleanBarcode }),
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
    tagId: cleanTagId || undefined,
    barcode: cleanBarcode || undefined,
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

router.get("/events/latest", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const location = (req.query.location as string | undefined)?.trim();
  const filter: Record<string, unknown> = { tenantId };
  if (location) filter.location = location;

  const event = await RfidEventModel.findOne(filter)
    .sort({ observedAt: -1 })
    .limit(1)
    .exec();

  if (!event) { res.json({ ok: true, event: null }); return; }
  res.json({ ok: true, event });
});

router.get("/events", async (req: TenantRequest, res) => {
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

  const { tagId, tagIds, barcode, barcodes, location, minutes, orderId } = req.body as {
    tagId?: string;
    tagIds?: string[];
    barcode?: string;
    barcodes?: string[];
    location?: string;
    minutes?: number;
    orderId?: string;
  };

  const tagsRaw = Array.isArray(tagIds) ? tagIds : tagId ? [tagId] : [];
  const tags = tagsRaw.map((t) => String(t ?? "").trim()).filter(Boolean);
  const barcodesRaw = Array.isArray(barcodes) ? barcodes : barcode ? [barcode] : [];
  const barcodeList = barcodesRaw.map((b) => String(b ?? "").trim()).filter(Boolean);

  if (tags.length === 0 && barcodeList.length === 0) {
    res.status(400).json({ ok: false, error: "tagId/tagIds or barcode/barcodes is required" });
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

  if (tags.length) {
    await ExitAuthorizationModel.updateMany(
      { tenantId, tagId: { $in: tags }, location: loc, status: "active" },
      { $set: { status: "revoked" } }
    ).exec();
  }
  if (barcodeList.length) {
    await ExitAuthorizationModel.updateMany(
      { tenantId, barcode: { $in: barcodeList }, location: loc, status: "active" },
      { $set: { status: "revoked" } }
    ).exec();
  }

  const created = await ExitAuthorizationModel.insertMany([
    ...tags.map((t) => ({
      tenantId,
      tagId: t,
      location: loc,
      status: "active",
      orderId: orderObjectId,
      createdByUserId: auth.id,
      expiresAt,
    })),
    ...barcodeList.map((b) => ({
      tenantId,
      barcode: b,
      location: loc,
      status: "active",
      orderId: orderObjectId,
      createdByUserId: auth.id,
      expiresAt,
    })),
  ]);

  res.status(201).json({ ok: true, authorizations: created, expiresAt, location: loc });
});

router.get("/exit-authorizations", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const location = (req.query.location as string | undefined)?.trim();
  const tagId = (req.query.tagId as string | undefined)?.trim();
  const barcode = (req.query.barcode as string | undefined)?.trim();

  const filter: Record<string, unknown> = { tenantId };
  if (status) filter.status = status;
  if (location) filter.location = location;
  if (tagId) filter.tagId = tagId;
  if (barcode) filter.barcode = barcode;

  const docs = await ExitAuthorizationModel.find(filter).sort({ createdAt: -1 }).limit(500).exec();
  res.json({ ok: true, authorizations: docs });
});

// ─── RFID Tag Management (admin only) ─────────────────────────────────────────

/** List all RFID tags for the tenant */
router.get("/tags", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { status, search, page, limit } = req.query as { status?: string; search?: string; page?: string; limit?: string };

  const filter: Record<string, unknown> = { tenantId };
  if (status === "active" || status === "inactive") filter.status = status;
  if (search?.trim()) {
    filter.$or = [
      { tagId: { $regex: search.trim(), $options: "i" } },
      { itemName: { $regex: search.trim(), $options: "i" } },
      { itemBarcode: { $regex: search.trim(), $options: "i" } },
      { itemSku: { $regex: search.trim(), $options: "i" } },
    ];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [docs, total] = await Promise.all([
    RfidTagModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).exec(),
    RfidTagModel.countDocuments(filter).exec(),
  ]);

  res.json({ ok: true, tags: docs, page: pageNum, limit: limitNum, total, hasMore: skip + docs.length < total });
});

/** Get single tag details */
router.get("/tags/:tagId", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOne({ tenantId, tagId }).exec();
  if (!doc) { res.status(404).json({ ok: false, error: "Tag not found" }); return; }
  res.json({ ok: true, tag: doc });
});

/** Reassign tag to a different item */
router.patch("/tags/:tagId", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;
  const { itemId } = req.body as { itemId?: string | null };

  if (itemId !== undefined && itemId !== null && itemId !== "") {
    if (!mongoose.isValidObjectId(itemId)) { res.status(400).json({ ok: false, error: "Invalid itemId" }); return; }
    const item = await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec();
    if (!item) { res.status(404).json({ ok: false, error: "Item not found" }); return; }
    const doc = await RfidTagModel.findOneAndUpdate(
      { tenantId, tagId },
      {
        $set: {
          itemId: item._id,
          itemBarcode: item.barcode,
          itemName: item.name,
          itemSku: item.sku,
          status: "active",
          assignedAt: new Date(),
          deactivatedAt: null,
        },
      },
      { upsert: true, new: true }
    ).exec();
    res.json({ ok: true, tag: doc }); return;
  }

  // Clear assignment
  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: { status: "inactive", deactivatedAt: new Date() },
      $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
    },
    { new: true }
  ).exec();
  if (!doc) { res.status(404).json({ ok: false, error: "Tag not found" }); return; }
  res.json({ ok: true, tag: doc });
});

/** Activate a tag */
router.post("/tags/:tagId/activate", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    { $set: { status: "active", deactivatedAt: null } },
    { new: true }
  ).exec();
  if (!doc) { res.status(404).json({ ok: false, error: "Tag not found" }); return; }
  res.json({ ok: true, tag: doc });
});

/** Deactivate a tag */
router.post("/tags/:tagId/deactivate", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    { $set: { status: "inactive", deactivatedAt: new Date() }, $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" } },
    { new: true }
  ).exec();
  if (!doc) { res.status(404).json({ ok: false, error: "Tag not found" }); return; }
  res.json({ ok: true, tag: doc });
});

/** Remove tag assignment */
router.delete("/tags/:tagId", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: { status: "inactive", deactivatedAt: new Date() },
      $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
    },
    { new: true }
  ).exec();
  if (!doc) { res.status(404).json({ ok: false, error: "Tag not found" }); return; }
  res.json({ ok: true });
});

/** Migrate pre-existing tags from InventoryItem/InventoryUnit into RfidTag (one-time sync) */
router.post("/tags/migrate", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;

  // Sync InventoryItem-level tags
  const items = await InventoryItemModel.find({ tenantId, rfidTagId: { $exists: true, $ne: "" } }).exec();
  for (const item of items) {
    await upsertRfidTag(tenantId, item.rfidTagId as string, item);
  }

  // Sync InventoryUnit-level tags
  const units = await InventoryUnitModel.find({ tenantId, tagId: { $exists: true, $ne: "" } }).exec();
  for (const unit of units) {
    const alreadySynced = await RfidTagModel.findOne({ tenantId, tagId: unit.tagId }).exec();
    if (!alreadySynced) {
      const parentItem = await InventoryItemModel.findOne({ _id: unit.itemId, tenantId }).exec();
      if (parentItem) await upsertRfidTag(tenantId, unit.tagId as string, parentItem);
    }
  }

  const count = await RfidTagModel.countDocuments({ tenantId }).exec();
  res.json({ ok: true, message: "Migration complete", totalTags: count });
});

// ─── Gate API Key Management (admin only) ─────────────────────────────────────

/** List all gate API keys for the tenant (never returns the raw key) */
router.get("/gate-keys", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const docs = await GateApiKeyModel
    .find({ tenantId })
    .sort({ createdAt: -1 })
    .select("name keyPrefix locationHint lastSeenAt lastSeenSource expiresAt revokedAt createdAt")
    .exec();
  res.json({ ok: true, keys: docs });
});

/** Create a new gate API key. Returns the raw key ONCE — store it securely. */
router.post("/gate-keys", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

  const { name, locationHint, minutes } = req.body as {
    name?: string;
    locationHint?: string;
    minutes?: number;
  };

  if (!name || !String(name).trim()) {
    res.status(400).json({ ok: false, error: "name is required" });
    return;
  }

  const { raw, prefix, hash } = generateKey();
  const expiresAt = minutes
    ? new Date(Date.now() + Math.min(43200, Math.max(1, Number(minutes))) * 60 * 1000)
    : undefined;

  const doc = await GateApiKeyModel.create({
    tenantId,
    name: String(name).trim(),
    keyPrefix: prefix,
    keyHash: hash,
    createdByUserId: auth.id,
    locationHint: locationHint ? String(locationHint).trim() : undefined,
    expiresAt,
  });

  res.status(201).json({
    ok: true,
    // The raw key is only returned here — it cannot be recovered
    key: raw,
    keyPrefix: prefix,
    keyDoc: {
      _id: doc._id,
      name: doc.name,
      keyPrefix: doc.keyPrefix,
      locationHint: doc.locationHint,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    },
  });
});

/** Revoke a gate API key immediately */
router.delete("/gate-keys/:id", requireAuth, requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid key ID" });
    return;
  }

  const doc = await GateApiKeyModel.findOneAndUpdate(
    { _id: id, tenantId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Key not found or already revoked" });
    return;
  }

  res.json({ ok: true, revoked: { _id: doc._id, name: doc.name, revokedAt: doc.revokedAt } });
});

export default router;
