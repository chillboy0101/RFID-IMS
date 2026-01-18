import mongoose, { type InferSchemaType } from "mongoose";

export const reorderStatuses = ["requested", "ordered", "received", "cancelled"] as const;
export type ReorderStatus = (typeof reorderStatuses)[number];

const reorderRequestSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    requestedQuantity: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: reorderStatuses, default: "requested" },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

export type ReorderRequest = InferSchemaType<typeof reorderRequestSchema>;
export type ReorderRequestDocument = mongoose.HydratedDocument<ReorderRequest>;

export const ReorderRequestModel = mongoose.model<ReorderRequest>("ReorderRequest", reorderRequestSchema);
