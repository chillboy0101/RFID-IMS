import mongoose, { type InferSchemaType } from "mongoose";

export const feedbackCategories = ["usability", "data_accuracy", "issue", "suggestion"] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackStatuses = ["new", "reviewed", "resolved"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

const feedbackSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, required: true, enum: feedbackCategories },
    message: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5 },
    status: { type: String, required: true, enum: feedbackStatuses, default: "new" },
  },
  { timestamps: true }
);

export type Feedback = InferSchemaType<typeof feedbackSchema>;
export type FeedbackDocument = mongoose.HydratedDocument<Feedback>;

export const FeedbackModel = mongoose.model<Feedback>("Feedback", feedbackSchema);
