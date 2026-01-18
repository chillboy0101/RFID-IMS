import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { OrderModel, orderStatuses, type OrderStatus } from "../models/Order.js";
import { getPagination } from "../utils/pagination.js";
import { asEnum, asNumber, asObjectId, asString } from "../utils/validate.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /orders",
      create: "POST /orders",
      get: "GET /orders/:id",
      updateStatus: "PATCH /orders/:id/status (manager/admin)",
      meta: "GET /orders/meta",
    },
  });
});

router.get("/", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const { page, limit, skip } = getPagination(req.query as Record<string, unknown>, { defaultLimit: 200, maxLimit: 500 });

  const filter: Record<string, unknown> = {};
  if (status) {
    if (!orderStatuses.includes(status as OrderStatus)) {
      res.status(400).json({ ok: false, error: "Invalid status" });
      return;
    }
    filter.status = status;
  }

  const docs = await OrderModel.find({ tenantId, ...filter })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit + 1)
    .exec();

  const hasMore = docs.length > limit;
  const orders = (hasMore ? docs.slice(0, limit) : docs);

  res.json({ ok: true, orders, page, limit, hasMore });
});

router.post("/", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const notesR = asString(body.notes, { field: "notes", trim: true, maxLen: 1000 });
  if (!notesR.ok) {
    res.status(400).json({ ok: false, error: notesR.error });
    return;
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    res.status(400).json({ ok: false, error: "items is required" });
    return;
  }

  const items: Array<{ itemId: string; quantity: number }> = [];
  for (const raw of rawItems) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const itemIdR = asObjectId(it.itemId, { field: "itemId", required: true });
    if (!itemIdR.ok) {
      res.status(400).json({ ok: false, error: itemIdR.error });
      return;
    }
    const qtyR = asNumber(it.quantity, { field: "quantity", required: true, integer: true, min: 1 });
    if (!qtyR.ok) {
      res.status(400).json({ ok: false, error: qtyR.error });
      return;
    }
    items.push({ itemId: itemIdR.value, quantity: qtyR.value });
  }

  const itemDocs = await InventoryItemModel.find({ tenantId, _id: { $in: items.map((i) => i.itemId) } }).exec();
  if (itemDocs.length !== items.length) {
    res.status(400).json({ ok: false, error: "One or more items not found" });
    return;
  }

  const itemById = new Map(itemDocs.map((d) => [d._id.toString(), d]));

  const order = await OrderModel.create({
    tenantId,
    status: "created",
    notes: notesR.value,
    createdByUserId: auth.id,
    items: items.map((i) => {
      const doc = itemById.get(i.itemId as string);
      return {
        itemId: i.itemId,
        quantity: i.quantity,
        skuSnapshot: doc?.sku,
        nameSnapshot: doc?.name,
      };
    }),
  });

  res.status(201).json({ ok: true, order });
});

router.get("/:id", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const order = await OrderModel.findOne({ _id: id, tenantId }).exec();
  if (!order) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, order });
});

router.patch("/:id/status", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const statusR = asEnum(body.status, orderStatuses, { field: "status", required: true });
  if (!statusR.ok) {
    res.status(400).json({ ok: false, error: statusR.error });
    return;
  }
  const status = statusR.value as OrderStatus;

  const order = await OrderModel.findOne({ _id: id, tenantId }).exec();
  if (!order) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  const orderDoc = order;

  if (orderDoc.status === "fulfilled" || orderDoc.status === "cancelled") {
    res.status(409).json({ ok: false, error: "Order is already closed" });
    return;
  }

  async function applyStockRemoval(reason: string) {
    const itemIds = orderDoc.items.map((i) => i.itemId);
    const invItems = await InventoryItemModel.find({ tenantId, _id: { $in: itemIds } }).exec();
    const invById = new Map(invItems.map((d) => [d._id.toString(), d]));

    for (const line of orderDoc.items) {
      const inv = invById.get(line.itemId.toString());
      if (!inv) {
        res.status(409).json({ ok: false, error: "Inventory item missing for stock update" });
        return false;
      }
      if (inv.quantity - line.quantity < 0) {
        res.status(409).json({ ok: false, error: `Insufficient stock for ${inv.sku}` });
        return false;
      }
    }

    for (const line of orderDoc.items) {
      const inv = invById.get(line.itemId.toString());
      if (!inv) continue;

      const previousQuantity = inv.quantity;
      const newQuantity = previousQuantity - line.quantity;
      inv.quantity = newQuantity;
      await inv.save();

      await InventoryLogModel.create({
        tenantId,
        itemId: inv._id,
        action: "remove",
        delta: -line.quantity,
        previousQuantity,
        newQuantity,
        reason,
        actorUserId: req.auth?.id,
        meta: { orderId: orderDoc._id.toString(), status },
      });
    }

    orderDoc.stockAdjusted = true;
    orderDoc.stockAdjustedAt = new Date();
    return true;
  }

  async function restoreStock(reason: string) {
    const itemIds = orderDoc.items.map((i) => i.itemId);
    const invItems = await InventoryItemModel.find({ tenantId, _id: { $in: itemIds } }).exec();
    const invById = new Map(invItems.map((d) => [d._id.toString(), d]));

    for (const line of orderDoc.items) {
      const inv = invById.get(line.itemId.toString());
      if (!inv) continue;

      const previousQuantity = inv.quantity;
      const newQuantity = previousQuantity + line.quantity;
      inv.quantity = newQuantity;
      await inv.save();

      await InventoryLogModel.create({
        tenantId,
        itemId: inv._id,
        action: "add",
        delta: line.quantity,
        previousQuantity,
        newQuantity,
        reason,
        actorUserId: req.auth?.id,
        meta: { orderId: orderDoc._id.toString(), status },
      });
    }

    orderDoc.stockAdjusted = false;
    orderDoc.stockRestoredAt = new Date();
  }

  if (status === "picking") {
    if (!orderDoc.stockAdjusted) {
      const ok = await applyStockRemoval("Order picking");
      if (!ok) return;
    }
  }

  if (status === "fulfilled") {
    if (!orderDoc.stockAdjusted) {
      const ok = await applyStockRemoval("Order fulfillment");
      if (!ok) return;
    }
    orderDoc.fulfilledAt = new Date();
  }

  if (status === "cancelled") {
    if (orderDoc.stockAdjusted) {
      await restoreStock("Order cancelled");
    }
  }

  orderDoc.status = status;
  await orderDoc.save();

  res.json({ ok: true, order: orderDoc });
});

export default router;
