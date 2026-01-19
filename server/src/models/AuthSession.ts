import mongoose, { type InferSchemaType } from "mongoose";

const authSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastSeenTenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", index: true },
    revokedAt: { type: Date },
    revokedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
    revokedByRole: { type: String, required: false, enum: ["admin", "super_admin"], index: true },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

authSessionSchema.index({ userId: 1, lastSeenAt: -1 });

authSessionSchema.index(
  { lastSeenTenantId: 1, lastSeenAt: -1 },
  { partialFilterExpression: { revokedAt: { $exists: false } } }
);

authSessionSchema.index(
  { lastSeenAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    partialFilterExpression: { revokedAt: { $exists: false } },
  }
);

export type AuthSession = InferSchemaType<typeof authSessionSchema>;
export type AuthSessionDocument = mongoose.HydratedDocument<AuthSession>;

export const AuthSessionModel = mongoose.model<AuthSession>("AuthSession", authSessionSchema);
