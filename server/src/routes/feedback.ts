import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import {
  FeedbackModel,
  feedbackCategories,
  feedbackStatuses,
  type FeedbackCategory,
  type FeedbackStatus,
} from "../models/Feedback.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      submit: "POST /feedback",
      myFeedback: "GET /feedback/me",
      listAll: "GET /feedback/all (admin)",
      setStatus: "PATCH /feedback/:id/status (admin)",
    },
  });
});

router.post("/", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { category, message, rating } = req.body as {
    category?: FeedbackCategory;
    message?: string;
    rating?: number;
  };

  if (!category || !feedbackCategories.includes(category)) {
    res.status(400).json({ ok: false, error: "Invalid category" });
    return;
  }

  if (!message || !message.trim()) {
    res.status(400).json({ ok: false, error: "Message is required" });
    return;
  }

  const doc = await FeedbackModel.create({
    tenantId,
    userId: auth.id,
    category,
    message: message.trim(),
    rating,
  });

  res.status(201).json({ ok: true, feedback: doc });
});

router.get("/me", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const feedback = await FeedbackModel.find({ tenantId, userId: auth.id }).sort({ createdAt: -1 }).limit(200).exec();
  res.json({ ok: true, feedback });
});

router.get("/all", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  const feedback = await FeedbackModel.find({ tenantId, ...filter }).sort({ createdAt: -1 }).limit(500).exec();
  res.json({ ok: true, feedback });
});

router.patch("/:id/status", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const { status } = req.body as { status?: FeedbackStatus };
  if (!status || !feedbackStatuses.includes(status)) {
    res.status(400).json({ ok: false, error: "Invalid status" });
    return;
  }

  const doc = await FeedbackModel.findOneAndUpdate({ _id: id, tenantId }, { status }, { new: true }).exec();
  if (!doc) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, feedback: doc });
});

export default router;
