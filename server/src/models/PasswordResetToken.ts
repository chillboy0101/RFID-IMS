import mongoose, { type InferSchemaType } from "mongoose";

const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// TTL index to auto-delete expired tokens after they expire
passwordResetTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export type PasswordResetToken = InferSchemaType<typeof passwordResetTokenSchema>;
export type PasswordResetTokenDocument = mongoose.HydratedDocument<PasswordResetToken>;

export const PasswordResetTokenModel = mongoose.model<PasswordResetToken>("PasswordResetToken", passwordResetTokenSchema);
