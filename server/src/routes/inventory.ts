import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { VendorModel } from "../models/Vendor.js";
import { getPagination } from "../utils/pagination.js";
import { asEnum, asNumber, asObjectId, asString, asDateFromString } from "../utils/validate.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /inventory/items",
      create: "POST /inventory/items",
      get: "GET /inventory/items/:id",
      update: "PATCH /inventory/items/:id",
      delete: "DELETE /inventory/items/:id (manager/admin)",
      adjust: "POST /inventory/items/:id/adjust",
      logs: "GET /inventory/items/:id/logs",
    },
  });
});

router.get("/items", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const q = (req.query.q as string | undefined)?.trim();
  const { page, limit, skip } = getPagination(req.query as Record<string, unknown>, { defaultLimit: 200, maxLimit: 500 });

  const filter: Record<string, unknown> = {};
  if (q) {
    if (q.length > 120) {
      res.status(400).json({ ok: false, error: "q is too long" });
      return;
    }
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { sku: { $regex: q, $options: "i" } },
      { barcode: { $regex: q, $options: "i" } },
      { location: { $regex: q, $options: "i" } },
      { rfidTagId: { $regex: q, $options: "i" } },
    ];
  }

  const docs = await InventoryItemModel.find({ tenantId, ...filter })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit + 1)
    .exec();

  const hasMore = docs.length > limit;
  const items = (hasMore ? docs.slice(0, limit) : docs);

  res.json({ ok: true, items, page, limit, hasMore });
});

router.get("/lookup", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const barcode = (req.query.barcode as string | undefined)?.trim();
  if (!barcode) {
    res.status(400).json({ ok: false, error: "barcode is required" });
    return;
  }
  if (barcode.length > 120) {
    res.status(400).json({ ok: false, error: "barcode is too long" });
    return;
  }

  const item = await InventoryItemModel.findOne({ tenantId, barcode }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, item });
});

router.post("/items", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const nameR = asString(body.name, { field: "name", required: true, trim: true, maxLen: 120 });
  if (!nameR.ok) {
    res.status(400).json({ ok: false, error: nameR.error });
    return;
  }
  const skuR = asString(body.sku, { field: "sku", required: true, trim: true, maxLen: 80 });
  if (!skuR.ok) {
    res.status(400).json({ ok: false, error: skuR.error });
    return;
  }
  const descriptionR = asString(body.description, { field: "description", trim: true, maxLen: 800 });
  if (!descriptionR.ok) {
    res.status(400).json({ ok: false, error: descriptionR.error });
    return;
  }
  const locationR = asString(body.location, { field: "location", trim: true, maxLen: 120 });
  if (!locationR.ok) {
    res.status(400).json({ ok: false, error: locationR.error });
    return;
  }
  const quantityR = asNumber(body.quantity, { field: "quantity", required: true, integer: true, min: 0 });
  if (!quantityR.ok) {
    res.status(400).json({ ok: false, error: quantityR.error });
    return;
  }
  const reorderLevelR = asNumber(body.reorderLevel, { field: "reorderLevel", integer: true, min: 0 });
  if (!reorderLevelR.ok) {
    res.status(400).json({ ok: false, error: reorderLevelR.error });
    return;
  }
  const expiryDateR = asDateFromString(body.expiryDate, { field: "expiryDate" });
  if (!expiryDateR.ok) {
    res.status(400).json({ ok: false, error: expiryDateR.error });
    return;
  }
  const barcodeR = asString(body.barcode, { field: "barcode", trim: true, maxLen: 120 });
  if (!barcodeR.ok) {
    res.status(400).json({ ok: false, error: barcodeR.error });
    return;
  }
  const rfidTagIdR = asString(body.rfidTagId, { field: "rfidTagId", trim: true, maxLen: 120 });
  if (!rfidTagIdR.ok) {
    res.status(400).json({ ok: false, error: rfidTagIdR.error });
    return;
  }
  const vendorIdR = asObjectId(body.vendorId, { field: "vendorId" });
  if (!vendorIdR.ok) {
    res.status(400).json({ ok: false, error: vendorIdR.error });
    return;
  }
  const statusR = asString(body.status, { field: "status", trim: true, maxLen: 40 });
  if (!statusR.ok) {
    res.status(400).json({ ok: false, error: statusR.error });
    return;
  }

  const vendorId = vendorIdR.value;
  if (vendorId) {
    const vendor = await VendorModel.findOne({ _id: vendorId, tenantId }).select({ _id: 1 }).exec();
    if (!vendor) {
      res.status(400).json({ ok: false, error: "Invalid vendorId" });
      return;
    }
  }

  const item = await InventoryItemModel.create({
    tenantId,
    name: nameR.value,
    sku: skuR.value,
    barcode: barcodeR.value,
    description: descriptionR.value,
    location: locationR.value,
    quantity: quantityR.value,
    reorderLevel: reorderLevelR.value,
    expiryDate: expiryDateR.value,
    rfidTagId: rfidTagIdR.value,
    vendorId,
    status: statusR.value,
  });

  await InventoryLogModel.create({
    tenantId,
    itemId: item._id,
    action: "create",
    actorUserId: req.auth?.id,
    newQuantity: item.quantity,
  });

  res.status(201).json({ ok: true, item });
});

router.get("/items/:id", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const item = await InventoryItemModel.findOne({ _id: id, tenantId }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, item });
});

router.patch("/items/:id", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "tenantId")) {
    res.status(400).json({ ok: false, error: "tenantId cannot be updated" });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const r = asString(body.name, { field: "name", trim: true, maxLen: 120 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.name = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "sku")) {
    const r = asString(body.sku, { field: "sku", trim: true, maxLen: 80 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.sku = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    const r = asString(body.description, { field: "description", trim: true, maxLen: 800 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.description = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "barcode")) {
    const r = asString(body.barcode, { field: "barcode", trim: true, maxLen: 120 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.barcode = typeof r.value === "string" && r.value.length === 0 ? undefined : r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "location")) {
    const r = asString(body.location, { field: "location", trim: true, maxLen: 120 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.location = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "quantity")) {
    const r = asNumber(body.quantity, { field: "quantity", integer: true, min: 0 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.quantity = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "reorderLevel")) {
    const r = asNumber(body.reorderLevel, { field: "reorderLevel", integer: true, min: 0 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.reorderLevel = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "expiryDate")) {
    const r = asDateFromString(body.expiryDate, { field: "expiryDate" });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.expiryDate = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "rfidTagId")) {
    const r = asString(body.rfidTagId, { field: "rfidTagId", trim: true, maxLen: 120 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.rfidTagId = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "vendorId")) {
    const r = asObjectId(body.vendorId, { field: "vendorId" });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    if (r.value) {
      const vendor = await VendorModel.findOne({ _id: r.value, tenantId }).select({ _id: 1 }).exec();
      if (!vendor) {
        res.status(400).json({ ok: false, error: "Invalid vendorId" });
        return;
      }
    }
    updates.vendorId = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const r = asString(body.status, { field: "status", trim: true, maxLen: 40 });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    updates.status = typeof r.value === "string" && r.value.length === 0 ? undefined : r.value;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ ok: false, error: "No valid fields to update" });
    return;
  }

  const item = await InventoryItemModel.findOneAndUpdate({ _id: id, tenantId }, updates, { new: true }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  await InventoryLogModel.create({
    tenantId,
    itemId: item._id,
    action: "update",
    actorUserId: req.auth?.id,
    newQuantity: item.quantity,
    meta: { updatedFields: Object.keys(updates) },
  });

  res.json({ ok: true, item });
});

router.delete("/items/:id", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const item = await InventoryItemModel.findOneAndDelete({ _id: id, tenantId }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  await InventoryLogModel.create({
    tenantId,
    itemId: item._id,
    action: "delete",
    actorUserId: req.auth?.id,
    previousQuantity: item.quantity,
  });

  res.json({ ok: true });
});

router.post("/items/:id/adjust", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const deltaR = asNumber(body.delta, { field: "delta", required: true, integer: true });
  if (!deltaR.ok) {
    res.status(400).json({ ok: false, error: deltaR.error });
    return;
  }
  const delta = deltaR.value;
  if (delta === 0) {
    res.status(400).json({ ok: false, error: "delta must be non-zero" });
    return;
  }

  const reasonR = asString(body.reason, { field: "reason", trim: true, maxLen: 200 });
  if (!reasonR.ok) {
    res.status(400).json({ ok: false, error: reasonR.error });
    return;
  }
  const actionR = asEnum(body.action, ["add", "remove", "adjust"] as const, { field: "action" });
  if (!actionR.ok) {
    res.status(400).json({ ok: false, error: actionR.error });
    return;
  }

  const item = await InventoryItemModel.findOne({ _id: id, tenantId }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  const previousQuantity = item.quantity;
  const newQuantity = previousQuantity + delta;
  if (newQuantity < 0) {
    res.status(400).json({ ok: false, error: "Quantity cannot go below 0" });
    return;
  }

  item.quantity = newQuantity;
  await item.save();

  const logAction = actionR.value ?? (delta > 0 ? "add" : "remove");
  await InventoryLogModel.create({
    tenantId,
    itemId: item._id,
    action: logAction,
    delta,
    previousQuantity,
    newQuantity,
    reason: reasonR.value,
    actorUserId: req.auth?.id,
  });

  res.json({ ok: true, item });
});

router.get("/items/:id/logs", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { id } = req.params;
  const { page, limit, skip } = getPagination(req.query as Record<string, unknown>, { defaultLimit: 200, maxLimit: 500 });
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const docs = await InventoryLogModel.find({ tenantId, itemId: id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit + 1)
    .exec();

  const hasMore = docs.length > limit;
  const logs = (hasMore ? docs.slice(0, limit) : docs);

  res.json({ ok: true, logs, page, limit, hasMore });
});

export default router;
