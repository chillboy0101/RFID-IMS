import mongoose, { type InferSchemaType } from "mongoose";

import { userRoles } from "./User.js";

const tenantMembershipSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, required: true, enum: userRoles },
  },
  { timestamps: true }
);

tenantMembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export type TenantMembership = InferSchemaType<typeof tenantMembershipSchema>;
export type TenantMembershipDocument = mongoose.HydratedDocument<TenantMembership>;

export const TenantMembershipModel = mongoose.model<TenantMembership>("TenantMembership", tenantMembershipSchema);
