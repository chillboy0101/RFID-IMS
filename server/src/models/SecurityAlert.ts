import mongoose, { type InferSchemaType } from "mongoose";

export const securityAlertStatuses = ["open", "acknowledged", "resolved"] as const;
export type SecurityAlertStatus = (typeof securityAlertStatuses)[number];

export const securityAlertSeverities = ["info", "warning", "critical"] as const;
export type SecurityAlertSeverity = (typeof securityAlertSeverities)[number];

const securityAlertSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tagId: { type: String, trim: true, index: true },
    barcode: { type: String, trim: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem" },
    location: { type: String, trim: true },
    source: { type: String, trim: true },
    observedAt: { type: Date, required: true },
    status: { type: String, required: true, enum: securityAlertStatuses, default: "open" },
    severity: { type: String, required: true, enum: securityAlertSeverities, default: "critical" },
    message: { type: String, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

securityAlertSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
securityAlertSchema.index({ tenantId: 1, tagId: 1, createdAt: -1 });
securityAlertSchema.index({ tenantId: 1, barcode: 1, createdAt: -1 });

export type SecurityAlert = InferSchemaType<typeof securityAlertSchema>;
export type SecurityAlertDocument = mongoose.HydratedDocument<SecurityAlert>;

export const SecurityAlertModel = mongoose.model<SecurityAlert>("SecurityAlert", securityAlertSchema);
