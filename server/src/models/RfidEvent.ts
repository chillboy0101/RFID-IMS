import mongoose, { type InferSchemaType } from "mongoose";

export const rfidEventTypes = ["scan", "move", "quantity"] as const;
export type RfidEventType = (typeof rfidEventTypes)[number];

const rfidEventSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tagId: { type: String, required: true, trim: true, index: true },
    eventType: { type: String, required: true, enum: rfidEventTypes },
    eventId: { type: String, trim: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem" },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    operatorSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "OperatorSession", index: true },
    operatorTagId: { type: String, trim: true, index: true },
    gateKeyName: { type: String, trim: true },
    location: { type: String, trim: true },
    delta: { type: Number },
    observedAt: { type: Date, required: true },
    source: { type: String, trim: true },
    raw: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

rfidEventSchema.index(
  { tenantId: 1, eventId: 1 },
  {
    unique: true,
    sparse: true,
  }
);

export type RfidEvent = InferSchemaType<typeof rfidEventSchema>;
export type RfidEventDocument = mongoose.HydratedDocument<RfidEvent>;

export const RfidEventModel = mongoose.model<RfidEvent>("RfidEvent", rfidEventSchema);
