import bcrypt from "bcryptjs";
import express from "express";
import mongoose from "mongoose";

import { requireAuth, signAccessToken, type AuthRequest } from "../middleware/auth.js";
import { InviteModel } from "../models/Invite.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantMembershipModel } from "../models/TenantMembership.js";
import { UserModel } from "../models/User.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      register: "POST /auth/register",
      login: "POST /auth/login",
      me: "GET /auth/me (Bearer token)",
    },
  });
});

router.post("/register", async (req, res) => {
  const { name, email, password, inviteCode } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    inviteCode?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const existing = await UserModel.findOne({ email: cleanEmail }).exec();
  if (existing) {
    res.status(409).json({ ok: false, error: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const session = await mongoose.startSession();
  try {
    let userId: string | null = null;
    let userRole: string | null = null;

    await session.withTransaction(async () => {
      const user = await UserModel.create(
        [
          {
            name: name.trim(),
            email: cleanEmail,
            passwordHash,
          },
        ],
        { session }
      );

      userId = user[0]!._id.toString();

      const code = (inviteCode ?? "").trim();
      if (code) {
        const invite = await InviteModel.findOne({ code }).session(session).exec();
        if (!invite) {
          throw new Error("Invalid invite code");
        }
        if (invite.usedAt || invite.usedByUserId) {
          throw new Error("Invite code already used");
        }
        if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
          throw new Error("Invite code expired");
        }
        if (invite.email && invite.email.toLowerCase().trim() !== cleanEmail) {
          throw new Error("Invite code is not for this email");
        }

        await TenantMembershipModel.findOneAndUpdate(
          { tenantId: invite.tenantId, userId: user[0]!._id },
          { $set: { role: (invite.role as any) ?? user[0]!.role } },
          { upsert: true, new: true, session }
        ).exec();

        invite.usedByUserId = user[0]!._id;
        invite.usedAt = new Date();
        await invite.save({ session });
      } else {
        const tenants = await TenantModel.find({}).select({ _id: 1 }).sort({ createdAt: 1 }).limit(2).session(session).exec();
        if (tenants.length === 1) {
          await TenantMembershipModel.findOneAndUpdate(
            { tenantId: tenants[0]!._id, userId: user[0]!._id },
            { $set: { role: user[0]!.role } },
            { upsert: true, new: true, session }
          ).exec();
        }
      }

      userRole = user[0]!.role;
    });

    if (!userId || !userRole) {
      res.status(500).json({ ok: false, error: "Failed to create user" });
      return;
    }

    const token = signAccessToken({ id: userId, role: userRole as any });

    const user = await UserModel.findById(userId).exec();
    if (!user) {
      res.status(500).json({ ok: false, error: "Failed to create user" });
      return;
    }

    res.status(201).json({
      ok: true,
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Registration failed" });
  } finally {
    session.endSession();
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
  if (!user) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  const token = signAccessToken({ id: user._id.toString(), role: user.role });

  res.json({
    ok: true,
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const user = await UserModel.findById(auth.id).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  res.json({
    ok: true,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export default router;
