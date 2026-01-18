import mongoose, { type InferSchemaType } from "mongoose";

export const userRoles = ["inventory_staff", "manager", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: userRoles,
      default: "inventory_staff",
    },
  },
  { timestamps: true }
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = mongoose.HydratedDocument<User>;

export const UserModel = mongoose.model<User>("User", userSchema);
