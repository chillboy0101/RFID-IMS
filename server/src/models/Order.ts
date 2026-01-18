import mongoose, { type InferSchemaType } from "mongoose";

export const orderStatuses = ["created", "picking", "fulfilled", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];

const orderItemSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    quantity: { type: Number, required: true, min: 1 },
    skuSnapshot: { type: String, trim: true },
    nameSnapshot: { type: String, trim: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    status: { type: String, required: true, enum: orderStatuses, default: "created" },
    items: { type: [orderItemSchema], required: true },
    notes: { type: String, trim: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fulfilledAt: { type: Date },
    stockAdjusted: { type: Boolean, default: false },
    stockAdjustedAt: { type: Date },
    stockRestoredAt: { type: Date },
  },
  { timestamps: true }
);

orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ createdByUserId: 1, createdAt: -1 });

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDocument = mongoose.HydratedDocument<Order>;

export const OrderModel = mongoose.model<Order>("Order", orderSchema);
