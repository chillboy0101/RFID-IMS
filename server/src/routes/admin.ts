import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { FeedbackModel } from "../models/Feedback.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { InviteModel } from "../models/Invite.js";
import { OrderModel } from "../models/Order.js";
import { ReorderRequestModel } from "../models/ReorderRequest.js";
import { RfidEventModel } from "../models/RfidEvent.js";
import { TaskSessionModel } from "../models/TaskSession.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantAuditLogModel } from "../models/TenantAuditLog.js";
import { TenantMembershipModel } from "../models/TenantMembership.js";
import { UserModel, userRoles, type UserRole, type UserDocument } from "../models/User.js";
import { VendorModel } from "../models/Vendor.js";
import { getPagination } from "../utils/pagination.js";
import { asObjectId, asString } from "../utils/validate.js";

const router = express.Router();

router.use(requireAuth);

router.post("/bootstrap", async (req: AuthRequest, res) => {
  const setupToken = req.header("x-admin-setup-token") ?? "";
  const expected = process.env.ADMIN_SETUP_TOKEN;

  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_SETUP_TOKEN is not configured" });
    return;
  }

  if (setupToken !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const existingAdmin = await UserModel.findOne({ role: "admin" }).exec();
  if (existingAdmin) {
    res.status(409).json({ ok: false, error: "Admin already exists" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const userIdR = asObjectId(body.userId, { field: "userId" });
  if (!userIdR.ok) {
    res.status(400).json({ ok: false, error: userIdR.error });
    return;
  }
  const emailR = asString(body.email, { field: "email", trim: true, lower: true, maxLen: 254 });
  if (!emailR.ok) {
    res.status(400).json({ ok: false, error: emailR.error });
    return;
  }
  const userId = userIdR.value;
  const email = emailR.value;

  let user: UserDocument | null = null;

  if (userId) {
    user = (await UserModel.findById(userId).exec()) as UserDocument | null;
  } else if (email) {
    user = (await UserModel.findOne({ email }).exec()) as UserDocument | null;
  } else {
    res.status(400).json({ ok: false, error: "Provide userId or email" });
    return;
  }

  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  user.role = "admin";
  await user.save();

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

router.post("/bootstrap-tenancy", requireRole("admin"), async (_req: AuthRequest, res) => {
  const setupToken = _req.header("x-admin-setup-token") ?? "";
  const expected = process.env.ADMIN_SETUP_TOKEN;

  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_SETUP_TOKEN is not configured" });
    return;
  }

  if (setupToken !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (_req.body ?? {}) as Record<string, unknown>;
  const nameR = asString(body.name, { field: "name", trim: true, maxLen: 80 });
  if (!nameR.ok) {
    res.status(400).json({ ok: false, error: nameR.error });
    return;
  }
  const slugR = asString(body.slug, { field: "slug", trim: true, lower: true, maxLen: 40 });
  if (!slugR.ok) {
    res.status(400).json({ ok: false, error: slugR.error });
    return;
  }

  const tenantName = (nameR.value ?? "Dome Branch").trim() || "Dome Branch";
  const tenantSlug = (slugR.value ?? "dome").toLowerCase().trim() || "dome";
  if (!/^[a-z0-9-]+$/.test(tenantSlug)) {
    res.status(400).json({ ok: false, error: "slug is invalid" });
    return;
  }

  const tenant = await TenantModel.findOneAndUpdate(
    { slug: tenantSlug },
    { $setOnInsert: { name: tenantName, slug: tenantSlug } },
    { upsert: true, new: true }
  ).exec();

  const users = await UserModel.find({}).select({ role: 1 }).exec();
  for (const u of users) {
    await TenantMembershipModel.findOneAndUpdate(
      { tenantId: tenant._id, userId: u._id },
      { $set: { role: u.role } },
      { upsert: true, new: true }
    ).exec();
  }

  const tenantId = tenant._id;

  const [items, vendors, logs, orders, reorders, feedback, events, sessions] = await Promise.all([
    InventoryItemModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    VendorModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    InventoryLogModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    OrderModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    ReorderRequestModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    FeedbackModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    RfidEventModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
    TaskSessionModel.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } }).exec(),
  ]);

  res.json({
    ok: true,
    tenant: { id: tenant._id.toString(), name: tenant.name, slug: tenant.slug },
    membershipsCreated: users.length,
    backfilled: {
      inventoryItems: (items as any).modifiedCount ?? 0,
      vendors: (vendors as any).modifiedCount ?? 0,
      inventoryLogs: (logs as any).modifiedCount ?? 0,
      orders: (orders as any).modifiedCount ?? 0,
      reorders: (reorders as any).modifiedCount ?? 0,
      feedback: (feedback as any).modifiedCount ?? 0,
      rfidEvents: (events as any).modifiedCount ?? 0,
      taskSessions: (sessions as any).modifiedCount ?? 0,
    },
  });
});

router.get("/users", requireRole("admin"), async (_req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(_req.query as Record<string, unknown>, { defaultLimit: 200, maxLimit: 500 });

  const docs = await UserModel.find({}).select({ name: 1, email: 1, role: 1 }).sort({ createdAt: 1 }).skip(skip).limit(limit + 1).exec();
  const hasMore = docs.length > limit;
  const users = (hasMore ? docs.slice(0, limit) : docs);

  res.json({
    ok: true,
    users: users.map((u) => ({ id: u._id.toString(), name: u.name, email: u.email, role: u.role })),
    page,
    limit,
    hasMore,
  });
});

router.get("/users-with-memberships", requireRole("admin"), async (_req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(_req.query as Record<string, unknown>, { defaultLimit: 200, maxLimit: 500 });

  const userDocs = await UserModel.find({}).select({ name: 1, email: 1, role: 1 }).sort({ createdAt: 1 }).skip(skip).limit(limit + 1).exec();
  const hasMore = userDocs.length > limit;
  const users = (hasMore ? userDocs.slice(0, limit) : userDocs);

  const userIds = users.map((u) => u._id);
  const memberships = await TenantMembershipModel.find({ userId: { $in: userIds } }).select({ userId: 1, tenantId: 1 }).exec();

  const allTenantIds = Array.from(new Set(memberships.map((m) => String(m.tenantId))));
  const tenants = await TenantModel.find({ _id: { $in: allTenantIds } }).select({ name: 1, slug: 1 }).exec();
  const tenantById = new Map(tenants.map((t) => [t._id.toString(), { id: t._id.toString(), name: t.name, slug: t.slug }]));

  const tenantIdsByUserId = new Map<string, string[]>();
  for (const m of memberships) {
    const userId = String(m.userId);
    const arr = tenantIdsByUserId.get(userId) ?? [];
    arr.push(String(m.tenantId));
    tenantIdsByUserId.set(userId, arr);
  }

  res.json({
    ok: true,
    users: users.map((u) => {
      const tenantIdsRaw = tenantIdsByUserId.get(u._id.toString()) ?? [];
      const tenantIds = Array.from(new Set(tenantIdsRaw));
      const tenantRefs = tenantIds.map((id) => tenantById.get(id)).filter(Boolean);
      return {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        tenantIds,
        tenantCount: tenantIds.length,
        tenants: tenantRefs,
      };
    }),
    page,
    limit,
    hasMore,
  });
});

router.patch("/users/:id/role", requireRole("admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }

  const { role } = req.body as { role?: UserRole };
  if (!role || !userRoles.includes(role)) {
    res.status(400).json({ ok: false, error: "Invalid role" });
    return;
  }

  const user = await UserModel.findByIdAndUpdate(id, { role }, { new: true }).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  await TenantMembershipModel.updateMany({ userId: user._id }, { $set: { role } }).exec();

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

router.delete("/users/:id", requireRole("admin"), async (req: AuthRequest, res) => {
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

  if (String(auth.id) === String(id)) {
    res.status(400).json({ ok: false, error: "Cannot delete your own account" });
    return;
  }

  const user = await UserModel.findById(id).select({ email: 1 }).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  const email = String(user.email ?? "").toLowerCase().trim();
  if (email === "equalizerjr@gmail.com") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  const userId = user._id;

  const [memberships, invitesCreated, invitesUsed, auditActor, auditTarget, orders, reorders, feedback, sessions, logs] =
    await Promise.all([
      TenantMembershipModel.deleteMany({ userId }).exec(),
      InviteModel.deleteMany({ createdByUserId: userId }).exec(),
      InviteModel.deleteMany({ usedByUserId: userId }).exec(),
      TenantAuditLogModel.deleteMany({ actorUserId: userId }).exec(),
      TenantAuditLogModel.deleteMany({ targetUserId: userId }).exec(),
      OrderModel.deleteMany({ createdByUserId: userId }).exec(),
      ReorderRequestModel.deleteMany({ requestedByUserId: userId }).exec(),
      FeedbackModel.deleteMany({ userId }).exec(),
      TaskSessionModel.deleteMany({ userId }).exec(),
      InventoryLogModel.deleteMany({ actorUserId: userId }).exec(),
    ]);

  await UserModel.deleteOne({ _id: userId }).exec();

  res.json({
    ok: true,
    deleted: {
      userId: userId.toString(),
      memberships: (memberships as any).deletedCount ?? 0,
      invitesCreated: (invitesCreated as any).deletedCount ?? 0,
      invitesUsed: (invitesUsed as any).deletedCount ?? 0,
      auditActor: (auditActor as any).deletedCount ?? 0,
      auditTarget: (auditTarget as any).deletedCount ?? 0,
      orders: (orders as any).deletedCount ?? 0,
      reorders: (reorders as any).deletedCount ?? 0,
      feedback: (feedback as any).deletedCount ?? 0,
      sessions: (sessions as any).deletedCount ?? 0,
      inventoryLogs: (logs as any).deletedCount ?? 0,
    },
  });
});

export default router;
