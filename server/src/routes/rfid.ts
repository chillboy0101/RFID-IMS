import crypto from "crypto";
import express from "express";
import mongoose from "mongoose";

import { setAuditContext } from "../middleware/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateKey, hashKey, requireGateApiKey, requireGateTenant, type GateRequest } from "../middleware/gate.js";
import { requireTenant, type TenantRequest } from "../middleware/tenant.js";
import { ExitAuthorizationModel } from "../models/ExitAuthorization.js";
import { ExitSessionModel } from "../models/ExitSession.js";
import { GateApiKeyModel } from "../models/GateApiKey.js";
import { InventoryItemModel, type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { InventoryUnitModel } from "../models/InventoryUnit.js";
import { OperatorSessionModel, type OperatorSessionDocument } from "../models/OperatorSession.js";
import { OrderModel } from "../models/Order.js";
import { RfidEventModel, rfidEventTypes, type RfidEventType } from "../models/RfidEvent.js";
import { RfidTagModel, upsertRfidTag } from "../models/RfidTag.js";
import { SecurityAlertModel } from "../models/SecurityAlert.js";
import { TenantMembershipModel, type TenantMembershipDocument } from "../models/TenantMembership.js";
import { UserModel, type UserDocument } from "../models/User.js";
import { buildInventoryFlowSummaryMap } from "../utils/inventoryFlow.js";
import { consumeExitAuthorization } from "../utils/orderFulfillment.js";

const router = express.Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeLocation(value: unknown, fallback = "EXIT_MAIN") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeExternalEventId(req: express.Request, body: Record<string, unknown>) {
  const fromBody = [body.eventId, body.readId, body.scanId, body.idempotencyKey]
    .find((value) => typeof value === "string" && value.trim());
  const fromHeader = req.header("x-event-id") ?? req.header("x-idempotency-key") ?? "";
  return (typeof fromBody === "string" ? fromBody : fromHeader).trim();
}

function normalizeHardwareEventId(req: express.Request, body: Record<string, unknown>) {
  const eventId = normalizeExternalEventId(req, body);
  if (!eventId) {
    return { ok: false as const, error: "eventId UUID is required" };
  }

  if (!uuidPattern.test(eventId)) {
    return { ok: false as const, error: "eventId must be a UUID" };
  }

  return { ok: true as const, eventId: eventId.toLowerCase() };
}

function resolveHardwareLocation(req: GateRequest, body: Record<string, unknown>, fallback: string) {
  const boundLocation = req.gateKeyLocationHint?.trim();
  if (boundLocation) return boundLocation;
  return normalizeLocation(body.location, fallback);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
}

function sortStationValues(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function isExitLocation(value: string) {
  return /(^|[_\s-])(EXIT|GATE|LOADING|REAR)([_\s-]|$)/i.test(value);
}

function normalizeScan(body: Record<string, unknown>, opts: { useServerObservedAt?: boolean } = {}) {
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const tagId = typeof body.tagId === "string" ? body.tagId.trim() : "";
  const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "rfid";
  const parsedObservedAt = typeof body.observedAt === "string" && body.observedAt.trim() ? new Date(body.observedAt) : null;
  const observedAt = opts.useServerObservedAt || !parsedObservedAt || !Number.isFinite(parsedObservedAt.getTime()) ? new Date() : parsedObservedAt;
  return { value, tagId, barcode, source, observedAt };
}

function resolveHardwareSource(req: express.Request, fallback: string) {
  const headerSource = req.header("x-source")?.trim();
  return headerSource || fallback;
}

function normalizeOperatorTagId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function generateOperatorToken(): { raw: string; prefix: string; hash: string } {
  const raw = `op_${crypto.randomBytes(24).toString("hex")}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashKey(raw) };
}

function resolveOperatorSessionToken(req: express.Request, body: Record<string, unknown>) {
  const fromHeader = String(req.header("x-operator-session") ?? req.header("X-Operator-Session") ?? "").trim();
  if (fromHeader) return fromHeader;

  const authorization = String(req.header("authorization") ?? "").trim();
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith("op_")) return bearer;

  const fromBody = [body.operatorSessionToken, body.operatorToken, body.token].find(
    (value) => typeof value === "string" && value.trim()
  );
  return typeof fromBody === "string" ? fromBody.trim() : "";
}

function redactHardwareRaw(body: Record<string, unknown>) {
  const raw = { ...body };
  delete raw.operatorSessionToken;
  delete raw.operatorToken;
  delete raw.token;
  return raw;
}

type HardwareOperatorContext = {
  session: OperatorSessionDocument;
  user: UserDocument;
  membership: TenantMembershipDocument;
};

async function resolveHardwareOperator(
  req: GateRequest,
  body: Record<string, unknown>
): Promise<{ ok: true; operator: HardwareOperatorContext } | { ok: false; status: number; error: string }> {
  const tenantId = req.tenantId as string;
  const rawToken = resolveOperatorSessionToken(req, body);
  if (!rawToken) {
    return { ok: false, status: 401, error: "X-Operator-Session or Authorization: Bearer op_... is required" };
  }

  const session = await OperatorSessionModel.findOne({
    tenantId,
    tokenPrefix: rawToken.slice(0, 12),
    tokenHash: hashKey(rawToken),
    $or: [{ endedAt: { $exists: false } }, { endedAt: null }],
    expiresAt: { $gt: new Date() },
  }).exec();

  if (!session) {
    return { ok: false, status: 401, error: "Invalid or expired operator session" };
  }

  if (req.gateKeyId && String(session.gateKeyId) !== String(req.gateKeyId)) {
    return { ok: false, status: 403, error: "Operator session belongs to a different RFID reader" };
  }

  const [user, membership] = await Promise.all([
    UserModel.findOne({ _id: session.userId, operatorTagId: session.operatorTagId }).exec() as Promise<UserDocument | null>,
    TenantMembershipModel.findOne({ tenantId, userId: session.userId }).exec() as Promise<TenantMembershipDocument | null>,
  ]);

  if (!user || !membership) {
    return { ok: false, status: 403, error: "Operator is not authorized for this branch" };
  }

  session.lastSeenAt = new Date();
  await session.save();

  return { ok: true, operator: { session, user, membership } };
}

function setHardwareOperatorAudit(res: express.Response, operator: HardwareOperatorContext, summary: string, metadata?: Record<string, unknown>) {
  setAuditContext(res, {
    actorSource: "hardware",
    actorUserId: operator.user._id.toString(),
    actorName: operator.user.name,
    actorEmail: operator.user.email,
    actorRole: operator.user.role,
    actorTenantRole: operator.membership.role,
    summary,
    metadata: {
      operatorTagId: operator.session.operatorTagId,
      operatorSessionId: operator.session._id.toString(),
      gateKeyName: operator.session.gateKeyName,
      ...(metadata ?? {}),
    },
  });
}

async function resolveItem(tenantId: string, identifiers: { itemId?: unknown; tagId?: string; barcode?: string }) {
  const itemId = typeof identifiers.itemId === "string" ? identifiers.itemId.trim() : "";
  if (itemId) {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new Error("Invalid itemId");
    }
    return (await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec()) as InventoryItemDocument | null;
  }

  if (identifiers.tagId) {
    return (await InventoryItemModel.findOne({ tenantId, rfidTagId: identifiers.tagId }).exec()) as InventoryItemDocument | null;
  }

  if (identifiers.barcode) {
    return (await InventoryItemModel.findOne({ tenantId, barcode: identifiers.barcode }).exec()) as InventoryItemDocument | null;
  }

  return null;
}

async function resolveReceivingItem(tenantId: string, body: Record<string, unknown>) {
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (itemId) {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new Error("Invalid itemId");
    }
    return (await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec()) as InventoryItemDocument | null;
  }

  const itemBarcode =
    typeof body.itemBarcode === "string" && body.itemBarcode.trim()
      ? body.itemBarcode.trim()
      : typeof body.productBarcode === "string" && body.productBarcode.trim()
        ? body.productBarcode.trim()
        : "";
  if (itemBarcode) {
    return (await InventoryItemModel.findOne({ tenantId, barcode: itemBarcode }).exec()) as InventoryItemDocument | null;
  }

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  if (sku) {
    return (await InventoryItemModel.findOne({ tenantId, sku }).exec()) as InventoryItemDocument | null;
  }

  return null;
}

async function resolveScanIdentity(opts: {
  tenantId: string;
  location: string;
  observedAt: Date;
  value?: string;
  tagId?: string;
  barcode?: string;
}) {
  const explicitTagId = opts.tagId?.trim() ?? "";
  const explicitBarcode = opts.barcode?.trim() ?? "";
  if (explicitTagId || explicitBarcode) {
    return {
      tagId: explicitTagId,
      barcode: explicitBarcode,
      mode: explicitTagId ? ("tagId" as const) : ("barcode" as const),
    };
  }

  const rawValue = opts.value?.trim() ?? "";
  if (!rawValue) {
    return { tagId: "", barcode: "", mode: "tagId" as const };
  }

  const activeAuthorization = await ExitAuthorizationModel.findOne({
    tenantId: opts.tenantId,
    location: opts.location,
    status: "active",
    expiresAt: { $gt: opts.observedAt },
    $or: [{ tagId: rawValue }, { barcode: rawValue }],
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .lean()
    .exec();

  if (activeAuthorization?.tagId === rawValue) {
    return { tagId: rawValue, barcode: "", mode: "tagId" as const };
  }

  if (activeAuthorization?.barcode === rawValue) {
    return { tagId: "", barcode: rawValue, mode: "barcode" as const };
  }

  const [tagRecord, barcodeItem] = await Promise.all([
    RfidTagModel.findOne({ tenantId: opts.tenantId, tagId: rawValue }).lean().exec(),
    InventoryItemModel.findOne({ tenantId: opts.tenantId, barcode: rawValue }).select({ _id: 1 }).lean().exec(),
  ]);

  if (tagRecord && !barcodeItem) {
    return { tagId: rawValue, barcode: "", mode: "tagId" as const };
  }

  if (!tagRecord && barcodeItem) {
    return { tagId: "", barcode: rawValue, mode: "barcode" as const };
  }

  return { tagId: rawValue, barcode: "", mode: "tagId" as const };
}

async function createSecurityAlert(opts: {
  tenantId: string;
  tagId?: string;
  barcode?: string;
  item?: InventoryItemDocument | null;
  location: string;
  source: string;
  observedAt: Date;
  eventId?: string;
}) {
  return SecurityAlertModel.create({
    tenantId: opts.tenantId,
    tagId: opts.tagId || undefined,
    barcode: opts.barcode || undefined,
    itemId: opts.item?._id,
    location: opts.location,
    source: opts.source,
    observedAt: opts.observedAt,
    status: "open",
    severity: "critical",
    message: "Unauthorized exit detection",
    meta: opts.eventId ? { rfidEventId: opts.eventId } : undefined,
  });
}

async function verifyExitScan(opts: {
  tenantId: string;
  tagId?: string;
  barcode?: string;
  location: string;
  source: string;
  observedAt: Date;
  actorUserId?: string;
  fallbackItem?: InventoryItemDocument | null;
}) {
  const identityFilter =
    opts.tagId
      ? { tagId: opts.tagId }
      : { barcode: opts.barcode };

  const authorization = await ExitAuthorizationModel.findOne({
    tenantId: opts.tenantId,
    ...identityFilter,
    location: opts.location,
    status: "active",
    expiresAt: { $gt: opts.observedAt },
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .exec();

  if (!authorization) {
    const alert = await createSecurityAlert({
      tenantId: opts.tenantId,
      tagId: opts.tagId,
      barcode: opts.barcode,
      item: opts.fallbackItem,
      location: opts.location,
      source: opts.source,
      observedAt: opts.observedAt,
    });

    return {
      authorized: false,
      decision: "DENY",
      item: opts.fallbackItem ?? null,
      order: null,
      remainingAuthorizations: 0,
      alert,
    };
  }

  const result = await consumeExitAuthorization({
    tenantId: opts.tenantId,
    authorization,
    fallbackItem: opts.fallbackItem ?? null,
    actorUserId: opts.actorUserId,
    source: opts.source,
    when: opts.observedAt,
  });

  return {
    authorized: true,
    decision: "ALLOW",
    item: result.item,
    order: result.order,
    remainingAuthorizations: result.remainingAuthorizations,
    alert: null,
    authorizationId: authorization._id.toString(),
  };
}

router.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    hardware: {
      staffAuthScan: {
        endpoint: "POST /rfid/operator-sessions",
        headers: {
          "X-Gate-Api-Key": "Required reader/station API key",
          "X-Source": "Optional reader/source label",
        },
        payload: {
          operatorTagId: "string (required staff RFID card/tag EPC)",
          location: "string, optional when key is not bound to a location",
          source: "string, optional reader label",
        },
        response: {
          operatorSessionToken: "Short-lived token. Send as X-Operator-Session or Authorization: Bearer op_...",
          expiresAt: "ISO timestamp",
          operator: "Matched system user for the scanned staff card",
        },
      },
      fixedGateReader: {
        endpoint: "POST /rfid/gate-events",
        headers: {
          "X-Gate-Api-Key": "Required gate API key",
          "X-Operator-Session": "Required short-lived token from POST /rfid/operator-sessions",
          "X-Source": "Optional reader/source label",
          "X-Event-ID": "Required UUID for retry-safe idempotency",
        },
        payload: {
          tagId: "string (recommended for RFID reads)",
          value: "string (single autonomous scan value; server auto-detects RFID vs barcode)",
          barcode: "string (optional barcode fallback)",
          eventId: "UUID string; same value as X-Event-ID when sent in body",
          location: "string, optional when key is not bound to a location",
          source: "string, default rfid",
          itemId: "Mongo ObjectId, optional manual override",
        },
      },
      receivingReader: {
        endpoint: "POST /rfid/receiving-events",
        headers: {
          "X-Gate-Api-Key": "Required station API key",
          "X-Operator-Session": "Required short-lived token from POST /rfid/operator-sessions",
          "X-Source": "Optional reader/source label",
          "X-Event-ID": "Required UUID for retry-safe idempotency",
        },
        payload: {
          tagId: "string (required RFID tag/EPC unless value is supplied)",
          value: "string (RFID tag/EPC fallback)",
          eventId: "UUID string; same value as X-Event-ID when sent in body",
          itemId: "Mongo ObjectId, optional",
          itemBarcode: "string, product barcode/SKU scan from receiving workflow",
          sku: "string, optional item SKU fallback",
          location: "string, optional when key is not bound to a location",
          source: "string, default rfid",
        },
      },
      operatorExitSession: {
        requestSession: "POST /rfid/exit-sessions",
        verifyScan: "POST /rfid/exit-sessions/verify",
        auth: "Bearer JWT + X-Tenant-ID",
        verifyPayload: {
          value: "string (single autonomous scan value; server auto-detects RFID vs barcode)",
          token: "short-lived exit session token",
          tagId: "string (preferred)",
          barcode: "string (fallback)",
        },
      },
      tagRegistry: {
        list: "GET /rfid/tags",
        get: "GET /rfid/tags/:tagId",
        reassign: "PATCH /rfid/tags/:tagId",
        activate: "POST /rfid/tags/:tagId/activate",
        deactivate: "POST /rfid/tags/:tagId/deactivate",
        removeAssignment: "DELETE /rfid/tags/:tagId",
      },
    },
  });
});

router.post("/operator-sessions", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const operatorTagId = normalizeOperatorTagId(body.operatorTagId ?? body.tagId ?? body.value);
  const observedAt = new Date();
  const source = typeof body.source === "string" && body.source.trim()
    ? body.source.trim()
    : String(req.header("x-source") ?? "").trim() || "rfid";
  const location = resolveHardwareLocation(req, body, "EXIT_MAIN");
  const minutes = Math.min(120, Math.max(1, typeof body.minutes === "number" ? Math.floor(body.minutes) : 30));

  if (!operatorTagId) {
    res.status(400).json({ ok: false, error: "operatorTagId is required" });
    return;
  }

  if (!req.gateKeyId) {
    res.status(401).json({ ok: false, error: "Invalid gate key context" });
    return;
  }

  const user = (await UserModel.findOne({ operatorTagId }).exec()) as UserDocument | null;
  if (!user) {
    res.status(404).json({ ok: false, error: "Staff RFID card is not assigned to a user" });
    return;
  }

  const membership = (await TenantMembershipModel.findOne({ tenantId, userId: user._id }).exec()) as TenantMembershipDocument | null;
  if (!membership) {
    res.status(403).json({ ok: false, error: "User is not authorized for this branch" });
    return;
  }

  const { raw, prefix, hash } = generateOperatorToken();
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const session = await OperatorSessionModel.create({
    tenantId,
    userId: user._id,
    gateKeyId: req.gateKeyId,
    gateKeyName: req.gateKeyName,
    location,
    source,
    operatorTagId,
    tokenPrefix: prefix,
    tokenHash: hash,
    startedAt: observedAt,
    lastSeenAt: observedAt,
    expiresAt,
  });

  setAuditContext(res, {
    actorSource: "hardware",
    actorUserId: user._id.toString(),
    actorName: user.name,
    actorEmail: user.email,
    actorRole: user.role,
    actorTenantRole: membership.role,
    type: "rfid.operator_session.create",
    category: "rfid",
    entityType: "operator_session",
    entityId: session._id.toString(),
    entityLabel: `${user.name} at ${location}`,
    summary: "Authorized RFID device user",
    targetUserId: user._id.toString(),
    metadata: {
      operatorTagId,
      gateKeyName: req.gateKeyName,
      location,
      source,
      observedAt,
      expiresAt,
    },
  });

  res.status(201).json({
    ok: true,
    operatorSession: {
      id: session._id.toString(),
      token: raw,
      operatorSessionToken: raw,
      expiresAt,
      location,
      source,
      operator: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: membership.role,
      },
    },
  });
});

router.delete("/operator-sessions/:token", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;
  const rawToken = String(req.params.token ?? "").trim();
  if (!rawToken) {
    res.status(400).json({ ok: false, error: "token is required" });
    return;
  }

  const session = await OperatorSessionModel.findOneAndUpdate(
    {
      tenantId,
      tokenPrefix: rawToken.slice(0, 12),
      tokenHash: hashKey(rawToken),
      ...(req.gateKeyId ? { gateKeyId: req.gateKeyId } : {}),
      $or: [{ endedAt: { $exists: false } }, { endedAt: null }],
    },
    { $set: { endedAt: new Date(), lastSeenAt: new Date() } },
    { new: true }
  ).exec();

  if (!session) {
    res.status(404).json({ ok: false, error: "Operator session not found or already ended" });
    return;
  }

  setAuditContext(res, {
    actorSource: "hardware",
    actorUserId: session.userId.toString(),
    type: "rfid.operator_session.end",
    category: "rfid",
    entityType: "operator_session",
    entityId: session._id.toString(),
    summary: "Ended RFID operator session",
    metadata: {
      operatorTagId: session.operatorTagId,
      gateKeyName: session.gateKeyName,
      location: session.location,
    },
  });

  res.json({ ok: true, ended: { id: session._id.toString(), endedAt: session.endedAt } });
});

router.post("/receiving-events", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { value, tagId: rawTagId, source: bodySource, observedAt } = normalizeScan(body, { useServerObservedAt: true });
  const source = resolveHardwareSource(req, bodySource);
  const tagId = rawTagId || value;
  const eventIdResult = normalizeHardwareEventId(req, body);
  if (!eventIdResult.ok) {
    res.status(400).json({ ok: false, error: eventIdResult.error });
    return;
  }
  const eventId = eventIdResult.eventId;
  const location = resolveHardwareLocation(req, body, "RECEIVING_STAGING");

  if (!tagId) {
    res.status(400).json({ ok: false, error: "tagId or value is required" });
    return;
  }

  const operatorResult = await resolveHardwareOperator(req, body);
  if (!operatorResult.ok) {
    res.status(operatorResult.status).json({ ok: false, error: operatorResult.error });
    return;
  }
  const operator = operatorResult.operator;

  if (isExitLocation(location)) {
    res.status(400).json({ ok: false, error: "Receiving events must use a receiving/storage location, not an exit gate" });
    return;
  }

  const staffCardConflict = await UserModel.exists({ operatorTagId: tagId }).exec();
  if (staffCardConflict) {
    res.status(409).json({ ok: false, error: "RFID tag is assigned to a staff user card and cannot be received as inventory" });
    return;
  }

  const duplicate = await RfidEventModel.findOne({ tenantId, eventId }).exec();
  if (duplicate) {
    res.json({ ok: true, duplicate: true, processed: false, event: duplicate });
    return;
  }

  let item: InventoryItemDocument | null = null;
  try {
    item = await resolveReceivingItem(tenantId, body);
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid receiving item" });
    return;
  }

  if (!item) {
    res.status(404).json({ ok: false, error: "Receiving item not found. Send itemId, itemBarcode, or sku." });
    return;
  }

  if ((item.status ?? "active").trim().toLowerCase() === "inactive") {
    res.status(409).json({ ok: false, error: "Cannot receive stock into an inactive item" });
    return;
  }

  const existingUnit = await InventoryUnitModel.findOne({ tenantId, tagId }).select({ _id: 1, itemId: 1 }).exec();
  if (existingUnit) {
    res.status(409).json({ ok: false, error: "RFID tag already exists" });
    return;
  }

  const event = await RfidEventModel.create({
    tenantId,
    eventId,
    tagId,
    eventType: "scan",
    itemId: item._id,
    actorUserId: operator.user._id,
    operatorSessionId: operator.session._id,
    operatorTagId: operator.session.operatorTagId,
    gateKeyName: req.gateKeyName,
    location,
    observedAt,
    source,
    raw: redactHardwareRaw(body),
  });

  const unit = await InventoryUnitModel.create({
    tenantId,
    itemId: item._id,
    tagId,
    location,
    status: "in_stock",
  });

  const previousQuantity = item.quantity;
  item.quantity = previousQuantity + 1;
  item.location = item.location || location;
  item.rfidTagId = tagId;
  await item.save();
  await upsertRfidTag(tenantId, tagId, item);

  await InventoryLogModel.create({
    tenantId,
    itemId: item._id,
    action: "add",
    delta: 1,
    previousQuantity,
    newQuantity: item.quantity,
    actorUserId: operator.user._id,
    reason: "RFID hardware receiving",
    meta: {
      location,
      tagId,
      unitId: unit._id.toString(),
      rfidEventId: event._id.toString(),
      eventId,
      operatorSessionId: operator.session._id.toString(),
      operatorTagId: operator.session.operatorTagId,
      gateKeyName: req.gateKeyName,
    },
  });

  setHardwareOperatorAudit(res, operator, "Captured receiving reader event", {
    itemId: item._id.toString(),
    itemSku: item.sku,
    tagId,
    location,
    rfidEventId: event._id.toString(),
  });

  const flow = (await buildInventoryFlowSummaryMap(tenantId, [item])).get(item._id.toString());
  res.status(201).json({ ok: true, processed: true, event, item: { ...item.toObject(), flow }, unit });
});

router.post("/gate-events", requireGateApiKey, requireGateTenant, async (req: GateRequest, res) => {
  const tenantId = req.tenantId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { value, tagId: rawTagId, barcode: rawBarcode, source: bodySource, observedAt } = normalizeScan(body, { useServerObservedAt: true });
  const source = resolveHardwareSource(req, bodySource);
  const eventIdResult = normalizeHardwareEventId(req, body);
  if (!eventIdResult.ok) {
    res.status(400).json({ ok: false, error: eventIdResult.error });
    return;
  }
  const eventId = eventIdResult.eventId;
  const location = resolveHardwareLocation(req, body, "EXIT_MAIN");
  const decisionAt = new Date();

  if (!isExitLocation(location)) {
    res.status(400).json({ ok: false, error: "Gate events must use an exit gate location" });
    return;
  }

  const operatorResult = await resolveHardwareOperator(req, body);
  if (!operatorResult.ok) {
    res.status(operatorResult.status).json({ ok: false, error: operatorResult.error });
    return;
  }
  const operator = operatorResult.operator;

  const duplicate = await RfidEventModel.findOne({ tenantId, eventId }).exec();
  if (duplicate) {
    res.json({ ok: true, duplicate: true, processed: false, event: duplicate });
    return;
  }

  const { tagId, barcode, mode } = await resolveScanIdentity({
    tenantId,
    location,
    observedAt: decisionAt,
    value,
    tagId: rawTagId,
    barcode: rawBarcode,
  });

  if (!tagId && !barcode) {
    res.status(400).json({ ok: false, error: "value, tagId, or barcode is required" });
    return;
  }

  let item: InventoryItemDocument | null = null;
  try {
    item = await resolveItem(tenantId, { itemId: body.itemId, tagId, barcode });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid itemId" });
    return;
  }

  const event = await RfidEventModel.create({
    tenantId,
    eventId,
    tagId: tagId || barcode || value,
    eventType: "scan",
    itemId: item?._id,
    actorUserId: operator.user._id,
    operatorSessionId: operator.session._id,
    operatorTagId: operator.session.operatorTagId,
    gateKeyName: req.gateKeyName,
    location,
    observedAt,
    source,
    raw: redactHardwareRaw(body),
  });

  const result = await verifyExitScan({
    tenantId,
    tagId: tagId || undefined,
    barcode: barcode || undefined,
    location,
    source,
    observedAt: decisionAt,
    actorUserId: operator.user._id.toString(),
    fallbackItem: item,
  });

  event.raw = {
    ...(typeof event.raw === "object" && event.raw ? (event.raw as Record<string, unknown>) : {}),
    decision: result.decision,
    authorized: result.authorized,
    authorizationId: result.authorizationId,
    operatorSessionId: operator.session._id.toString(),
    operatorTagId: operator.session.operatorTagId,
    actorUserId: operator.user._id.toString(),
  };
  await event.save();

  if (!result.authorized && result.alert) {
    result.alert.meta = { ...(result.alert.meta ?? {}), rfidEventId: event._id.toString() };
    await result.alert.save();
  }

  setHardwareOperatorAudit(res, operator, "Captured gate reader event", {
    decision: result.decision,
    authorized: result.authorized,
    authorizationId: result.authorizationId,
    itemId: result.item?._id?.toString(),
    orderId: result.order?._id?.toString(),
    tagId: tagId || undefined,
    barcode: barcode || undefined,
    location,
    rfidEventId: event._id.toString(),
  });

  res.json({
    ok: true,
    mode,
    decision: result.decision,
    authorized: result.authorized,
    authorizationId: result.authorizationId,
    remainingAuthorizations: result.remainingAuthorizations,
    event,
    operator: {
      id: operator.user._id.toString(),
      name: operator.user.name,
      email: operator.user.email,
      role: operator.membership.role,
    },
    item: result.item,
    order: result.order,
    alert: result.alert,
  });
});

router.use(requireAuth);
router.use(requireTenant);

router.get("/stations", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;

  const [itemLocations, unitLocations, eventLocations, orderLocations, exitLocations, gateHints, alertLocations] = await Promise.all([
    InventoryItemModel.distinct("location", { tenantId }),
    InventoryUnitModel.distinct("location", { tenantId }),
    RfidEventModel.distinct("location", { tenantId }),
    OrderModel.distinct("authorizationLocation", { tenantId }),
    ExitAuthorizationModel.distinct("location", { tenantId }),
    GateApiKeyModel.distinct("locationHint", { tenantId }),
    SecurityAlertModel.distinct("location", { tenantId }),
  ]);

  const allLocations = uniqueStrings([
    ...itemLocations,
    ...unitLocations,
    ...eventLocations,
    ...orderLocations,
    ...exitLocations,
    ...gateHints,
    ...alertLocations,
  ]);

  const receiveLocations = sortStationValues(
    uniqueStrings([...itemLocations, ...unitLocations, ...eventLocations]).filter((value) => !isExitLocation(value))
  );

  const gateLocations = sortStationValues(
    uniqueStrings([
      ...gateHints,
      ...orderLocations,
      ...exitLocations,
      ...alertLocations,
      ...allLocations.filter((value) => isExitLocation(value)),
    ])
  );

  const defaultReceiveLocation = receiveLocations[0] ?? sortStationValues(allLocations.filter((value) => !isExitLocation(value)))[0] ?? "RECEIVING_STAGING";
  const defaultGateLocation = gateLocations[0] ?? "EXIT_MAIN";

  res.json({
    ok: true,
    stations: {
      receiveLocations: receiveLocations.length ? receiveLocations : [defaultReceiveLocation],
      gateLocations: gateLocations.length ? gateLocations : [defaultGateLocation],
      windowMinutes: [5, 10, 15],
      defaults: {
        receiveLocation: defaultReceiveLocation,
        gateLocation: defaultGateLocation,
        windowMinutes: 10,
      },
    },
  });
});

router.get("/events/latest", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const location = (req.query.location as string | undefined)?.trim();
  const filter: Record<string, unknown> = { tenantId };
  if (location) filter.location = location;

  const event = await RfidEventModel.findOne(filter).sort({ observedAt: -1 }).limit(1).exec();
  res.json({ ok: true, event: event ?? null });
});

router.post("/events", async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { tagId, barcode, source, observedAt } = normalizeScan(body);
  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : undefined;
  const delta = typeof body.delta === "number" && Number.isFinite(body.delta) ? body.delta : undefined;
  const eventType = (typeof body.eventType === "string" ? body.eventType : "scan") as RfidEventType;

  if (!tagId && !barcode) {
    res.status(400).json({ ok: false, error: "tagId or barcode is required" });
    return;
  }
  if (!rfidEventTypes.includes(eventType)) {
    res.status(400).json({ ok: false, error: "Invalid eventType" });
    return;
  }

  let item: InventoryItemDocument | null = null;
  try {
    item = await resolveItem(tenantId, { itemId: body.itemId, tagId, barcode });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid itemId" });
    return;
  }

  const event = await RfidEventModel.create({
    tenantId,
    tagId: tagId || barcode,
    eventType,
    itemId: item?._id,
    location,
    delta,
    observedAt,
    source,
    raw: req.body,
  });

  if (!item) {
    res.status(202).json({ ok: true, processed: false, event });
    return;
  }

  let wroteLog = false;
  if (location && location !== (item.location ?? "")) {
    const previousLocation = item.location;
    item.location = location;
    await item.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: item._id,
      action: "update",
      actorUserId: auth.id,
      newQuantity: item.quantity,
      reason: "RFID location update",
      meta: { previousLocation, newLocation: location, rfidEventId: event._id.toString() },
    });
    wroteLog = true;
  }

  if (typeof delta === "number" && delta !== 0) {
    const previousQuantity = item.quantity;
    const nextQuantity = previousQuantity + delta;
    if (nextQuantity < 0) {
      res.status(409).json({ ok: false, error: "Insufficient stock for RFID delta" });
      return;
    }

    item.quantity = nextQuantity;
    await item.save();

    await InventoryLogModel.create({
      tenantId,
      itemId: item._id,
      action: "adjust",
      delta,
      previousQuantity,
      newQuantity: nextQuantity,
      actorUserId: auth.id,
      reason: "RFID quantity adjustment",
      meta: { rfidEventId: event._id.toString(), eventType },
    });
    wroteLog = true;
  }

  res.json({ ok: true, processed: true, wroteLog, event, item });
});

router.post("/exit-sessions", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const location = normalizeLocation(body.location);
  const minutes = Math.min(15, Math.max(1, typeof body.minutes === "number" ? Math.floor(body.minutes) : 5));
  const orderId = typeof body.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : "";

  if (orderId && !mongoose.isValidObjectId(orderId)) {
    res.status(400).json({ ok: false, error: "Invalid orderId" });
    return;
  }

  if (orderId) {
    const order = await OrderModel.findOne({ _id: orderId, tenantId }).exec();
    if (!order) {
      res.status(404).json({ ok: false, error: "Order not found" });
      return;
    }

    const activeCount = await ExitAuthorizationModel.countDocuments({
      tenantId,
      orderId,
      location,
      status: "active",
      expiresAt: { $gt: new Date() },
    }).exec();

    if (activeCount === 0) {
      res.status(409).json({ ok: false, error: "This order has no active exit authorization for the selected gate" });
      return;
    }
  }

  const raw = `exit_${crypto.randomBytes(12).toString("hex")}`;
  const tokenPrefix = raw.slice(0, 12);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

  const session = await ExitSessionModel.create({
    tenantId,
    userId: auth.id,
    orderId: orderId || undefined,
    location,
    tokenPrefix,
    tokenHash: hashKey(raw),
    startedAt: new Date(),
    expiresAt,
  });

  res.status(201).json({
    ok: true,
    session: {
      id: session._id,
      token: raw,
      expiresAt,
      location,
      orderId: orderId || undefined,
    },
  });
});

router.post("/exit-sessions/verify", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawToken = typeof body.token === "string" ? body.token.trim() : "";
  const { value, tagId: rawTagId, barcode: rawBarcode, observedAt } = normalizeScan(body);
  const eventId = normalizeExternalEventId(req, body);
  const decisionAt = new Date();

  if (!rawToken) {
    res.status(400).json({ ok: false, error: "token is required" });
    return;
  }

  if (eventId) {
    const duplicate = await RfidEventModel.findOne({ tenantId, eventId }).exec();
    if (duplicate) {
      res.json({ ok: true, duplicate: true, processed: false, event: duplicate });
      return;
    }
  }

  const session = await ExitSessionModel.findOne({
    tenantId,
    tokenPrefix: rawToken.slice(0, 12),
    tokenHash: hashKey(rawToken),
    endedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).exec();

  if (!session) {
    res.status(401).json({ ok: false, error: "Invalid or expired exit token" });
    return;
  }

  const { tagId, barcode, mode } = await resolveScanIdentity({
    tenantId,
    location: session.location,
    observedAt: decisionAt,
    value,
    tagId: rawTagId,
    barcode: rawBarcode,
  });

  if (!tagId && !barcode) {
    res.status(400).json({ ok: false, error: "value, tagId, or barcode is required" });
    return;
  }

  const fallbackItem = await resolveItem(tenantId, { tagId, barcode });
  const event = await RfidEventModel.create({
    tenantId,
    eventId: eventId || undefined,
    tagId: tagId || barcode || value,
    eventType: "scan",
    itemId: fallbackItem?._id,
    actorUserId: auth.id,
    location: session.location,
    observedAt,
    source: "exit-session",
    raw: redactHardwareRaw(body),
  });

  const result = await verifyExitScan({
    tenantId,
    tagId: tagId || undefined,
    barcode: barcode || undefined,
    location: session.location,
    source: "exit-session",
    observedAt: decisionAt,
    actorUserId: auth.id,
    fallbackItem,
  });

  event.raw = {
    ...(typeof event.raw === "object" && event.raw ? (event.raw as Record<string, unknown>) : {}),
    decision: result.decision,
    authorized: result.authorized,
    authorizationId: result.authorizationId,
    exitSessionId: session._id.toString(),
  };
  await event.save();

  session.lastSeenAt = new Date();
  if (result.remainingAuthorizations === 0) {
    session.endedAt = new Date();
  }
  await session.save();

  if (!result.authorized && result.alert) {
    result.alert.meta = {
      ...(result.alert.meta ?? {}),
      rfidEventId: event._id.toString(),
      exitSessionId: session._id.toString(),
    };
    await result.alert.save();
  }

  res.json({
    ok: true,
    mode,
    authorized: result.authorized,
    decision: result.decision,
    item: result.item,
    order: result.order,
    remainingAuthorizations: result.remainingAuthorizations,
    session: {
      expiresAt: session.expiresAt,
      location: session.location,
      orderId: session.orderId?.toString(),
    },
    event,
    alert: result.alert,
  });
});

router.post("/exit-authorizations", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
  const barcodes = Array.isArray(body.barcodes) ? body.barcodes.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
  const singleTag = typeof body.tagId === "string" ? body.tagId.trim() : "";
  const singleBarcode = typeof body.barcode === "string" ? body.barcode.trim() : "";

  const tags = singleTag ? [singleTag, ...tagIds] : tagIds;
  const barcodeList = singleBarcode ? [singleBarcode, ...barcodes] : barcodes;
  if (tags.length === 0 && barcodeList.length === 0) {
    res.status(400).json({ ok: false, error: "tagId/tagIds or barcode/barcodes is required" });
    return;
  }

  const location = normalizeLocation(body.location);
  const minutes = Math.min(60, Math.max(1, typeof body.minutes === "number" ? Math.floor(body.minutes) : 15));
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const orderId = typeof body.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : "";

  if (orderId && !mongoose.isValidObjectId(orderId)) {
    res.status(400).json({ ok: false, error: "Invalid orderId" });
    return;
  }

  await ExitAuthorizationModel.updateMany(
    { tenantId, location, status: "active", $or: [{ tagId: { $in: tags } }, { barcode: { $in: barcodeList } }] },
    { $set: { status: "revoked" } }
  ).exec();

  const authorizations = await ExitAuthorizationModel.insertMany([
    ...tags.map((tag) => ({
      tenantId,
      tagId: tag,
      location,
      status: "active" as const,
      orderId: orderId || undefined,
      createdByUserId: auth.id,
      expiresAt,
    })),
    ...barcodeList.map((barcode) => ({
      tenantId,
      barcode,
      location,
      status: "active" as const,
      orderId: orderId || undefined,
      createdByUserId: auth.id,
      expiresAt,
    })),
  ]);

  res.status(201).json({ ok: true, authorizations, expiresAt, location });
});

router.get("/exit-authorizations", requireRole("manager", "admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const status = (req.query.status as string | undefined)?.trim();
  const location = (req.query.location as string | undefined)?.trim();
  const tagId = (req.query.tagId as string | undefined)?.trim();
  const barcode = (req.query.barcode as string | undefined)?.trim();

  const filter: Record<string, unknown> = { tenantId };
  if (status) filter.status = status;
  if (location) filter.location = location;
  if (tagId) filter.tagId = tagId;
  if (barcode) filter.barcode = barcode;

  const docs = await ExitAuthorizationModel.find(filter).sort({ createdAt: -1 }).limit(500).exec();
  res.json({ ok: true, authorizations: docs });
});

router.get("/tags", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { status, search, page, limit } = req.query as { status?: string; search?: string; page?: string; limit?: string };

  const filter: Record<string, unknown> = { tenantId };
  if (status === "active" || status === "inactive") filter.status = status;
  if (search?.trim()) {
    filter.$or = [
      { tagId: { $regex: search.trim(), $options: "i" } },
      { itemName: { $regex: search.trim(), $options: "i" } },
      { itemBarcode: { $regex: search.trim(), $options: "i" } },
      { itemSku: { $regex: search.trim(), $options: "i" } },
    ];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [docs, total] = await Promise.all([
    RfidTagModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).exec(),
    RfidTagModel.countDocuments(filter).exec(),
  ]);

  const tagIds = docs.map((doc) => doc.tagId);
  const activeAuthCounts = await ExitAuthorizationModel.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        tagId: { $in: tagIds },
        status: "active",
        expiresAt: { $gt: new Date() },
      },
    },
    { $group: { _id: "$tagId", count: { $sum: 1 } } },
  ]).exec();
  const activeByTag = new Map(activeAuthCounts.map((row) => [String(row._id), Number(row.count) || 0]));

  res.json({
    ok: true,
    tags: docs.map((doc) => ({
      ...doc.toObject(),
      activeExitAuthorizations: activeByTag.get(doc.tagId) ?? 0,
    })),
    page: pageNum,
    limit: limitNum,
    total,
    hasMore: skip + docs.length < total,
  });
});

router.get("/tags/:tagId", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOne({ tenantId, tagId }).exec();
  if (!doc) {
    res.status(404).json({ ok: false, error: "Tag not found" });
    return;
  }

  const activeExitAuthorizations = await ExitAuthorizationModel.countDocuments({
    tenantId,
    tagId,
    status: "active",
    expiresAt: { $gt: new Date() },
  }).exec();

  res.json({ ok: true, tag: { ...doc.toObject(), activeExitAuthorizations } });
});

router.patch("/tags/:tagId", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;
  const { itemId } = req.body as { itemId?: string | null };

  if (itemId !== undefined && itemId !== null && itemId !== "") {
    if (!mongoose.isValidObjectId(itemId)) {
      res.status(400).json({ ok: false, error: "Invalid itemId" });
      return;
    }

    const item = await InventoryItemModel.findOne({ _id: itemId, tenantId }).exec();
    if (!item) {
      res.status(404).json({ ok: false, error: "Item not found" });
      return;
    }

    const doc = await RfidTagModel.findOneAndUpdate(
      { tenantId, tagId },
      {
        $set: {
          itemId: item._id,
          itemBarcode: item.barcode,
          itemName: item.name,
          itemSku: item.sku,
          status: "active",
          assignedAt: new Date(),
          deactivatedAt: null,
        },
      },
      { upsert: true, new: true }
    ).exec();

    res.json({ ok: true, tag: doc });
    return;
  }

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: { status: "inactive", deactivatedAt: new Date() },
      $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
    },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Tag not found" });
    return;
  }

  res.json({ ok: true, tag: doc });
});

router.post("/tags/:tagId/activate", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    { $set: { status: "active", deactivatedAt: null } },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Tag not found" });
    return;
  }

  res.json({ ok: true, tag: doc });
});

router.post("/tags/:tagId/deactivate", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: { status: "inactive", deactivatedAt: new Date() },
      $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
    },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Tag not found" });
    return;
  }

  res.json({ ok: true, tag: doc });
});

router.delete("/tags/:tagId", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { tagId } = req.params;

  const doc = await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: { status: "inactive", deactivatedAt: new Date() },
      $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
    },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Tag not found" });
    return;
  }

  res.json({ ok: true });
});

router.post("/tags/migrate", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;

  const items = await InventoryItemModel.find({ tenantId, rfidTagId: { $exists: true, $ne: "" } }).exec();
  for (const item of items) {
    await upsertRfidTag(tenantId, item.rfidTagId as string, item);
  }

  const units = await InventoryUnitModel.find({ tenantId, tagId: { $exists: true, $ne: "" } }).exec();
  for (const unit of units) {
    const alreadySynced = await RfidTagModel.findOne({ tenantId, tagId: unit.tagId }).exec();
    if (!alreadySynced) {
      const parentItem = await InventoryItemModel.findOne({ _id: unit.itemId, tenantId }).exec();
      if (parentItem) await upsertRfidTag(tenantId, unit.tagId as string, parentItem);
    }
  }

  const count = await RfidTagModel.countDocuments({ tenantId }).exec();
  res.json({ ok: true, message: "Migration complete", totalTags: count });
});

router.get("/gate-keys", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const docs = await GateApiKeyModel.find({ tenantId })
    .sort({ createdAt: -1 })
    .select("name keyPrefix locationHint lastSeenAt lastSeenSource expiresAt revokedAt createdAt")
    .exec();

  res.json({ ok: true, keys: docs });
});

router.post("/gate-keys", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { name, locationHint, minutes } = req.body as {
    name?: string;
    locationHint?: string;
    minutes?: number;
  };

  if (!name || !String(name).trim()) {
    res.status(400).json({ ok: false, error: "name is required" });
    return;
  }

  const { raw, prefix, hash } = generateKey();
  const expiresAt = minutes
    ? new Date(Date.now() + Math.min(43200, Math.max(1, Number(minutes))) * 60 * 1000)
    : undefined;

  const doc = await GateApiKeyModel.create({
    tenantId,
    name: String(name).trim(),
    keyPrefix: prefix,
    keyHash: hash,
    createdByUserId: auth.id,
    locationHint: locationHint ? String(locationHint).trim() : undefined,
    expiresAt,
  });

  res.status(201).json({
    ok: true,
    key: raw,
    keyPrefix: prefix,
    keyDoc: {
      _id: doc._id,
      name: doc.name,
      keyPrefix: doc.keyPrefix,
      locationHint: doc.locationHint,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    },
  });
});

router.delete("/gate-keys/:id", requireRole("admin"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId as string;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ ok: false, error: "Invalid key ID" });
    return;
  }

  const doc = await GateApiKeyModel.findOneAndUpdate(
    { _id: id, tenantId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { new: true }
  ).exec();

  if (!doc) {
    res.status(404).json({ ok: false, error: "Key not found or already revoked" });
    return;
  }

  res.json({ ok: true, revoked: { _id: doc._id, name: doc.name, revokedAt: doc.revokedAt } });
});

export default router;
