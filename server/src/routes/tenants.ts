import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantAuditLogModel } from "../models/TenantAuditLog.js";
import { TenantMembershipModel } from "../models/TenantMembership.js";
import { InviteModel } from "../models/Invite.js";
import { UserModel, userRoles, type UserRole } from "../models/User.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", requireRole("admin"), async (_req: AuthRequest, res) => {
  const tenants = await TenantModel.find({}).sort({ createdAt: 1 }).exec();
  res.json({ ok: true, tenants: tenants.map((t) => ({ id: t._id.toString(), name: t.name, slug: t.slug })) });
});

router.get("/mine", async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const memberships = await TenantMembershipModel.find({ userId: auth.id }).sort({ createdAt: 1 }).exec();
  const tenantIds = memberships.map((m) => m.tenantId);
  const tenants = await TenantModel.find({ _id: { $in: tenantIds } }).sort({ createdAt: 1 }).exec();

  res.json({
    ok: true,
    tenants: tenants.map((t) => ({ id: t._id.toString(), name: t.name, slug: t.slug })),
    memberships: memberships.map((m) => ({ tenantId: String(m.tenantId), role: m.role })),
  });
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string };

  if (!name || !name.trim() || !slug || !slug.trim()) {
    res.status(400).json({ ok: false, error: "name and slug are required" });
    return;
  }

  const cleanSlug = slug.toLowerCase().trim();
  const doc = await TenantModel.create({ name: name.trim(), slug: cleanSlug });

  res.status(201).json({ ok: true, tenant: { id: doc._id.toString(), name: doc.name, slug: doc.slug } });
});

router.post("/:id/members", requireRole("admin"), async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const { userId, email, role } = req.body as { userId?: string; email?: string; role?: UserRole };

  let user = null;
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      res.status(400).json({ ok: false, error: "Invalid userId" });
      return;
    }
    user = await UserModel.findById(userId).exec();
  } else if (email) {
    user = await UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
  } else {
    res.status(400).json({ ok: false, error: "Provide userId or email" });
    return;
  }

  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  const effectiveRole = role && userRoles.includes(role) ? role : (user.role as UserRole);

  const effectiveActorRole = ((req as any).tenantRole ?? auth.role) as UserRole;
  if (effectiveRole === "admin" && effectiveActorRole !== "admin") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  const existing = await TenantMembershipModel.findOne({ tenantId: tenant._id, userId: user._id }).exec();

  const membership = await TenantMembershipModel.findOneAndUpdate(
    { tenantId: tenant._id, userId: user._id },
    { $set: { role: effectiveRole } },
    { upsert: true, new: true }
  ).exec();

  if (!existing) {
    await TenantAuditLogModel.create({
      tenantId: tenant._id,
      actorUserId: auth.id,
      type: "membership_add",
      targetUserId: user._id,
      toRole: membership.role,
    });
  } else if (String(existing.role) !== String(membership.role)) {
    await TenantAuditLogModel.create({
      tenantId: tenant._id,
      actorUserId: auth.id,
      type: "membership_role_change",
      targetUserId: user._id,
      fromRole: existing.role,
      toRole: membership.role,
    });
  }

  res.status(201).json({ ok: true, membership: { tenantId: String(membership.tenantId), userId: String(membership.userId), role: membership.role } });
});

router.post("/:id/invites", requireRole("admin"), async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const { email, role, expiresInDays } = req.body as { email?: string; role?: UserRole; expiresInDays?: number };

  const cleanEmail = email ? email.toLowerCase().trim() : "";
  if (!cleanEmail) {
    res.status(400).json({ ok: false, error: "email is required" });
    return;
  }
  const effectiveRole = role && userRoles.includes(role) ? role : undefined;
  const days = typeof expiresInDays === "number" && expiresInDays > 0 ? expiresInDays : 14;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const code = crypto.randomBytes(16).toString("hex");

  const invite = await InviteModel.create({
    code,
    tenantId: tenant._id,
    email: cleanEmail,
    role: effectiveRole,
    createdByUserId: auth.id,
    expiresAt,
  });

  res.status(201).json({
    ok: true,
    invite: {
      code: invite.code,
      tenantId: String(invite.tenantId),
      email: invite.email ?? null,
      role: invite.role ?? null,
      expiresAt: invite.expiresAt ?? null,
    },
  });
});

router.get("/:id/members", requireRole("admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const memberships = await TenantMembershipModel.find({ tenantId: tenant._id }).sort({ createdAt: 1 }).exec();
  const userIds = memberships.map((m) => m.userId);
  const users = await UserModel.find({ _id: { $in: userIds } }).select({ name: 1, email: 1, role: 1 }).exec();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  res.json({
    ok: true,
    tenant: { id: tenant._id.toString(), name: tenant.name, slug: tenant.slug },
    members: memberships.map((m) => {
      const u = userById.get(String(m.userId));
      return {
        tenantId: String(m.tenantId),
        userId: String(m.userId),
        role: m.role,
        user: u ? { id: u._id.toString(), name: u.name, email: u.email, role: u.role } : null,
      };
    }),
  });
});

router.delete("/:id/members/:userId", requireRole("admin"), async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id, userId } = req.params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const membership = await TenantMembershipModel.findOneAndDelete({ tenantId: tenant._id, userId }).exec();
  if (!membership) {
    res.status(404).json({ ok: false, error: "Membership not found" });
    return;
  }

  await TenantAuditLogModel.create({
    tenantId: tenant._id,
    actorUserId: auth.id,
    type: "membership_remove",
    targetUserId: userId,
    fromRole: membership.role,
  });

  res.json({ ok: true });
});

export default router;
