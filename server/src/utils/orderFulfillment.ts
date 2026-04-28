import mongoose from "mongoose";

import { ExitAuthorizationModel, type ExitAuthorizationDocument } from "../models/ExitAuthorization.js";
import { InventoryItemModel, type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { InventoryUnitModel, type InventoryUnitDocument } from "../models/InventoryUnit.js";
import { OrderModel, type OrderDocument } from "../models/Order.js";

const activeUnitStatuses = ["received", "in_stock", "reserved", "picked", "packed"] as const;
const reservableUnitStatuses = ["received", "in_stock"] as const;
const orderOpenStatuses = ["created", "picking", "authorized"] as const;

export type OrderLineWorkflow = {
  itemId: string;
  name: string;
  sku: string;
  requestedQuantity: number;
  reservedUnits: number;
  taggedReservedUnits: number;
  barcodeFallbackUnits: number;
  activeAuthorizations: number;
  dispatchedUnits: number;
};

export type OrderWorkflowSummary = {
  requestedUnits: number;
  reservedUnits: number;
  taggedReservedUnits: number;
  barcodeFallbackUnits: number;
  activeAuthorizations: number;
  dispatchedUnits: number;
  lines: OrderLineWorkflow[];
};

async function ensureItemUnitCoverage(tenantId: string, item: InventoryItemDocument): Promise<void> {
  const covered = await InventoryUnitModel.countDocuments({
    tenantId,
    itemId: item._id,
    status: { $in: activeUnitStatuses },
  }).exec();

  const target = Math.max(0, item.quantity);
  if (covered >= target) return;

  const missing = target - covered;
  const docs = Array.from({ length: missing }).map(() => ({
    tenantId,
    itemId: item._id,
    location: item.location || "UNASSIGNED",
    status: "in_stock" as const,
  }));

  if (docs.length > 0) {
    await InventoryUnitModel.insertMany(docs);
  }
}

async function loadOrderItems(tenantId: string, order: OrderDocument): Promise<Map<string, InventoryItemDocument>> {
  const itemIds = order.items.map((line) => line.itemId);
  const docs = await InventoryItemModel.find({ tenantId, _id: { $in: itemIds } }).exec();
  return new Map(docs.map((doc) => [doc._id.toString(), doc]));
}

async function reserveLineUnits(
  tenantId: string,
  order: OrderDocument,
  line: OrderDocument["items"][number],
  item: InventoryItemDocument
): Promise<void> {
  await ensureItemUnitCoverage(tenantId, item);

  const reserved = await InventoryUnitModel.find({
    tenantId,
    itemId: line.itemId,
    orderId: order._id,
    status: { $in: ["reserved", "picked", "packed", "dispatched"] },
  }).exec();

  if (reserved.length >= line.quantity) return;

  const needed = line.quantity - reserved.length;
  const candidates = await InventoryUnitModel.find({
    tenantId,
    itemId: line.itemId,
    $or: [{ orderId: { $exists: false } }, { orderId: null }],
    status: { $in: reservableUnitStatuses },
  }).exec();

  const selected = candidates
    .sort((a, b) => {
      const tagA = a.tagId ? 1 : 0;
      const tagB = b.tagId ? 1 : 0;
      if (tagA !== tagB) return tagB - tagA;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, needed);

  if (selected.length < needed) {
    throw new Error(`Insufficient unit coverage for ${item.sku}`);
  }

  const now = new Date();
  for (const unit of selected) {
    unit.orderId = order._id;
    unit.status = "reserved";
    unit.reservedAt = now;
    await unit.save();
  }
}

export async function reserveUnitsForOrder(tenantId: string, order: OrderDocument): Promise<void> {
  const itemsById = await loadOrderItems(tenantId, order);

  for (const line of order.items) {
    const item = itemsById.get(line.itemId.toString());
    if (!item) {
      throw new Error("Inventory item missing for order reservation");
    }
    await reserveLineUnits(tenantId, order, line, item);
  }
}

export async function releaseUnitsForOrder(tenantId: string, orderId: string): Promise<void> {
  const units = await InventoryUnitModel.find({
    tenantId,
    orderId,
    status: { $in: ["reserved", "picked", "packed"] },
  }).exec();

  for (const unit of units) {
    unit.orderId = undefined;
    unit.reservedAt = undefined;
    unit.authorizedAt = undefined;
    unit.status = unit.tagId ? "in_stock" : "received";
    await unit.save();
  }
}

export async function revokeOrderExitAuthorizations(tenantId: string, orderId: string): Promise<void> {
  await ExitAuthorizationModel.updateMany(
    { tenantId, orderId, status: "active" },
    { $set: { status: "revoked" } }
  ).exec();
}

export async function buildOrderWorkflowSummary(tenantId: string, order: OrderDocument): Promise<OrderWorkflowSummary> {
  const itemsById = await loadOrderItems(tenantId, order);
  const itemIds = order.items.map((line) => line.itemId);

  const [units, authorizations] = await Promise.all([
    InventoryUnitModel.find({
      tenantId,
      itemId: { $in: itemIds },
      orderId: order._id,
    }).exec(),
    ExitAuthorizationModel.find({
      tenantId,
      orderId: order._id,
      status: { $in: ["active", "used"] },
    }).exec(),
  ]);

  const unitsByItem = new Map<string, InventoryUnitDocument[]>();
  for (const unit of units) {
    const key = unit.itemId.toString();
    const bucket = unitsByItem.get(key) ?? [];
    bucket.push(unit);
    unitsByItem.set(key, bucket);
  }

  const authsByItem = new Map<string, ExitAuthorizationDocument[]>();
  for (const auth of authorizations) {
    let itemId = "";
    if (auth.unitId) {
      const unit = units.find((candidate) => candidate._id.equals(auth.unitId));
      itemId = unit?.itemId.toString() ?? "";
    }
    if (!itemId) {
      const item = Array.from(itemsById.values()).find((candidate) => {
        if (auth.tagId) return candidate.rfidTagId === auth.tagId;
        if (auth.barcode) return candidate.barcode === auth.barcode;
        return false;
      });
      itemId = item?._id.toString() ?? "";
    }
    if (!itemId) continue;
    const bucket = authsByItem.get(itemId) ?? [];
    bucket.push(auth);
    authsByItem.set(itemId, bucket);
  }

  const lines = order.items.map((line) => {
    const itemId = line.itemId.toString();
    const item = itemsById.get(itemId);
    const lineUnits = unitsByItem.get(itemId) ?? [];
    const lineAuths = authsByItem.get(itemId) ?? [];
    const reservedUnits = lineUnits.filter((unit) => unit.status !== "dispatched").length;
    const taggedReservedUnits = lineUnits.filter((unit) => unit.status !== "dispatched" && !!unit.tagId).length;
    const barcodeFallbackUnits = lineUnits.filter((unit) => unit.status !== "dispatched" && !unit.tagId && !!item?.barcode).length;
    const activeAuthorizations = lineAuths.filter((auth) => auth.status === "active").length;
    const dispatchedUnits = lineUnits.filter((unit) => unit.status === "dispatched").length;

    return {
      itemId,
      name: line.nameSnapshot ?? item?.name ?? itemId,
      sku: line.skuSnapshot ?? item?.sku ?? "-",
      requestedQuantity: line.quantity,
      reservedUnits,
      taggedReservedUnits,
      barcodeFallbackUnits,
      activeAuthorizations,
      dispatchedUnits,
    };
  });

  return {
    requestedUnits: lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
    reservedUnits: lines.reduce((sum, line) => sum + line.reservedUnits, 0),
    taggedReservedUnits: lines.reduce((sum, line) => sum + line.taggedReservedUnits, 0),
    barcodeFallbackUnits: lines.reduce((sum, line) => sum + line.barcodeFallbackUnits, 0),
    activeAuthorizations: lines.reduce((sum, line) => sum + line.activeAuthorizations, 0),
    dispatchedUnits: lines.reduce((sum, line) => sum + line.dispatchedUnits, 0),
    lines,
  };
}

export async function authorizeOrderExit(opts: {
  tenantId: string;
  order: OrderDocument;
  actorUserId: string;
  location: string;
  minutes: number;
}): Promise<{ expiresAt: Date; workflow: OrderWorkflowSummary }> {
  const { tenantId, order, actorUserId, location, minutes } = opts;

  if (!orderOpenStatuses.includes(order.status as (typeof orderOpenStatuses)[number])) {
    throw new Error("Order is already closed");
  }

  await reserveUnitsForOrder(tenantId, order);

  const itemsById = await loadOrderItems(tenantId, order);
  const units = await InventoryUnitModel.find({
    tenantId,
    orderId: order._id,
    status: { $in: ["reserved", "picked", "packed"] },
  }).exec();

  const unitsByItem = new Map<string, InventoryUnitDocument[]>();
  for (const unit of units) {
    const key = unit.itemId.toString();
    const bucket = unitsByItem.get(key) ?? [];
    bucket.push(unit);
    unitsByItem.set(key, bucket);
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const docsToInsert: Array<Record<string, unknown>> = [];

  for (const line of order.items) {
    const itemId = line.itemId.toString();
    const item = itemsById.get(itemId);
    if (!item) {
      throw new Error("Inventory item missing for order authorization");
    }

    const lineUnits = (unitsByItem.get(itemId) ?? [])
      .sort((a, b) => {
        const tagA = a.tagId ? 1 : 0;
        const tagB = b.tagId ? 1 : 0;
        if (tagA !== tagB) return tagB - tagA;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })
      .slice(0, line.quantity);

    if (lineUnits.length < line.quantity) {
      throw new Error(`Not enough reserved units for ${item.sku}`);
    }

    for (const unit of lineUnits) {
      if (!unit.tagId && !item.barcode) {
        throw new Error(`${item.sku} cannot be authorized until it has an RFID tag or barcode`);
      }

      unit.status = "picked";
      unit.authorizedAt = now;
      await unit.save();

      docsToInsert.push({
        tenantId,
        tagId: unit.tagId || undefined,
        barcode: unit.tagId ? undefined : item.barcode,
        location,
        status: "active",
        orderId: order._id,
        unitId: unit._id,
        createdByUserId: actorUserId,
        expiresAt,
      });
    }
  }

  await revokeOrderExitAuthorizations(tenantId, order._id.toString());

  if (docsToInsert.length > 0) {
    await ExitAuthorizationModel.insertMany(docsToInsert);
  }

  order.status = "authorized";
  order.authorizedAt = now;
  order.authorizedByUserId = new mongoose.Types.ObjectId(actorUserId);
  order.authorizationLocation = location;
  order.authorizationExpiresAt = expiresAt;
  if (!order.pickedAt) {
    order.pickedAt = now;
  }
  await order.save();

  return {
    expiresAt,
    workflow: await buildOrderWorkflowSummary(tenantId, order),
  };
}

async function updateOrderAfterExit(order: OrderDocument, when: Date): Promise<void> {
  const remaining = await ExitAuthorizationModel.countDocuments({
    tenantId: order.tenantId,
    orderId: order._id,
    status: "active",
  }).exec();

  order.lastExitScanAt = when;
  if (remaining === 0) {
    order.status = "fulfilled";
    order.fulfilledAt = when;
  } else if (order.status !== "authorized") {
    order.status = "authorized";
  }
  await order.save();
}

export async function consumeExitAuthorization(opts: {
  tenantId: string;
  authorization: ExitAuthorizationDocument;
  fallbackItem?: InventoryItemDocument | null;
  actorUserId?: string;
  source: string;
  when?: Date;
}): Promise<{
  item: InventoryItemDocument | null;
  order: OrderDocument | null;
  remainingAuthorizations: number;
}> {
  const { tenantId, authorization, fallbackItem, actorUserId, source } = opts;
  const when = opts.when ?? new Date();

  const unit = authorization.unitId
    ? await InventoryUnitModel.findOne({ _id: authorization.unitId, tenantId }).exec()
    : null;

  let item =
    (unit ? await InventoryItemModel.findOne({ _id: unit.itemId, tenantId }).exec() : null) ??
    fallbackItem ??
    null;

  if (!item) {
    if (authorization.tagId) {
      item = await InventoryItemModel.findOne({ tenantId, rfidTagId: authorization.tagId }).exec();
    } else if (authorization.barcode) {
      item = await InventoryItemModel.findOne({ tenantId, barcode: authorization.barcode }).exec();
    }
  }

  const order = authorization.orderId
    ? await OrderModel.findOne({ _id: authorization.orderId, tenantId }).exec()
    : null;

  authorization.status = "used";
  authorization.usedAt = when;
  authorization.usedSource = source;
  authorization.lastSeenAt = when;
  authorization.lastSeenSource = source;
  await authorization.save();

  if (unit && unit.status !== "dispatched") {
    unit.status = "dispatched";
    unit.dispatchedAt = when;
    await unit.save();
  }

  const shouldAdjustStock = !order || !order.stockAdjusted;
  if (item && shouldAdjustStock && item.quantity > 0) {
    const previousQuantity = item.quantity;
    item.quantity = Math.max(0, item.quantity - 1);
    await item.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: item._id,
      action: "remove",
      delta: -1,
      previousQuantity,
      newQuantity: item.quantity,
      reason: "RFID exit verification",
      actorUserId,
      meta: {
        orderId: order?._id?.toString(),
        unitId: unit?._id?.toString(),
        authorizationId: authorization._id.toString(),
        source,
      },
    });
  }

  if (order) {
    await updateOrderAfterExit(order, when);
  }

  const remainingAuthorizations = authorization.orderId
    ? await ExitAuthorizationModel.countDocuments({
        tenantId,
        orderId: authorization.orderId,
        status: "active",
      }).exec()
    : 0;

  return {
    item,
    order,
    remainingAuthorizations,
  };
}
