import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { OrderModel } from "../models/Order.js";
import { ReorderRequestModel } from "../models/ReorderRequest.js";

const router = express.Router();

function csvEscape(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  const s = String(value);
  if (s.includes("\"") || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => csvEscape((r as any)?.[c])).join(","));
  return [header, ...lines].join("\n");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  row.push(field);
  rows.push(row);

  while (rows.length > 0 && rows[rows.length - 1].every((c) => String(c ?? "").trim() === "")) {
    rows.pop();
  }

  return rows;
}

router.use(requireAuth);
router.use(requireRole("admin"));
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      export: "GET /integrations/export?type=inventory|orders|logs|reorders",
      importInventory: "POST /integrations/import/inventory",
    },
  });
});

router.get("/export", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const type = (req.query.type as string | undefined)?.trim() ?? "inventory";
  const format = ((req.query.format as string | undefined) ?? "json").trim().toLowerCase();

  if (type === "inventory") {
    const items = await InventoryItemModel.find({ tenantId }).sort({ updatedAt: -1 }).limit(5000).exec();

    if (format === "csv") {
      const columns = [
        "sku",
        "name",
        "description",
        "location",
        "quantity",
        "reorderLevel",
        "expiryDate",
        "status",
        "rfidTagId",
        "vendorId",
        "_id",
        "createdAt",
        "updatedAt",
      ];
      const rows = items.map((d: any) => ({
        sku: d.sku,
        name: d.name,
        description: d.description ?? "",
        location: d.location ?? "",
        quantity: d.quantity,
        reorderLevel: typeof d.reorderLevel === "number" ? d.reorderLevel : "",
        expiryDate: d.expiryDate ? new Date(d.expiryDate).toISOString() : "",
        status: d.status ?? "",
        rfidTagId: d.rfidTagId ?? "",
        vendorId: d.vendorId ? String(d.vendorId) : "",
        _id: String(d._id),
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : "",
        updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : "",
      }));

      const csv = toCsv(rows, columns);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=export-inventory.csv`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, type, items });
    return;
  }

  if (type === "orders") {
    const orders = await OrderModel.find({ tenantId }).sort({ createdAt: -1 }).limit(5000).exec();

    if (format === "csv") {
      const columns = ["_id", "status", "items", "notes", "createdByUserId", "fulfilledAt", "createdAt", "updatedAt"];
      const rows = orders.map((o: any) => ({
        _id: String(o._id),
        status: o.status,
        items: JSON.stringify(o.items ?? []),
        notes: o.notes ?? "",
        createdByUserId: o.createdByUserId ? String(o.createdByUserId) : "",
        fulfilledAt: o.fulfilledAt ? new Date(o.fulfilledAt).toISOString() : "",
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
        updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : "",
      }));
      const csv = toCsv(rows, columns);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=export-orders.csv`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, type, orders });
    return;
  }

  if (type === "logs") {
    const logs = await InventoryLogModel.find({ tenantId }).sort({ createdAt: -1 }).limit(5000).exec();

    if (format === "csv") {
      const columns = [
        "_id",
        "itemId",
        "action",
        "delta",
        "previousQuantity",
        "newQuantity",
        "reason",
        "actorUserId",
        "createdAt",
      ];
      const rows = logs.map((l: any) => ({
        _id: String(l._id),
        itemId: l.itemId ? String(l.itemId) : "",
        action: l.action,
        delta: typeof l.delta === "number" ? l.delta : "",
        previousQuantity: typeof l.previousQuantity === "number" ? l.previousQuantity : "",
        newQuantity: typeof l.newQuantity === "number" ? l.newQuantity : "",
        reason: l.reason ?? "",
        actorUserId: l.actorUserId ? String(l.actorUserId) : "",
        createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : "",
      }));
      const csv = toCsv(rows, columns);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=export-logs.csv`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, type, logs });
    return;
  }

  if (type === "reorders") {
    const reorders = await ReorderRequestModel.find({ tenantId }).sort({ createdAt: -1 }).limit(5000).exec();

    if (format === "csv") {
      const columns = ["_id", "itemId", "vendorId", "requestedQuantity", "status", "note", "createdAt", "updatedAt"];
      const rows = reorders.map((r: any) => ({
        _id: String(r._id),
        itemId: r.itemId ? String(r.itemId) : "",
        vendorId: r.vendorId ? String(r.vendorId) : "",
        requestedQuantity: typeof r.requestedQuantity === "number" ? r.requestedQuantity : "",
        status: r.status ?? "",
        note: r.note ?? "",
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
      }));
      const csv = toCsv(rows, columns);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=export-reorders.csv`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, type, reorders });
    return;
  }

  res.status(400).json({ ok: false, error: "Invalid export type" });
});

router.get("/template", async (req, res) => {
  const type = (req.query.type as string | undefined)?.trim() ?? "inventory";
  const format = ((req.query.format as string | undefined) ?? "csv").trim().toLowerCase();

  if (type !== "inventory") {
    res.status(400).json({ ok: false, error: "Invalid template type" });
    return;
  }

  if (format !== "csv") {
    res.status(400).json({ ok: false, error: "Invalid template format" });
    return;
  }

  const columns = [
    "sku",
    "name",
    "description",
    "location",
    "quantity",
    "reorderLevel",
    "expiryDate",
    "status",
    "rfidTagId",
    "vendorId",
  ];

  const csv = toCsv([], columns);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=inventory-import-template.csv`);
  res.send(csv);
});

router.post(
  "/import/inventory/csv",
  express.text({
    type: ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"],
    limit: "5mb",
  }),
  async (req, res) => {
    const tenantId = (req as TenantRequest).tenantId as string;
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      res.status(400).json({ ok: false, error: "CSV body is required" });
      return;
    }

    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      res.status(400).json({ ok: false, error: "CSV must include a header row and at least 1 data row" });
      return;
    }

    const headers = rows[0].map((h) => String(h ?? "").trim());
    const idx = new Map(headers.map((h, i) => [h, i] as const));
    const skuIdx = idx.get("sku");
    const nameIdx = idx.get("name");
    const qtyIdx = idx.get("quantity");

    if (typeof skuIdx !== "number" || typeof nameIdx !== "number" || typeof qtyIdx !== "number") {
      res.status(400).json({ ok: false, error: "CSV header must include sku, name, quantity" });
      return;
    }

    const errors: Array<{ row: number; error: string }> = [];
    let upserted = 0;
    let scanned = 0;

    for (let r = 1; r < rows.length; r += 1) {
      scanned += 1;
      const line = rows[r];
      const sku = String(line[skuIdx] ?? "").trim();
      const name = String(line[nameIdx] ?? "").trim();
      const qtyRaw = String(line[qtyIdx] ?? "").trim();

      if (!sku || !name || !qtyRaw) {
        errors.push({ row: r + 1, error: "Missing required sku/name/quantity" });
        continue;
      }

      const quantity = Number(qtyRaw);
      if (!Number.isFinite(quantity)) {
        errors.push({ row: r + 1, error: "Invalid quantity" });
        continue;
      }

      const get = (key: string) => {
        const i = idx.get(key);
        if (typeof i !== "number") return "";
        return String(line[i] ?? "").trim();
      };

      const vendorId = get("vendorId");
      if (vendorId && !mongoose.isValidObjectId(vendorId)) {
        errors.push({ row: r + 1, error: "Invalid vendorId" });
        continue;
      }

      const expiryDate = get("expiryDate");
      const expiry = expiryDate ? new Date(expiryDate) : undefined;
      if (expiryDate && (!expiry || Number.isNaN(expiry.getTime()))) {
        errors.push({ row: r + 1, error: "Invalid expiryDate" });
        continue;
      }

      const reorderLevelRaw = get("reorderLevel");
      const reorderLevel = reorderLevelRaw ? Number(reorderLevelRaw) : undefined;
      if (reorderLevelRaw && !Number.isFinite(reorderLevel as number)) {
        errors.push({ row: r + 1, error: "Invalid reorderLevel" });
        continue;
      }

      const doc = await InventoryItemModel.findOneAndUpdate(
        { tenantId, sku },
        {
          $set: {
            name,
            description: get("description") || undefined,
            location: get("location") || undefined,
            quantity,
            reorderLevel: typeof reorderLevel === "number" ? reorderLevel : undefined,
            expiryDate: expiry,
            status: get("status") || undefined,
            rfidTagId: get("rfidTagId") || undefined,
            vendorId: vendorId || undefined,
          },
          $setOnInsert: { tenantId },
        },
        { upsert: true, new: true }
      ).exec();

      await InventoryLogModel.create({
        tenantId,
        itemId: doc._id,
        action: "update",
        newQuantity: doc.quantity,
        reason: "Integration import",
        meta: { sku: doc.sku },
      });

      upserted += 1;
    }

    res.json({ ok: true, upserted, scanned, errors });
  }
);

router.post("/import/inventory", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { items } = req.body as {
    items?: Array<{
      sku?: string;
      name?: string;
      description?: string;
      location?: string;
      quantity?: number;
      reorderLevel?: number;
      expiryDate?: string;
      rfidTagId?: string;
      status?: string;
      vendorId?: string;
    }>;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ ok: false, error: "items is required" });
    return;
  }

  let upserted = 0;
  for (const i of items) {
    if (!i.sku || !i.name || typeof i.quantity !== "number") {
      res.status(400).json({ ok: false, error: "Each item must include sku, name, quantity" });
      return;
    }

    const vendorId = typeof i.vendorId === "string" ? i.vendorId.trim() : "";
    if (vendorId && !mongoose.isValidObjectId(vendorId)) {
      res.status(400).json({ ok: false, error: "Invalid vendorId" });
      return;
    }

    const doc = await InventoryItemModel.findOneAndUpdate(
      { tenantId, sku: i.sku.trim() },
      {
        $set: {
          name: i.name.trim(),
          description: i.description,
          location: i.location,
          quantity: i.quantity,
          reorderLevel: i.reorderLevel,
          expiryDate: i.expiryDate ? new Date(i.expiryDate) : undefined,
          rfidTagId: i.rfidTagId,
          status: i.status,
          vendorId: vendorId || undefined,
        },
        $setOnInsert: { tenantId },
      },
      { upsert: true, new: true }
    ).exec();

    await InventoryLogModel.create({
      tenantId,
      itemId: doc._id,
      action: "update",
      newQuantity: doc.quantity,
      reason: "Integration import",
      meta: { sku: doc.sku },
    });

    upserted += 1;
  }

  res.json({ ok: true, upserted });
});

export default router;
