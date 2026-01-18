import mongoose, { type InferSchemaType } from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  },
  { timestamps: true }
);

export type Tenant = InferSchemaType<typeof tenantSchema>;
export type TenantDocument = mongoose.HydratedDocument<Tenant>;

export const TenantModel = mongoose.model<Tenant>("Tenant", tenantSchema);
