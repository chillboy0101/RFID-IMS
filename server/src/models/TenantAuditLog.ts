import mongoose, { type InferSchemaType } from "mongoose";

import { userRoles } from "./User.js";

const tenantAuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorName: { type: String, trim: true },
    actorEmail: { type: String, trim: true, lowercase: true },
    actorRole: { type: String, required: false, enum: userRoles },
    actorTenantRole: { type: String, required: false, enum: userRoles },
    actorSource: { type: String, trim: true, default: "user" },

    type: {
      type: String,
      required: true,
      index: true,
    },

    category: { type: String, trim: true, index: true },
    summary: { type: String, trim: true },
    entityType: { type: String, trim: true, index: true },
    entityId: { type: String, trim: true, index: true },
    entityLabel: { type: String, trim: true },

    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    fromRole: { type: String, required: false, enum: userRoles },
    toRole: { type: String, required: false, enum: userRoles },

    method: { type: String, trim: true },
    path: { type: String, trim: true },
    routeKey: { type: String, trim: true, index: true },
    requestId: { type: String, trim: true },
    statusCode: { type: Number },
    outcome: { type: String, trim: true, enum: ["success", "failure"], index: true },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

tenantAuditLogSchema.index({ tenantId: 1, createdAt: -1 });
tenantAuditLogSchema.index({ tenantId: 1, category: 1, createdAt: -1 });
tenantAuditLogSchema.index({ tenantId: 1, actorUserId: 1, createdAt: -1 });

export type TenantAuditLog = InferSchemaType<typeof tenantAuditLogSchema>;
export type TenantAuditLogDocument = mongoose.HydratedDocument<TenantAuditLog>;

export const TenantAuditLogModel = mongoose.model<TenantAuditLog>("TenantAuditLog", tenantAuditLogSchema);
