import express from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { OrderModel } from "../models/Order.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      stockLevels: "GET /reports/stock-levels",
      orderFulfillment: "GET /reports/order-fulfillment",
    },
  });
});

router.get("/stock-levels", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const [totalItems, lowStockItems, expiringSoonCount] = await Promise.all([
    InventoryItemModel.countDocuments({ tenantId }).exec(),
    InventoryItemModel.find({ tenantId, $expr: { $lte: ["$quantity", "$reorderLevel"] } })
      .sort({ quantity: 1 })
      .limit(200)
      .exec(),
    InventoryItemModel.countDocuments({ tenantId, expiryDate: { $ne: null } }).exec(),
  ]);

  res.json({
    ok: true,
    report: {
      totalItems,
      lowStockCount: lowStockItems.length,
      expiringItemsCount: expiringSoonCount,
      lowStockItems,
    },
  });
});

router.get("/order-fulfillment", requireRole("manager", "admin"), async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const [totalOrders, fulfilledOrders, openOrders, fulfilledDocs] = await Promise.all([
    OrderModel.countDocuments({ tenantId }).exec(),
    OrderModel.countDocuments({ tenantId, status: "fulfilled" }).exec(),
    OrderModel.countDocuments({ tenantId, status: { $in: ["created", "picking"] } }).exec(),
    OrderModel.find({ tenantId, status: "fulfilled", fulfilledAt: { $ne: null } })
      .select({ createdAt: 1, fulfilledAt: 1 })
      .limit(500)
      .exec(),
  ]);

  let totalSeconds = 0;
  let count = 0;
  for (const o of fulfilledDocs) {
    const createdAt = (o as unknown as { createdAt?: Date }).createdAt;
    const fulfilledAt = (o as unknown as { fulfilledAt?: Date }).fulfilledAt;
    if (createdAt instanceof Date && fulfilledAt instanceof Date) {
      const secs = Math.max(0, Math.floor((fulfilledAt.getTime() - createdAt.getTime()) / 1000));
      totalSeconds += secs;
      count += 1;
    }
  }

  const avgFulfillmentSeconds = count ? totalSeconds / count : null;

  res.json({
    ok: true,
    report: {
      totalOrders,
      fulfilledOrders,
      openOrders,
      avgFulfillmentSeconds,
      sampleSize: count,
    },
  });
});

export default router;
