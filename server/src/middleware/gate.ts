import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";

import { GateApiKeyModel } from "../models/GateApiKey.js";
import { TenantModel } from "../models/Tenant.js";

export type GateRequest = Request & { tenantId?: string; gateKeyName?: string; gateKeyLocationHint?: string };

/** Hash a raw API key with SHA-256. We store keyPrefix + hash so we can show
 *  the prefix on the key-listing screen without exposing the full secret. */
export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a new random gate API key. Returns { raw, prefix, hash }. */
export function generateKey(): { raw: string; prefix: string; hash: string } {
  const raw = `gate_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export async function requireGateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = (req.header("x-gate-api-key") ?? req.header("X-Gate-Api-Key") ?? "").trim();
  if (!rawKey) {
    res.status(401).json({ ok: false, error: "X-Gate-Api-Key header is required" });
    return;
  }

  const keyHash = hashKey(rawKey);
  const prefix = rawKey.slice(0, 12);

  const keyDoc = await GateApiKeyModel.findOne({
    keyHash,
    keyPrefix: prefix,
    revokedAt: { $exists: false },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).exec();

  if (!keyDoc) {
    res.status(401).json({ ok: false, error: "Invalid or revoked gate API key" });
    return;
  }

  // Update last-seen telemetry (fire-and-forget)
  keyDoc.lastSeenAt = new Date();
  keyDoc.lastSeenSource = req.header("x-source") ?? "unknown";
  keyDoc.save().catch(() => {});

  (req as GateRequest).tenantId = keyDoc.tenantId.toString();
  (req as GateRequest).gateKeyName = keyDoc.name;
  (req as GateRequest).gateKeyLocationHint = keyDoc.locationHint?.trim();

  next();
}

export async function requireGateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  // If called after requireGateApiKey, tenantId is already set on the request
  const existing = (req as GateRequest).tenantId;
  if (existing) {
    if (!mongoose.isValidObjectId(existing)) {
      res.status(400).json({ ok: false, error: "Invalid tenantId" });
      return;
    }
    const tenantExists = await TenantModel.exists({ _id: existing }).exec();
    if (!tenantExists) {
      res.status(404).json({ ok: false, error: "Tenant not found" });
      return;
    }
    next();
    return;
  }

  // Fallback: header-based tenant for manual testing
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

  (req as GateRequest).tenantId = tenantId;
  next();
}
