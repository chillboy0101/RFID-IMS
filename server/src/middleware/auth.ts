import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { UserModel, userRoles, type UserRole } from "../models/User.js";

export type AuthUser = {
  id: string;
  role: UserRole;
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

    const id = (decoded as Record<string, unknown>).id;

    if (typeof id !== "string") {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const user = await UserModel.findById(id).exec();
    if (!user || !userRoles.includes(user.role as UserRole)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    req.auth = { id: user._id.toString(), role: user.role as UserRole };
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
