import express from "express";
import mongoose from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { TenantAuditLogModel } from "../models/TenantAuditLog.js";
import { UserModel } from "../models/User.js";
import { getPagination } from "../utils/pagination.js";

const router = express.Router();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function legacySummary(doc: any): string {
  switch (String(doc?.type ?? "")) {
    case "membership_add":
      return "Added tenant membership";
    case "membership_remove":
      return "Removed tenant membership";
    case "membership_role_change":
      return "Changed tenant membership role";
    default:
      return String(doc?.summary ?? "Recorded audit event");
  }
}

function legacyCategory(doc: any): string {
  if (typeof doc?.category === "string" && doc.category.trim()) {
    return doc.category.trim();
  }
  if (String(doc?.type ?? "").startsWith("membership_")) {
    return "tenants";
  }
  return "system";
}

function buildAuditFilter(
  tenantId: string | mongoose.Types.ObjectId,
  category: string,
  outcome: string,
  q: string,
  matchingUserIds: mongoose.Types.ObjectId[] = []
): Record<string, unknown> {
  const clauses: Array<Record<string, unknown>> = [{ tenantId }];

  if (category) {
    if (category === "tenants") {
      clauses.push({
        $or: [{ category: "tenants" }, { type: /^membership_/i }],
      });
    } else {
      clauses.push({ category });
    }
  }

  if (outcome === "failure") {
    clauses.push({ outcome: "failure" });
  } else if (outcome === "success") {
    clauses.push({
      $or: [{ outcome: "success" }, { outcome: { $exists: false } }, { outcome: null }],
    });
  }

  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    clauses.push({
      $or: [
        { summary: pattern },
        { type: pattern },
        { actorName: pattern },
        { actorEmail: pattern },
        { entityLabel: pattern },
        { entityId: pattern },
        { path: pattern },
        { routeKey: pattern },
        { requestId: pattern },
        { "metadata.kindLabel": pattern },
        { "metadata.routeLabel": pattern },
        ...(matchingUserIds.length
          ? [{ actorUserId: { $in: matchingUserIds } }, { targetUserId: { $in: matchingUserIds } }]
          : []),
      ],
    });
  }

  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}

router.use(requireAuth);
router.use(requireTenant);
router.use(requireRole("admin"));

router.get("/", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { page, limit, skip } = getPagination(req.query as Record<string, unknown>, { defaultLimit: 50, maxLimit: 100 });

  const category = String(req.query.category ?? "").trim();
  const outcome = String(req.query.outcome ?? "").trim();
  const q = String(req.query.q ?? "").trim();
  const userPattern = q ? new RegExp(escapeRegex(q), "i") : null;
  const matchingUserIds = userPattern
    ? (
        await UserModel.find({
          $or: [{ name: userPattern }, { email: userPattern }],
        })
          .select({ _id: 1 })
          .limit(50)
          .lean()
          .exec()
      ).map((user) => new mongoose.Types.ObjectId(String(user._id)))
    : [];

  const filter = buildAuditFilter(tenantId, category, outcome, q, matchingUserIds);
  const aggregateFilter = buildAuditFilter(new mongoose.Types.ObjectId(tenantId), category, outcome, q, matchingUserIds);

  const [count, docs, aggregate] = await Promise.all([
    TenantAuditLogModel.countDocuments(filter).exec(),
    TenantAuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .populate([
        { path: "actorUserId", select: "name email role" },
        { path: "targetUserId", select: "name email role" },
      ])
      .exec(),
    TenantAuditLogModel.aggregate([
      { $match: aggregateFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          failures: {
            $sum: {
              $cond: [{ $eq: ["$outcome", "failure"] }, 1, 0],
            },
          },
          changes: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ["$method", ["POST", "PATCH", "PUT", "DELETE"]] },
                    { $in: ["$type", ["membership_add", "membership_remove", "membership_role_change"]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          actors: {
            $addToSet: {
              $ifNull: ["$actorEmail", { $ifNull: [{ $toString: "$actorUserId" }, "$actorName"] }],
            },
          },
        },
      },
    ]).exec(),
  ]);

  const hasMore = docs.length > limit;
  const events = (hasMore ? docs.slice(0, limit) : docs).map((doc: any) => {
    const actorUser = doc.actorUserId && typeof doc.actorUserId === "object" ? doc.actorUserId : null;
    const targetUser = doc.targetUserId && typeof doc.targetUserId === "object" ? doc.targetUserId : null;

    return {
      id: doc._id.toString(),
      createdAt: doc.createdAt,
      type: doc.type,
      category: legacyCategory(doc),
      summary: legacySummary(doc),
      fromRole: doc.fromRole ?? null,
      toRole: doc.toRole ?? null,
      actor: {
        id: actorUser?._id ? actorUser._id.toString() : doc.actorUserId ? String(doc.actorUserId) : null,
        name: doc.actorName ?? actorUser?.name ?? null,
        email: doc.actorEmail ?? actorUser?.email ?? null,
        role: doc.actorTenantRole ?? doc.actorRole ?? actorUser?.role ?? null,
        source: doc.actorSource ?? (doc.actorUserId ? "user" : "system"),
      },
      targetUser: targetUser
        ? {
            id: targetUser._id.toString(),
            name: targetUser.name,
            email: targetUser.email,
            role: targetUser.role,
          }
        : doc.targetUserId
          ? { id: String(doc.targetUserId) }
          : null,
      entity: {
        type: doc.entityType ?? null,
        id: doc.entityId ?? null,
        label: doc.entityLabel ?? null,
      },
      request: {
        method: doc.method ?? null,
        path: doc.path ?? null,
        routeKey: doc.routeKey ?? null,
        requestId: doc.requestId ?? null,
        statusCode: typeof doc.statusCode === "number" ? doc.statusCode : null,
        outcome: doc.outcome ?? null,
      },
      metadata: doc.metadata ?? null,
    };
  });

  const summary = aggregate[0] ?? { total: 0, failures: 0, changes: 0, actors: [] };

  res.json({
    ok: true,
    events,
    page,
    limit,
    total: count,
    hasMore,
    summary: {
      total: Number(summary.total ?? 0),
      failures: Number(summary.failures ?? 0),
      changes: Number(summary.changes ?? 0),
      uniqueActors: Array.isArray(summary.actors) ? summary.actors.filter(Boolean).length : 0,
    },
  });
});

export default router;
