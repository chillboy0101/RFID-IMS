import express from "express";

import { requireAuth } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { OrderModel } from "../models/Order.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/summary", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const daysRaw = (req.query.expiryDays as string | undefined) ?? "30";
  const expiryDays = Math.min(365, Math.max(1, Number(daysRaw) || 30));

  const now = new Date();
  const expiryBefore = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

  const [
    totalItems,
    lowStockCount,
    expiringSoonCount,
    openOrdersCount,
    recentOrders,
  ] = await Promise.all([
    InventoryItemModel.countDocuments({ tenantId }).exec(),
    InventoryItemModel.countDocuments({ tenantId, $expr: { $lte: ["$quantity", "$reorderLevel"] } }).exec(),
    InventoryItemModel.countDocuments({ tenantId, expiryDate: { $ne: null, $lte: expiryBefore } }).exec(),
    OrderModel.countDocuments({ tenantId, status: { $in: ["created", "picking"] } }).exec(),
    OrderModel.find({ tenantId }).sort({ createdAt: -1 }).limit(10).exec(),
  ]);

  res.json({
    ok: true,
    inventory: {
      totalItems,
      lowStockCount,
      expiringSoonCount,
      expiryDays,
    },
    orders: {
      openOrdersCount,
      recent: recentOrders,
    },
  });
});

export default router;
