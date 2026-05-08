import mongoose, { type InferSchemaType } from "mongoose";

const operatorSessionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    gateKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "GateApiKey", required: true, index: true },
    gateKeyName: { type: String, trim: true },
    location: { type: String, trim: true, default: "EXIT_MAIN" },
    source: { type: String, trim: true, default: "rfid" },
    operatorTagId: { type: String, required: true, trim: true, index: true },
    tokenPrefix: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, trim: true },
    startedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

operatorSessionSchema.index({ tenantId: 1, tokenPrefix: 1, tokenHash: 1 });
operatorSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OperatorSession = InferSchemaType<typeof operatorSessionSchema>;
export type OperatorSessionDocument = mongoose.HydratedDocument<OperatorSession>;

export const OperatorSessionModel = mongoose.model<OperatorSession>("OperatorSession", operatorSessionSchema);
