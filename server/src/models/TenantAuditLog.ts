import mongoose, { type InferSchemaType } from "mongoose";

import { userRoles } from "./User.js";

const tenantAuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    type: {
      type: String,
      required: true,
      enum: ["membership_add", "membership_remove", "membership_role_change"],
      index: true,
    },

    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fromRole: { type: String, required: false, enum: userRoles },
    toRole: { type: String, required: false, enum: userRoles },
  },
  { timestamps: true }
);

tenantAuditLogSchema.index({ tenantId: 1, createdAt: -1 });

export type TenantAuditLog = InferSchemaType<typeof tenantAuditLogSchema>;
export type TenantAuditLogDocument = mongoose.HydratedDocument<TenantAuditLog>;

export const TenantAuditLogModel = mongoose.model<TenantAuditLog>("TenantAuditLog", tenantAuditLogSchema);
