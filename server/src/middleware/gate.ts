import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

import { TenantModel } from "../models/Tenant.js";

export type GateRequest = Request & { tenantId?: string };

export async function requireGateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const expected = process.env.GATE_API_KEY;
  if (!expected) {
    res.status(500).json({ ok: false, error: "GATE_API_KEY is not configured" });
    return;
  }

  const provided = (req.header("x-gate-api-key") ?? req.header("X-Gate-Api-Key") ?? "").trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  next();
}

export async function requireGateTenant(req: GateRequest, res: Response, next: NextFunction): Promise<void> {
  const tenantId = (req.header("x-tenant-id") ?? req.header("X-Tenant-ID") ?? "").trim();
  if (!tenantId) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID is required" });
    return;
  }

  if (!mongoose.isValidObjectId(tenantId)) {
    res.status(400).json({ ok: false, error: "Invalid X-Tenant-ID" });
    return;
  }

  const tenantExists = await TenantModel.exists({ _id: tenantId }).exec();
  if (!tenantExists) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  req.tenantId = tenantId;
  next();
}
