import mongoose, { type InferSchemaType } from "mongoose";

const verificationTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// TTL index - automatically delete documents after expiration
verificationTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export type VerificationToken = InferSchemaType<typeof verificationTokenSchema>;
export type VerificationTokenDocument = mongoose.HydratedDocument<VerificationToken>;

export const VerificationTokenModel = mongoose.model<VerificationToken>("VerificationToken", verificationTokenSchema);
