import mongoose, { type InferSchemaType } from "mongoose";

export const taskSessionKinds = ["inventory_update", "order_fulfillment", "other"] as const;
export type TaskSessionKind = (typeof taskSessionKinds)[number];

const taskSessionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, required: true, enum: taskSessionKinds },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export type TaskSession = InferSchemaType<typeof taskSessionSchema>;
export type TaskSessionDocument = mongoose.HydratedDocument<TaskSession>;

export const TaskSessionModel = mongoose.model<TaskSession>("TaskSession", taskSessionSchema);
