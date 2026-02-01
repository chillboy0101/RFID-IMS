import mongoose, { type InferSchemaType } from "mongoose";

export const exitAuthorizationStatuses = ["active", "revoked"] as const;
export type ExitAuthorizationStatus = (typeof exitAuthorizationStatuses)[number];

const exitAuthorizationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tagId: { type: String, required: true, trim: true, index: true },
    location: { type: String, trim: true, default: "EXIT_MAIN" },
    status: { type: String, required: true, enum: exitAuthorizationStatuses, default: "active" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date, required: true, index: true },
    lastSeenAt: { type: Date },
    lastSeenSource: { type: String, trim: true },
  },
  { timestamps: true }
);

exitAuthorizationSchema.index({ tenantId: 1, tagId: 1, location: 1, expiresAt: 1 });
exitAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type ExitAuthorization = InferSchemaType<typeof exitAuthorizationSchema>;
export type ExitAuthorizationDocument = mongoose.HydratedDocument<ExitAuthorization>;

export const ExitAuthorizationModel = mongoose.model<ExitAuthorization>("ExitAuthorization", exitAuthorizationSchema);
