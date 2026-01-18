import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { VendorModel } from "../models/Vendor.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireTenant);

router.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      list: "GET /vendors",
      create: "POST /vendors (manager/admin)",
      get: "GET /vendors/:id",
      update: "PATCH /vendors/:id (manager/admin)",
      delete: "DELETE /vendors/:id (admin)",
      meta: "GET /vendors/meta",
    },
  });
});

router.get("/", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const vendors = await VendorModel.find({ tenantId }).sort({ updatedAt: -1 }).limit(200).exec();
  res.json({ ok: true, vendors });
});

router.post("/", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { name, contactEmail, contactPhone, address, notes } = req.body as {
    name?: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    notes?: string;
  };

  if (!name || !name.trim()) {
    res.status(400).json({ ok: false, error: "name is required" });
    return;
  }

  const vendor = await VendorModel.create({
    tenantId,
    name: name.trim(),
    contactEmail,
    contactPhone,
    address,
    notes,
  });

  res.status(201).json({ ok: true, vendor });
});

router.get("/:id", async (req, res) => {
  const tenantId = (req as TenantRequest).tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const vendor = await VendorModel.findOne({ _id: id, tenantId }).exec();
  if (!vendor) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, vendor });
});

router.patch("/:id", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const vendor = await VendorModel.findOneAndUpdate({ _id: id, tenantId }, req.body, { new: true }).exec();
  if (!vendor) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true, vendor });
});

router.delete("/:id", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const vendor = await VendorModel.findOneAndDelete({ _id: id, tenantId }).exec();
  if (!vendor) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  res.json({ ok: true });
});

export default router;
