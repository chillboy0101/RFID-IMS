import mongoose, { type InferSchemaType } from "mongoose";

export const rfidReceivingContextStatuses = ["active", "released"] as const;
export type RfidReceivingContextStatus = (typeof rfidReceivingContextStatuses)[number];

const rfidReceivingContextSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    armedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    location: { type: String, required: true, trim: true },
    source: { type: String, trim: true, default: "rfid" },
    status: { type: String, enum: rfidReceivingContextStatuses, default: "active", index: true },
    receivedCount: { type: Number, default: 0, min: 0 },
    lastTagId: { type: String, trim: true },
    lastScanAt: { type: Date },
    releasedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

rfidReceivingContextSchema.index({ tenantId: 1, status: 1, expiresAt: 1, updatedAt: -1 });
rfidReceivingContextSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RfidReceivingContext = InferSchemaType<typeof rfidReceivingContextSchema>;
export type RfidReceivingContextDocument = mongoose.HydratedDocument<RfidReceivingContext>;

export const RfidReceivingContextModel = mongoose.model<RfidReceivingContext>("RfidReceivingContext", rfidReceivingContextSchema);
