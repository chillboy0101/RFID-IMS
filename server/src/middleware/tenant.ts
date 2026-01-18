import type { NextFunction, Response } from "express";
import mongoose from "mongoose";

import { TenantMembershipModel } from "../models/TenantMembership.js";
import { TenantModel } from "../models/Tenant.js";
import type { UserRole } from "../models/User.js";
import type { AuthRequest } from "./auth.js";

export type TenantRequest = AuthRequest & { tenantId?: string; tenantRole?: UserRole };

export async function requireTenant(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const tenantId = (req.header("x-tenant-id") ?? req.header("X-Tenant-ID") ?? "").trim();
  if (!tenantId) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID is required" });
    return;
  }

  if (!mongoose.isValidObjectId(tenantId)) {
    res.status(400).json({ ok: false, error: "Invalid X-Tenant-ID" });
    return;
  }

  if (auth.role === "admin") {
    const tenantExists = await TenantModel.exists({ _id: tenantId }).exec();
    if (!tenantExists) {
      res.status(404).json({ ok: false, error: "Tenant not found" });
      return;
    }
    req.tenantId = tenantId;
    req.tenantRole = "admin" as UserRole;
    next();
    return;
  }

  const membership = await TenantMembershipModel.findOne({ tenantId, userId: auth.id }).exec();
  if (!membership) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  req.tenantId = tenantId;
  req.tenantRole = membership.role as UserRole;
  next();
}
