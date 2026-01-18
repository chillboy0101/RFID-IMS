import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { ReorderRequestModel, reorderStatuses, type ReorderStatus } from "../models/ReorderRequest.js";
import { VendorModel } from "../models/Vendor.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /reorders",
      create: "POST /reorders (manager/admin)",
      setStatus: "PATCH /reorders/:id/status (manager/admin)",
      autoCreateLowStock: "POST /reorders/auto (manager/admin)",
      meta: "GET /reorders/meta",
    },
  });
});

router.get("/", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const filter: Record<string, unknown> = {};
  if (status) {
    if (!reorderStatuses.includes(status as ReorderStatus)) {
      res.status(400).json({ ok: false, error: "Invalid status" });
      return;
    }
    filter.status = status;
  }

  const reorders = await ReorderRequestModel.find({ tenantId, ...filter }).sort({ createdAt: -1 }).limit(200).exec();
  res.json({ ok: true, reorders });
});

router.post("/", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { itemId, vendorId, requestedQuantity, note } = req.body as {
    itemId?: string;
    vendorId?: string;
    requestedQuantity?: number;
    note?: string;
  };

  if (!itemId || !mongoose.isValidObjectId(itemId)) {
    res.status(400).json({ ok: false, error: "Invalid itemId" });
    return;
  }

  if (vendorId && !mongoose.isValidObjectId(vendorId)) {
    res.status(400).json({ ok: false, error: "Invalid vendorId" });
    return;
  }

  if (typeof requestedQuantity !== "number" || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    res.status(400).json({ ok: false, error: "Invalid requestedQuantity" });
    return;
  }

  const item = await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec();
  if (!item) {
    res.status(404).json({ ok: false, error: "Item not found" });
    return;
  }

  if (vendorId) {
    const vendor = await VendorModel.findOne({ _id: vendorId, tenantId }).select({ _id: 1 }).exec();
    if (!vendor) {
      res.status(400).json({ ok: false, error: "Invalid vendorId" });
      return;
    }
  }

  const reorder = await ReorderRequestModel.create({
    tenantId,
    itemId,
    vendorId,
    requestedQuantity,
    note,
    requestedByUserId: auth.id,
  });

  res.status(201).json({ ok: true, reorder });
});

router.post("/auto", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { defaultRequestedQuantity } = req.body as { defaultRequestedQuantity?: number };
  const qty = typeof defaultRequestedQuantity === "number" && defaultRequestedQuantity > 0 ? defaultRequestedQuantity : 10;

  const lowStockItems = await InventoryItemModel.find({ tenantId, $expr: { $lte: ["$quantity", "$reorderLevel"] } }).limit(200).exec();

  let created = 0;
  for (const item of lowStockItems) {
    const existing = await ReorderRequestModel.findOne({ tenantId, itemId: item._id, status: { $in: ["requested", "ordered"] } }).exec();
    if (existing) continue;

    await ReorderRequestModel.create({
      tenantId,
      itemId: item._id,
      vendorId: item.vendorId,
      requestedQuantity: qty,
      requestedByUserId: auth.id,
      note: "Auto reorder (low stock)",
    });

    created += 1;
  }

  res.json({ ok: true, created, scanned: lowStockItems.length });
});

router.patch("/:id/status", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const { status } = req.body as { status?: ReorderStatus };
  if (!status || !reorderStatuses.includes(status)) {
    res.status(400).json({ ok: false, error: "Invalid status" });
    return;
  }

  const reorder = await ReorderRequestModel.findOneAndUpdate({ _id: id, tenantId }, { status }, { new: true }).exec();
  if (!reorder) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, reorder });
});

export default router;
