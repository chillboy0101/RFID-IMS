import mongoose from "mongoose";

import { InventoryItemModel } from "../models/InventoryItem.js";

export function buildInventorySkuBase(name: string) {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]+/g);
  const base = words?.length ? words.slice(0, 3).map((word) => word.slice(0, 4)).join("-") : "ITEM";
  return base.slice(0, 32) || "ITEM";
}

export async function generateInventorySku(tenantId: string, name: string) {
  const base = buildInventorySkuBase(name);
  const currentCount = await InventoryItemModel.countDocuments({ tenantId }).exec();

  for (let offset = 1; offset <= 1000; offset += 1) {
    const sku = `${base}-${String(currentCount + offset).padStart(4, "0")}`;
    const exists = await InventoryItemModel.exists({ tenantId, sku }).exec();
    if (!exists) return sku;
  }

  return `${base}-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`;
}

export function isMongoDuplicateKeyError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000);
}
