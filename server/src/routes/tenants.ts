import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { setAuditContext } from "../middleware/audit.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { AuthSessionModel } from "../models/AuthSession.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantMembershipModel } from "../models/TenantMembership.js";
import { UserModel, userRoles, type UserRole } from "../models/User.js";
import { resolveAppBaseUrl } from "../utils/appUrl.js";
import { buildProvisionedAccountEmail, sendEmail } from "../utils/email.js";

const router = express.Router();

function createTemporaryPassword(): string {
  return `VDL-${crypto.randomBytes(6).toString("base64url")}`;
}

type CreatedTenantUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

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
    $or: [{ revokedAt: { $exists: false } }, { revokedAt: null }],
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

  setAuditContext(res, {
    type: "tenants.session.revoke",
    category: "tenants",
    entityType: "session",
    entityId: cleanJti,
    summary: "Revoked tenant session",
    targetUserId: String(session.userId),
    metadata: {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    },
  });

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

  const membershipChanged = !existing || String(existing.role) !== String(membership.role);
  setAuditContext(res, {
    type: !existing ? "tenants.membership.add" : membershipChanged ? "tenants.membership.role_change" : "tenants.membership.upsert",
    category: "tenants",
    entityType: "tenant_membership",
    entityId: `${tenant._id.toString()}:${user._id.toString()}`,
    entityLabel: `${user.name} (${user.email})`,
    summary: !existing
      ? `Added ${user.name} to ${tenant.name}`
      : membershipChanged
        ? `Changed ${user.name} membership role`
        : `Updated ${user.name} membership`,
    targetUserId: user._id.toString(),
    fromRole: existing?.role,
    toRole: membership.role,
    metadata: {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    },
  });

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

  const { name, email, role, makeSuperAdmin } = req.body as {
    name?: string;
    email?: string;
    role?: UserRole;
    makeSuperAdmin?: boolean;
  };
  const cleanEmail = String(email ?? "").toLowerCase().trim();
  const cleanName = String(name ?? "").trim();
  const memberRole = role && userRoles.includes(role) ? role : ("inventory_staff" as UserRole);

  if (!cleanName || !cleanEmail) {
    res.status(400).json({ ok: false, error: "name and email are required" });
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

  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  const session = await mongoose.startSession();
  let userId: string | null = null;
  let createdUser: CreatedTenantUser | null = null;

  try {
    await session.withTransaction(async () => {
      const userDocs = await UserModel.create(
        [
          {
            name: cleanName,
            email: cleanEmail,
            passwordHash,
            emailVerified: true,
            mustChangePassword: true,
            ...(canMakeSuperAdmin ? { role: "admin" } : null),
          },
        ],
        { session }
      );

      const user = userDocs[0]!;
      userId = user._id.toString();
      createdUser = {
        id: userId,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
      };

      await TenantMembershipModel.findOneAndUpdate(
        { tenantId: tenant._id, userId: user._id },
        { $set: { role: memberRole } },
        { upsert: true, new: true, session }
      ).exec();
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Failed to create user" });
    return;
  } finally {
    await session.endSession();
  }

  if (!createdUser || !userId) {
    res.status(500).json({ ok: false, error: "Failed to create user" });
    return;
  }
  const provisionedUser = createdUser as CreatedTenantUser;

  const appBaseUrl = resolveAppBaseUrl(req) ?? "http://localhost:8081";
  const loginUrl = `${appBaseUrl}/login`;
  const emailMessage = buildProvisionedAccountEmail({
    email: cleanEmail,
    loginUrl,
    roleLabel: canMakeSuperAdmin ? "super_admin" : memberRole,
    temporaryPassword,
    tenantName: tenant.name,
  });
  const emailSent = await sendEmail({
    to: cleanEmail,
    subject: emailMessage.subject,
    html: emailMessage.html,
    text: emailMessage.text,
  });

  if (!emailSent) {
    await Promise.all([
      TenantMembershipModel.deleteMany({ tenantId: tenant._id, userId }).exec(),
      UserModel.deleteOne({ _id: userId }).exec(),
    ]);
    res.status(502).json({
      ok: false,
      error: "User account was not created because the temporary password email could not be delivered.",
    });
    return;
  }

  setAuditContext(res, {
    type: "tenants.user.create",
    category: "tenants",
    entityType: "user",
    entityId: provisionedUser.id,
    entityLabel: `${provisionedUser.name} (${provisionedUser.email})`,
    summary: `Created ${provisionedUser.name} in ${tenant.name}`,
    targetUserId: provisionedUser.id,
    toRole: memberRole,
    metadata: {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      membershipRole: memberRole,
      notification: "email",
    },
  });

  res.status(201).json({
    ok: true,
    user: provisionedUser,
    membership: { tenantId: tenant._id.toString(), userId: provisionedUser.id, role: memberRole },
    notification: { email: cleanEmail, delivered: true },
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

  const targetUser = await UserModel.findById(userId).select({ name: 1, email: 1 }).exec();
  setAuditContext(res, {
    type: "tenants.membership.remove",
    category: "tenants",
    entityType: "tenant_membership",
    entityId: `${tenant._id.toString()}:${userId}`,
    entityLabel: targetUser ? `${targetUser.name} (${targetUser.email})` : userId,
    summary: targetUser ? `Removed ${targetUser.name} from ${tenant.name}` : "Removed tenant membership",
    targetUserId: userId,
    fromRole: membership.role,
    metadata: {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    },
  });

  res.json({ ok: true });
});

export default router;
