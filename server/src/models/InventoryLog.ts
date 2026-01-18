import mongoose, { type InferSchemaType } from "mongoose";

export const inventoryLogActions = ["add", "remove", "adjust", "create", "update", "delete"] as const;
export type InventoryLogAction = (typeof inventoryLogActions)[number];

const inventoryLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    action: { type: String, required: true, enum: inventoryLogActions },
    delta: { type: Number },
    previousQuantity: { type: Number },
    newQuantity: { type: Number },
    reason: { type: String, trim: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

inventoryLogSchema.index({ tenantId: 1, itemId: 1, createdAt: -1 });
inventoryLogSchema.index({ tenantId: 1, createdAt: -1 });

export type InventoryLog = InferSchemaType<typeof inventoryLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InventoryLogModel = mongoose.model("InventoryLog", inventoryLogSchema);
