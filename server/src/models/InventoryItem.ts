import mongoose, { type InferSchemaType } from "mongoose";

const inventoryItemSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    location: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    expiryDate: { type: Date },
    rfidTagId: { type: String, trim: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    status: { type: String, trim: true, default: "active" },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
inventoryItemSchema.index({ tenantId: 1, updatedAt: -1 });

export type InventoryItem = InferSchemaType<typeof inventoryItemSchema>;
export type InventoryItemDocument = mongoose.HydratedDocument<InventoryItem>;

export const InventoryItemModel = mongoose.model<InventoryItem>("InventoryItem", inventoryItemSchema);
