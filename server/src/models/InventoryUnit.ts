import mongoose, { type InferSchemaType } from "mongoose";

export const inventoryUnitStatuses = ["received", "in_stock", "reserved", "picked", "packed", "dispatched", "returned", "damaged"] as const;
export type InventoryUnitStatus = (typeof inventoryUnitStatuses)[number];

const inventoryUnitSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    tagId: { type: String, trim: true },
    location: { type: String, trim: true },
    status: { type: String, trim: true, enum: inventoryUnitStatuses, default: "received" },
  },
  { timestamps: true }
);

inventoryUnitSchema.index(
  { tenantId: 1, tagId: 1 },
  {
    unique: true,
    partialFilterExpression: { tagId: { $type: "string", $ne: "" } },
  }
);

inventoryUnitSchema.index({ tenantId: 1, itemId: 1, createdAt: -1 });

export type InventoryUnit = InferSchemaType<typeof inventoryUnitSchema>;
export type InventoryUnitDocument = mongoose.HydratedDocument<InventoryUnit>;

export const InventoryUnitModel = mongoose.model<InventoryUnit>("InventoryUnit", inventoryUnitSchema);
