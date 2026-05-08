import mongoose, { type InferSchemaType } from "mongoose";

export const userRoles = ["inventory_staff", "manager", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    mustChangePassword: { type: Boolean, required: true, default: false },
    emailVerified: { type: Boolean, required: true, default: false },
    accountRecoveryRequiredAt: { type: Date, default: null },
    operatorTagId: {
      type: String,
      trim: true,
      set: (value: unknown) => {
        const normalized = typeof value === "string" ? value.trim() : "";
        return normalized || undefined;
      },
    },
    role: {
      type: String,
      required: true,
      enum: userRoles,
      default: "inventory_staff",
    },
  },
  { timestamps: true }
);

userSchema.index(
  { operatorTagId: 1 },
  {
    unique: true,
    sparse: true,
  }
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = mongoose.HydratedDocument<User>;

export const UserModel = mongoose.model<User>("User", userSchema);
