import mongoose, { type InferSchemaType } from "mongoose";

import { userRoles } from "./User.js";

const inviteSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: false, lowercase: true, trim: true },
    role: { type: String, required: false, enum: userRoles },
    makeSuperAdmin: { type: Boolean, required: false },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    usedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
    usedAt: { type: Date, required: false },
    expiresAt: { type: Date, required: false },
  },
  { timestamps: true }
);

export type Invite = InferSchemaType<typeof inviteSchema>;
export type InviteDocument = mongoose.HydratedDocument<Invite>;

export const InviteModel = mongoose.model<Invite>("Invite", inviteSchema);
