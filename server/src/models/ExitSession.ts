import mongoose, { type InferSchemaType } from "mongoose";

const exitSessionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    location: { type: String, trim: true, default: "EXIT_MAIN" },
    tokenPrefix: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, trim: true },
    startedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    lastSeenAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

exitSessionSchema.index({ tenantId: 1, tokenPrefix: 1, tokenHash: 1 });
exitSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type ExitSession = InferSchemaType<typeof exitSessionSchema>;
export type ExitSessionDocument = mongoose.HydratedDocument<ExitSession>;

export const ExitSessionModel = mongoose.model<ExitSession>("ExitSession", exitSessionSchema);
