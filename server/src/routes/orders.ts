import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { OrderModel, orderStatuses, type OrderStatus } from "../models/Order.js";
import {
  authorizeOrderExit,
  buildOrderWorkflowSummary,
  releaseUnitsForOrder,
  reserveUnitsForOrder,
  revokeOrderExitAuthorizations,
} from "../utils/orderFulfillment.js";
import { getPagination } from "../utils/pagination.js";
import { asEnum, asNumber, asObjectId, asString } from "../utils/validate.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

async function restoreAdjustedStock(tenantId: string, req: TenantRequest, orderId: string) {
  const order = await OrderModel.findOne({ _id: orderId, tenantId }).exec();
  if (!order || !order.stockAdjusted) return;

  const itemIds = order.items.map((line) => line.itemId);
  const items = await InventoryItemModel.find({ tenantId, _id: { $in: itemIds } }).exec();
  const itemsById = new Map(items.map((item) => [item._id.toString(), item]));

  for (const line of order.items) {
    const item = itemsById.get(line.itemId.toString());
    if (!item) continue;

    const previousQuantity = item.quantity;
    item.quantity = previousQuantity + line.quantity;
    await item.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: item._id,
      action: "add",
      delta: line.quantity,
      previousQuantity,
      newQuantity: item.quantity,
      reason: "Order cancelled",
      actorUserId: req.auth?.id,
      meta: { orderId },
    });
  }

  order.stockAdjusted = false;
  order.stockRestoredAt = new Date();
  await order.save();
}

router.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /orders",
      create: "POST /orders",
      get: "GET /orders/:id",
      updateStatus: "PATCH /orders/:id/status (manager/admin)",
      authorizeExit: "POST /orders/:id/authorize-exit (manager/admin)",
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
  const orders = hasMore ? docs.slice(0, limit) : docs;
  const workflows = await Promise.all(orders.map((order) => buildOrderWorkflowSummary(tenantId, order)));

  res.json({
    ok: true,
    orders: orders.map((order, index) => ({
      ...order.toObject(),
      workflow: workflows[index],
    })),
    page,
    limit,
    hasMore,
  });
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

  const itemDocs = await InventoryItemModel.find({ tenantId, _id: { $in: items.map((item) => item.itemId) } }).exec();
  if (itemDocs.length !== items.length) {
    res.status(400).json({ ok: false, error: "One or more items not found" });
    return;
  }

  const itemById = new Map(itemDocs.map((doc) => [doc._id.toString(), doc]));

  const order = await OrderModel.create({
    tenantId,
    status: "created",
    notes: notesR.value,
    createdByUserId: auth.id,
    items: items.map((line) => {
      const doc = itemById.get(line.itemId);
      return {
        itemId: line.itemId,
        quantity: line.quantity,
        skuSnapshot: doc?.sku,
        nameSnapshot: doc?.name,
      };
    }),
  });

  res.status(201).json({ ok: true, order, workflow: await buildOrderWorkflowSummary(tenantId, order) });
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

  res.json({ ok: true, order, workflow: await buildOrderWorkflowSummary(tenantId, order) });
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
  if (status === "authorized") {
    res.status(400).json({ ok: false, error: "Use authorize-exit for RFID pickup authorization" });
    return;
  }

  const order = await OrderModel.findOne({ _id: id, tenantId }).exec();
  if (!order) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  if ((order.status === "fulfilled" || order.status === "cancelled") && status !== order.status) {
    res.status(409).json({ ok: false, error: "Order is already closed" });
    return;
  }

  if (status === "picking") {
    try {
      await reserveUnitsForOrder(tenantId, order);
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Failed to reserve units" });
      return;
    }

    order.status = "picking";
    order.pickedAt = order.pickedAt ?? new Date();
    await order.save();
    res.json({ ok: true, order, workflow: await buildOrderWorkflowSummary(tenantId, order) });
    return;
  }

  if (status === "fulfilled") {
    const workflow = await buildOrderWorkflowSummary(tenantId, order);
    if (workflow.dispatchedUnits < workflow.requestedUnits) {
      res.status(409).json({ ok: false, error: "RFID exit must complete before the order can be fulfilled" });
      return;
    }
    order.status = "fulfilled";
    order.fulfilledAt = order.fulfilledAt ?? new Date();
    await order.save();
    res.json({ ok: true, order, workflow });
    return;
  }

  if (status === "cancelled") {
    const workflow = await buildOrderWorkflowSummary(tenantId, order);
    if (workflow.dispatchedUnits > 0) {
      res.status(409).json({ ok: false, error: "Cannot cancel an order after items have exited the gate" });
      return;
    }

    await revokeOrderExitAuthorizations(tenantId, order._id.toString());
    await releaseUnitsForOrder(tenantId, order._id.toString());
    await restoreAdjustedStock(tenantId, req, order._id.toString());

    order.status = "cancelled";
    await order.save();
    res.json({ ok: true, order, workflow: await buildOrderWorkflowSummary(tenantId, order) });
    return;
  }

  order.status = status;
  await order.save();
  res.json({ ok: true, order, workflow: await buildOrderWorkflowSummary(tenantId, order) });
});

router.post("/:id/authorize-exit", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const locationR = asString(body.location, { field: "location", trim: true, maxLen: 80 });
  if (!locationR.ok) {
    res.status(400).json({ ok: false, error: locationR.error });
    return;
  }
  const minutesR = asNumber(body.minutes, { field: "minutes", integer: true, min: 1, max: 60 });
  if (!minutesR.ok) {
    res.status(400).json({ ok: false, error: minutesR.error });
    return;
  }

  const location = locationR.value?.trim() || "EXIT_MAIN";
  const minutes = minutesR.value ?? 15;

  const order = await OrderModel.findOne({ _id: id, tenantId }).exec();
  if (!order) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  try {
    const { expiresAt, workflow } = await authorizeOrderExit({
      tenantId,
      order,
      actorUserId: auth.id,
      location,
      minutes,
    });

    res.json({
      ok: true,
      order,
      workflow,
      authorization: {
        location,
        expiresAt,
      },
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Failed to authorize exit" });
  }
});

export default router;
