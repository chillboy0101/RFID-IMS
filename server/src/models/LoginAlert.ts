import mongoose, { type InferSchemaType } from "mongoose";

const loginAlertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionJti: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    loginAt: { type: Date, required: true, index: true },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    protectClickedAt: { type: Date, default: null },
    recoveryOtpHash: { type: String, default: null },
    recoveryOtpExpiresAt: { type: Date, default: null },
    recoveryOtpSentAt: { type: Date, default: null },
    recoveryCompletedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

loginAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
loginAlertSchema.index({ userId: 1, loginAt: -1 });

export type LoginAlert = InferSchemaType<typeof loginAlertSchema>;
export type LoginAlertDocument = mongoose.HydratedDocument<LoginAlert>;

export const LoginAlertModel = mongoose.model<LoginAlert>("LoginAlert", loginAlertSchema);
