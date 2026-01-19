import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import mongoose from "mongoose";
import { AuthSessionModel } from "../models/AuthSession.js";
import { UserModel, userRoles, type UserRole } from "../models/User.js";

export type AuthUser = {
  id: string;
  role: UserRole;
  jti?: string;
};

export type AuthRequest = Request & { auth?: AuthUser };

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

export function signAccessToken(payload: AuthUser): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);

    if (typeof decoded !== "object" || decoded === null) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const decodedObj = decoded as Record<string, unknown>;
    const id = decodedObj.id;
    const jti = decodedObj.jti;

    if (typeof id !== "string") {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const user = await UserModel.findById(id).select({ role: 1 }).exec();
    if (!user || !userRoles.includes(user.role as UserRole)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const jtiStr = typeof jti === "string" && jti.trim() ? jti.trim() : null;
    if (jtiStr) {
      const update: Record<string, unknown> = { lastSeenAt: new Date() };
      const tenantId = req.header("x-tenant-id") ?? "";
      if (mongoose.isValidObjectId(tenantId)) {
        update.lastSeenTenantId = tenantId;
      }

      const session = await AuthSessionModel.findOneAndUpdate(
        { jti: jtiStr, revokedAt: { $exists: false } },
        { $set: update },
        { new: false }
      )
        .select({ _id: 1 })
        .exec();

      if (!session) {
        const revoked = await AuthSessionModel.findOne({ jti: jtiStr }).select({ revokedAt: 1, revokedByRole: 1 }).exec();
        if (revoked?.revokedAt) {
          const by = String((revoked as any).revokedByRole ?? "admin");
          const label = by === "super_admin" ? "super_admin" : "admin";
          res.status(401).json({ ok: false, error: `Signed out by ${label}` });
          return;
        }
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    req.auth = { id: user._id.toString(), role: user.role as UserRole, jti: jtiStr ?? undefined };
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const effectiveRole = (req as any).tenantRole ?? req.auth.role;
    if (!allowedRoles.includes(effectiveRole)) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    next();
  };
}
