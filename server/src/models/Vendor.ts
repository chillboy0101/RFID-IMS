import mongoose, { type InferSchemaType } from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export type Vendor = InferSchemaType<typeof vendorSchema>;
export type VendorDocument = mongoose.HydratedDocument<Vendor>;

export const VendorModel = mongoose.model<Vendor>("Vendor", vendorSchema);
