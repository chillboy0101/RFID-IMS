import mongoose, { type InferSchemaType } from "mongoose";

const gateApiKeySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    // We store a prefix + hash so the raw key is only shown once at creation time
    keyPrefix: { type: String, required: true, default: "gate_" }, // first 8 chars of the raw key
    keyHash: { type: String, required: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    locationHint: { type: String, trim: true }, // e.g. "EXIT_MAIN", "RECEIVING_BAY_1"
    lastSeenAt: { type: Date },
    lastSeenSource: { type: String },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

// TTL index: automatically removes expired keys (handled by schema.index below, not expires option)
// Compound index for key lookup + revocation check
gateApiKeySchema.index({ keyHash: 1, keyPrefix: 1, revokedAt: 1 }, { unique: true });
gateApiKeySchema.index({ tenantId: 1, revokedAt: 1 });

export type GateApiKey = InferSchemaType<typeof gateApiKeySchema>;
export type GateApiKeyDocument = mongoose.HydratedDocument<GateApiKey>;

export const GateApiKeyModel = mongoose.model<GateApiKey>("GateApiKey", gateApiKeySchema);
