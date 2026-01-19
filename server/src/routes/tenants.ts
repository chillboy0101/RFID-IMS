import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { AuthSessionModel } from "../models/AuthSession.js";
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

router.get("/:id/sessions", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
  const sessions = await AuthSessionModel.find({
    lastSeenTenantId: tenant._id,
    revokedAt: { $exists: false },
    lastSeenAt: { $gte: since },
  })
    .sort({ lastSeenAt: -1 })
    .limit(200)
    .exec();

  const userIds = Array.from(new Set(sessions.map((s) => String(s.userId))));
  const users = await UserModel.find({ _id: { $in: userIds } }).select({ name: 1, email: 1, role: 1 }).exec();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  res.json({
    ok: true,
    tenant: { id: tenant._id.toString(), name: tenant.name, slug: tenant.slug },
    sessions: sessions.map((s) => {
      const u = userById.get(String(s.userId));
      return {
        jti: s.jti,
        userId: String(s.userId),
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        isCurrent: Boolean(auth.jti && String(auth.jti) === String(s.jti)),
        user: u ? { id: u._id.toString(), name: u.name, email: u.email, role: u.role } : null,
      };
    }),
  });
});

router.post("/:id/sessions/:jti/revoke", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const { id, jti } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const cleanJti = String(jti ?? "").trim();
  if (!cleanJti) {
    res.status(400).json({ ok: false, error: "Invalid jti" });
    return;
  }

  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  if (auth.jti && String(auth.jti) === String(cleanJti)) {
    res.status(400).json({ ok: false, error: "Cannot sign out the current session" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const session = await AuthSessionModel.findOne({ jti: cleanJti }).exec();
  if (!session) {
    res.status(404).json({ ok: false, error: "Session not found" });
    return;
  }

  if (String(session.lastSeenTenantId ?? "") !== String(tenant._id)) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  if (!session.revokedAt) {
    session.revokedAt = new Date();
    const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? "equalizerjr@gmail.com").toLowerCase().trim();
    const actor = await UserModel.findById(auth.id).select({ email: 1 }).exec();
    const actorEmail = String((actor as any)?.email ?? "").toLowerCase().trim();
    (session as any).revokedByUserId = auth.id;
    (session as any).revokedByRole = actorEmail && actorEmail === superAdminEmail ? "super_admin" : "admin";
    await session.save();
  }

  res.json({ ok: true });
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

router.post("/:id/members", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const { userId, email, role, makeSuperAdmin } = req.body as { userId?: string; email?: string; role?: UserRole; makeSuperAdmin?: boolean };

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

  if (Boolean(makeSuperAdmin)) {
    const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? "equalizerjr@gmail.com").toLowerCase().trim();
    const actor = await UserModel.findById(auth.id).select({ email: 1 }).exec();
    const actorEmail = String((actor as any)?.email ?? "").toLowerCase().trim();
    if (!actorEmail || actorEmail !== superAdminEmail) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }
    if (String(user.role) !== "admin") {
      user.role = "admin";
      await user.save();
    }
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

  res.status(201).json({
    ok: true,
    membership: { tenantId: String(membership.tenantId), userId: String(membership.userId), role: membership.role },
  });
});

router.post("/:id/users", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const { name, email, password, role, makeSuperAdmin } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
    makeSuperAdmin?: boolean;
  };
  const cleanEmail = String(email ?? "").toLowerCase().trim();
  const cleanName = String(name ?? "").trim();
  const cleanPassword = String(password ?? "");
  const memberRole = role && userRoles.includes(role) ? role : ("inventory_staff" as UserRole);

  if (!cleanName || !cleanEmail || !cleanPassword) {
    res.status(400).json({ ok: false, error: "name, email and password are required" });
    return;
  }

  const existing = await UserModel.findOne({ email: cleanEmail }).exec();
  if (existing) {
    res.status(409).json({ ok: false, error: "Email already in use" });
    return;
  }

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? "equalizerjr@gmail.com").toLowerCase().trim();
  const actor = await UserModel.findById(auth.id).select({ email: 1 }).exec();
  const actorEmail = String((actor as any)?.email ?? "").toLowerCase().trim();
  const canMakeSuperAdmin = Boolean(makeSuperAdmin) && actorEmail && actorEmail === superAdminEmail;

  const passwordHash = await bcrypt.hash(cleanPassword, 12);
  const user = await UserModel.create({
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    mustChangePassword: true,
    ...(canMakeSuperAdmin ? { role: "admin" } : null),
  });

  await TenantMembershipModel.findOneAndUpdate(
    { tenantId: tenant._id, userId: user._id },
    { $set: { role: memberRole } },
    { upsert: true, new: true }
  ).exec();

  await TenantAuditLogModel.create({
    tenantId: tenant._id,
    actorUserId: auth.id,
    type: "membership_add",
    targetUserId: user._id,
    toRole: memberRole,
  });

  res.status(201).json({
    ok: true,
    user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role },
    membership: { tenantId: tenant._id.toString(), userId: user._id.toString(), role: memberRole },
  });
});

router.post("/:id/invites", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const tenant = await TenantModel.findById(id).exec();
  if (!tenant) {
    res.status(404).json({ ok: false, error: "Tenant not found" });
    return;
  }

  const { email, role, expiresInDays, makeSuperAdmin } = req.body as {
    email?: string;
    role?: UserRole;
    expiresInDays?: number;
    makeSuperAdmin?: boolean;
  };

  const cleanEmail = email ? email.toLowerCase().trim() : "";
  if (!cleanEmail) {
    res.status(400).json({ ok: false, error: "email is required" });
    return;
  }
  const effectiveRole = role && userRoles.includes(role) ? role : undefined;
  const days = typeof expiresInDays === "number" && expiresInDays > 0 ? expiresInDays : 14;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  let canMakeSuperAdmin = false;
  if (Boolean(makeSuperAdmin)) {
    const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? "equalizerjr@gmail.com").toLowerCase().trim();
    const actor = await UserModel.findById(auth.id).select({ email: 1 }).exec();
    const actorEmail = String((actor as any)?.email ?? "").toLowerCase().trim();
    canMakeSuperAdmin = Boolean(actorEmail && actorEmail === superAdminEmail);
    if (!canMakeSuperAdmin) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }
  }

  const code = crypto.randomBytes(16).toString("hex");

  const invite = await InviteModel.create({
    code,
    tenantId: tenant._id,
    email: cleanEmail,
    role: effectiveRole,
    ...(canMakeSuperAdmin ? { makeSuperAdmin: true } : null),
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

router.get("/:id/members", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const { id } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

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

router.delete("/:id/members/:userId", requireTenant, requireRole("admin"), async (req: TenantRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { id, userId } = req.params;
  const tenantId = req.tenantId as string;
  if (String(tenantId) !== String(id)) {
    res.status(400).json({ ok: false, error: "X-Tenant-ID must match :id" });
    return;
  }

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
