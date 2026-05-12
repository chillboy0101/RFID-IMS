import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

import type { UserRole } from "../models/User.js";
import { TenantAuditLogModel } from "../models/TenantAuditLog.js";
import type { AuthRequest } from "./auth.js";
import type { GateRequest } from "./gate.js";
import type { TenantRequest } from "./tenant.js";

type AuditDescriptor = {
  category: string;
  entityType?: string;
  type: string;
  successSummary: string;
  failureSummary: string;
};

type AuditContextPatch = Partial<{
  skip: boolean;
  actorEmail: string;
  actorName: string;
  actorRole: UserRole;
  actorSource: string;
  actorTenantRole: UserRole;
  actorUserId: string;
  category: string;
  entityId: string;
  entityLabel: string;
  entityType: string;
  fromRole: UserRole;
  metadata: Record<string, unknown>;
  summary: string;
  targetUserId: string;
  toRole: UserRole;
  type: string;
}>;

type AuditedResponse = Response & {
  locals: Response["locals"] & {
    audit?: AuditContextPatch;
    auditResponseBody?: unknown;
  };
};

type AuditedRequest = Request &
  Partial<AuthRequest> &
  Partial<TenantRequest> &
  Partial<GateRequest> & {
    requestId?: string;
  };

const auditableMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const specialAuditableRoutes = new Set(["GET /auth/login-alert/protect", "GET /auth/verify-email"]);

const auditDescriptorMap: Record<string, AuditDescriptor> = {
  "POST /admin/bootstrap": {
    type: "admin.bootstrap",
    category: "admin",
    successSummary: "Bootstrapped first admin account",
    failureSummary: "Failed to bootstrap first admin account",
  },
  "POST /admin/bootstrap-tenancy": {
    type: "admin.bootstrap_tenancy",
    category: "admin",
    successSummary: "Bootstrapped tenant structure",
    failureSummary: "Failed to bootstrap tenant structure",
  },
  "POST /admin/clear-inventory-data": {
    type: "admin.inventory_data.clear",
    category: "admin",
    entityType: "tenant_inventory",
    successSummary: "Cleared test inventory data",
    failureSummary: "Failed to clear test inventory data",
  },
  "POST /admin/sessions/:jti/revoke": {
    type: "admin.session.revoke",
    category: "admin",
    entityType: "session",
    successSummary: "Revoked user session",
    failureSummary: "Failed to revoke user session",
  },
  "PATCH /admin/users/:id/role": {
    type: "admin.user.role_change",
    category: "admin",
    entityType: "user",
    successSummary: "Changed user role",
    failureSummary: "Failed to change user role",
  },
  "POST /admin/users/:id/verify-email": {
    type: "admin.user.verify_email",
    category: "admin",
    entityType: "user",
    successSummary: "Verified user email",
    failureSummary: "Failed to verify user email",
  },
  "DELETE /admin/users/:id": {
    type: "admin.user.delete",
    category: "admin",
    entityType: "user",
    successSummary: "Deleted user account",
    failureSummary: "Failed to delete user account",
  },
  "POST /auth/change-password": {
    type: "auth.change_password",
    category: "auth",
    entityType: "user",
    successSummary: "Changed account password",
    failureSummary: "Failed to change account password",
  },
  "POST /auth/forgot-password": {
    type: "auth.forgot_password",
    category: "auth",
    entityType: "user",
    successSummary: "Requested password reset",
    failureSummary: "Failed to request password reset",
  },
  "POST /auth/login": {
    type: "auth.login",
    category: "auth",
    entityType: "session",
    successSummary: "Signed in",
    failureSummary: "Sign-in failed",
  },
  "GET /auth/login-alert/protect": {
    type: "auth.account_protect",
    category: "auth",
    entityType: "user",
    successSummary: "Triggered account protection flow",
    failureSummary: "Failed to trigger account protection flow",
  },
  "POST /auth/recover-account": {
    type: "auth.recover_account",
    category: "auth",
    entityType: "user",
    successSummary: "Recovered account access",
    failureSummary: "Failed to recover account access",
  },
  "POST /auth/recover-account/resend-otp": {
    type: "auth.resend_recovery_code",
    category: "auth",
    entityType: "user",
    successSummary: "Resent account recovery code",
    failureSummary: "Failed to resend account recovery code",
  },
  "POST /auth/register": {
    type: "auth.register",
    category: "auth",
    entityType: "user",
    successSummary: "Registered account",
    failureSummary: "Failed to register account",
  },
  "POST /auth/register-dev": {
    type: "auth.register_dev",
    category: "auth",
    entityType: "user",
    successSummary: "Created developer bypass account",
    failureSummary: "Failed to create developer bypass account",
  },
  "POST /auth/resend-verification": {
    type: "auth.resend_verification",
    category: "auth",
    entityType: "user",
    successSummary: "Resent email verification link",
    failureSummary: "Failed to resend email verification link",
  },
  "POST /auth/reset-password": {
    type: "auth.reset_password",
    category: "auth",
    entityType: "user",
    successSummary: "Reset account password",
    failureSummary: "Failed to reset account password",
  },
  "GET /auth/verify-email": {
    type: "auth.verify_email",
    category: "auth",
    entityType: "user",
    successSummary: "Verified email address",
    failureSummary: "Failed to verify email address",
  },
  "POST /feedback": {
    type: "feedback.submit",
    category: "feedback",
    entityType: "feedback",
    successSummary: "Submitted feedback",
    failureSummary: "Failed to submit feedback",
  },
  "PATCH /feedback/:id/status": {
    type: "feedback.status_change",
    category: "feedback",
    entityType: "feedback",
    successSummary: "Updated feedback status",
    failureSummary: "Failed to update feedback status",
  },
  "POST /integrations/import": {
    type: "integrations.import",
    category: "integrations",
    entityType: "import_job",
    successSummary: "Started data import",
    failureSummary: "Failed to start data import",
  },
  "POST /integrations/import/inventory": {
    type: "integrations.import_inventory",
    category: "integrations",
    entityType: "inventory_import",
    successSummary: "Imported inventory data",
    failureSummary: "Failed to import inventory data",
  },
  "POST /inventory/items": {
    type: "inventory.item.create",
    category: "inventory",
    entityType: "inventory_item",
    successSummary: "Created inventory item",
    failureSummary: "Failed to create inventory item",
  },
  "PATCH /inventory/items/:id": {
    type: "inventory.item.update",
    category: "inventory",
    entityType: "inventory_item",
    successSummary: "Updated inventory item",
    failureSummary: "Failed to update inventory item",
  },
  "DELETE /inventory/items/:id": {
    type: "inventory.item.delete",
    category: "inventory",
    entityType: "inventory_item",
    successSummary: "Deleted inventory item",
    failureSummary: "Failed to delete inventory item",
  },
  "POST /inventory/items/:id/adjust": {
    type: "inventory.item.adjust",
    category: "inventory",
    entityType: "inventory_item",
    successSummary: "Adjusted inventory quantity",
    failureSummary: "Failed to adjust inventory quantity",
  },
  "POST /inventory/putaway/assign-tag": {
    type: "inventory.putaway.assign_tag",
    category: "inventory",
    entityType: "rfid_tag",
    successSummary: "Assigned RFID tag during putaway",
    failureSummary: "Failed to assign RFID tag during putaway",
  },
  "POST /inventory/receiving/units": {
    type: "inventory.receiving.unit_create",
    category: "inventory",
    entityType: "inventory_unit",
    successSummary: "Received inventory unit",
    failureSummary: "Failed to receive inventory unit",
  },
  "POST /orders": {
    type: "orders.create",
    category: "orders",
    entityType: "order",
    successSummary: "Created fulfilment order",
    failureSummary: "Failed to create fulfilment order",
  },
  "POST /orders/:id/authorize-exit": {
    type: "orders.authorize_exit",
    category: "orders",
    entityType: "order",
    successSummary: "Authorized order for exit",
    failureSummary: "Failed to authorize order for exit",
  },
  "PATCH /orders/:id/status": {
    type: "orders.status_change",
    category: "orders",
    entityType: "order",
    successSummary: "Updated order status",
    failureSummary: "Failed to update order status",
  },
  "POST /progress/sessions/start": {
    type: "progress.session.start",
    category: "progress",
    entityType: "task_session",
    successSummary: "Started work session",
    failureSummary: "Failed to start work session",
  },
  "POST /progress/sessions/:id/stop": {
    type: "progress.session.stop",
    category: "progress",
    entityType: "task_session",
    successSummary: "Stopped work session",
    failureSummary: "Failed to stop work session",
  },
  "POST /reorders": {
    type: "reorders.create",
    category: "reorders",
    entityType: "reorder_request",
    successSummary: "Created reorder request",
    failureSummary: "Failed to create reorder request",
  },
  "POST /reorders/auto": {
    type: "reorders.auto_create",
    category: "reorders",
    entityType: "reorder_request",
    successSummary: "Generated automatic reorder requests",
    failureSummary: "Failed to generate automatic reorder requests",
  },
  "PATCH /reorders/:id/status": {
    type: "reorders.status_change",
    category: "reorders",
    entityType: "reorder_request",
    successSummary: "Updated reorder status",
    failureSummary: "Failed to update reorder status",
  },
  "POST /rfid/events": {
    type: "rfid.event.capture",
    category: "rfid",
    entityType: "rfid_event",
    successSummary: "Captured RFID event",
    failureSummary: "Failed to capture RFID event",
  },
  "POST /rfid/staff-card-events": {
    type: "rfid.staff_card_event.capture",
    category: "rfid",
    entityType: "rfid_event",
    successSummary: "Captured staff RFID card scan",
    failureSummary: "Failed to capture staff RFID card scan",
  },
  "POST /rfid/exit-authorizations": {
    type: "rfid.exit_authorization.create",
    category: "rfid",
    entityType: "exit_authorization",
    successSummary: "Authorized tags for exit",
    failureSummary: "Failed to authorize tags for exit",
  },
  "POST /rfid/exit-sessions": {
    type: "rfid.exit_session.create",
    category: "rfid",
    entityType: "exit_session",
    successSummary: "Started RFID exit session",
    failureSummary: "Failed to start RFID exit session",
  },
  "POST /rfid/exit-sessions/verify": {
    type: "rfid.exit_session.verify",
    category: "rfid",
    entityType: "exit_session",
    successSummary: "Verified RFID exit scan",
    failureSummary: "Failed to verify RFID exit scan",
  },
  "POST /rfid/gate-events": {
    type: "rfid.gate_event.capture",
    category: "rfid",
    entityType: "rfid_event",
    successSummary: "Captured gate reader event",
    failureSummary: "Failed to capture gate reader event",
  },
  "POST /rfid/operator-sessions": {
    type: "rfid.operator_session.create",
    category: "rfid",
    entityType: "operator_session",
    successSummary: "Authorized RFID device user",
    failureSummary: "Failed to authorize RFID device user",
  },
  "DELETE /rfid/operator-sessions/:token": {
    type: "rfid.operator_session.end",
    category: "rfid",
    entityType: "operator_session",
    successSummary: "Ended RFID operator session",
    failureSummary: "Failed to end RFID operator session",
  },
  "POST /rfid/receiving-events": {
    type: "rfid.receiving_event.capture",
    category: "rfid",
    entityType: "rfid_event",
    successSummary: "Captured receiving reader event",
    failureSummary: "Failed to capture receiving reader event",
  },
  "POST /rfid/gate-keys": {
    type: "rfid.gate_key.create",
    category: "rfid",
    entityType: "gate_api_key",
    successSummary: "Created RFID gate key",
    failureSummary: "Failed to create RFID gate key",
  },
  "DELETE /rfid/gate-keys/:id": {
    type: "rfid.gate_key.revoke",
    category: "rfid",
    entityType: "gate_api_key",
    successSummary: "Revoked RFID gate key",
    failureSummary: "Failed to revoke RFID gate key",
  },
  "POST /rfid/tags/:tagId/activate": {
    type: "rfid.tag.activate",
    category: "rfid",
    entityType: "rfid_tag",
    successSummary: "Activated RFID tag",
    failureSummary: "Failed to activate RFID tag",
  },
  "POST /rfid/tags/:tagId/deactivate": {
    type: "rfid.tag.deactivate",
    category: "rfid",
    entityType: "rfid_tag",
    successSummary: "Deactivated RFID tag",
    failureSummary: "Failed to deactivate RFID tag",
  },
  "PATCH /rfid/tags/:tagId": {
    type: "rfid.tag.update",
    category: "rfid",
    entityType: "rfid_tag",
    successSummary: "Updated RFID tag assignment",
    failureSummary: "Failed to update RFID tag assignment",
  },
  "DELETE /rfid/tags/:tagId": {
    type: "rfid.tag.remove",
    category: "rfid",
    entityType: "rfid_tag",
    successSummary: "Removed RFID tag assignment",
    failureSummary: "Failed to remove RFID tag assignment",
  },
  "POST /rfid/tags/migrate": {
    type: "rfid.tag.migrate",
    category: "rfid",
    entityType: "rfid_tag",
    successSummary: "Migrated RFID tag registry",
    failureSummary: "Failed to migrate RFID tag registry",
  },
  "POST /tenants": {
    type: "tenants.create",
    category: "tenants",
    entityType: "tenant",
    successSummary: "Created tenant",
    failureSummary: "Failed to create tenant",
  },
  "POST /tenants/:id/members": {
    type: "tenants.membership.upsert",
    category: "tenants",
    entityType: "tenant_membership",
    successSummary: "Updated tenant membership",
    failureSummary: "Failed to update tenant membership",
  },
  "DELETE /tenants/:id/members/:userId": {
    type: "tenants.membership.remove",
    category: "tenants",
    entityType: "tenant_membership",
    successSummary: "Removed tenant membership",
    failureSummary: "Failed to remove tenant membership",
  },
  "POST /tenants/:id/sessions/:jti/revoke": {
    type: "tenants.session.revoke",
    category: "tenants",
    entityType: "session",
    successSummary: "Revoked tenant session",
    failureSummary: "Failed to revoke tenant session",
  },
  "POST /tenants/:id/users": {
    type: "tenants.user.create",
    category: "tenants",
    entityType: "user",
    successSummary: "Created tenant user",
    failureSummary: "Failed to create tenant user",
  },
  "POST /tenants/:id/users/:userId/resend-temporary-password": {
    type: "tenants.user.temporary_password_resend",
    category: "tenants",
    entityType: "user",
    successSummary: "Resent temporary password",
    failureSummary: "Failed to resend temporary password",
  },
  "PATCH /tenants/:id/users/:userId/operator-tag": {
    type: "tenants.user.operator_tag_change",
    category: "tenants",
    entityType: "user",
    successSummary: "Updated user staff RFID card",
    failureSummary: "Failed to update user staff RFID card",
  },
  "DELETE /tenants/:id/users/:userId/operator-tag": {
    type: "tenants.user.operator_tag_remove",
    category: "tenants",
    entityType: "user",
    successSummary: "Removed user staff RFID card",
    failureSummary: "Failed to remove user staff RFID card",
  },
  "POST /vendors": {
    type: "vendors.create",
    category: "vendors",
    entityType: "vendor",
    successSummary: "Created vendor",
    failureSummary: "Failed to create vendor",
  },
  "PATCH /vendors/:id": {
    type: "vendors.update",
    category: "vendors",
    entityType: "vendor",
    successSummary: "Updated vendor",
    failureSummary: "Failed to update vendor",
  },
  "DELETE /vendors/:id": {
    type: "vendors.delete",
    category: "vendors",
    entityType: "vendor",
    successSummary: "Deleted vendor",
    failureSummary: "Failed to delete vendor",
  },
};

const sensitiveKeys = new Set([
  "apiKey",
  "authorization",
  "hash",
  "key",
  "newPassword",
  "oldPassword",
  "otp",
  "operatorSessionToken",
  "operatorToken",
  "password",
  "passwordHash",
  "secret",
  "token",
]);

function normalizeRouteKey(routeKey: string): string {
  if (!routeKey) return "/";
  if (routeKey.length > 1 && routeKey.endsWith("/")) {
    return routeKey.slice(0, -1);
  }
  return routeKey;
}

function getRouteKey(req: AuditedRequest): string {
  const routePath = typeof (req as any).route?.path === "string" ? (req as any).route.path : "";
  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const fallbackPath = String(req.originalUrl ?? req.url ?? "/").split("?")[0] ?? "/";
  return normalizeRouteKey(`${baseUrl}${routePath}` || fallbackPath || "/");
}

function resolveCategory(routeKey: string): string {
  const segment = routeKey.split("/").filter(Boolean)[0] ?? "system";
  return segment;
}

function toTitle(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildFallbackDescriptor(method: string, routeKey: string): AuditDescriptor {
  const category = resolveCategory(routeKey);
  const segments = routeKey.split("/").filter(Boolean);
  const staticSegments = segments.filter((segment) => !segment.startsWith(":"));
  const label = toTitle(staticSegments[staticSegments.length - 1] ?? staticSegments[0] ?? category);
  const lowerLabel = label.toLowerCase();

  if (method === "PATCH") {
    return {
      type: `${category}.update`,
      category,
      successSummary: `Updated ${lowerLabel}`,
      failureSummary: `Failed to update ${lowerLabel}`,
    };
  }

  if (method === "DELETE") {
    return {
      type: `${category}.delete`,
      category,
      successSummary: `Deleted ${lowerLabel}`,
      failureSummary: `Failed to delete ${lowerLabel}`,
    };
  }

  if (method === "PUT") {
    return {
      type: `${category}.save`,
      category,
      successSummary: `Saved ${lowerLabel}`,
      failureSummary: `Failed to save ${lowerLabel}`,
    };
  }

  return {
    type: `${category}.submit`,
    category,
    successSummary: `Submitted ${lowerLabel.toLowerCase()}`,
    failureSummary: `Failed to submit ${lowerLabel.toLowerCase()}`,
  };
}

function shouldAuditRequest(method: string, routeKey: string, hasExplicitContext: boolean): boolean {
  if (!routeKey || routeKey === "/health" || routeKey === "/metrics") {
    return false;
  }

  if (hasExplicitContext) {
    return true;
  }

  if (auditableMethods.has(method)) {
    return true;
  }

  return specialAuditableRoutes.has(`${method} ${routeKey}`);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[truncated]";
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    const next: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      next[key] = sensitiveKeys.has(key) ? "[redacted]" : sanitizeValue(entry, depth + 1);
    }
    return next;
  }
  return String(value);
}

function resolveTenantId(req: AuditedRequest): string | null {
  const direct = typeof req.tenantId === "string" ? req.tenantId.trim() : "";
  if (direct && mongoose.isValidObjectId(direct)) {
    return direct;
  }

  const header = String(req.header("x-tenant-id") ?? req.header("X-Tenant-ID") ?? "").trim();
  if (header && mongoose.isValidObjectId(header)) {
    return header;
  }

  return null;
}

function resolveActorFromResponseBody(body: unknown): Partial<{
  email: string;
  id: string;
  name: string;
  role: UserRole;
}> {
  if (!body || typeof body !== "object") return {};
  const candidate = (body as Record<string, unknown>).user;
  if (!candidate || typeof candidate !== "object") return {};

  const user = candidate as Record<string, unknown>;
  return {
    id: typeof user.id === "string" ? user.id : typeof user._id === "string" ? user._id : undefined,
    name: typeof user.name === "string" ? user.name : undefined,
    email: typeof user.email === "string" ? user.email : undefined,
    role: typeof user.role === "string" ? (user.role as UserRole) : undefined,
  };
}

function extractEntityId(entityType: string | undefined, req: AuditedRequest, body: unknown): string | undefined {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const fromParams = ["id", "userId", "tagId", "jti"]
    .map((key) => params[key])
    .find((value) => typeof value === "string" && String(value).trim()) as string | undefined;
  if (fromParams) {
    return fromParams.trim();
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const payload = body as Record<string, unknown>;
  const byEntity: Record<string, unknown> = {
    feedback: payload.feedback,
    gate_api_key: payload.keyDoc,
    inventory_item: payload.item,
    order: payload.order,
    reorder_request: payload.reorder,
    rfid_event: payload.event,
    rfid_tag: payload.tag,
    session: payload.session,
    task_session: payload.session,
    tenant: payload.tenant,
    user: payload.user,
    vendor: payload.vendor,
  };

  const candidate = entityType ? byEntity[entityType] : undefined;
  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    const id = record.id ?? record._id ?? record.tagId ?? record.tokenPrefix;
    if (typeof id === "string" && id.trim()) return id.trim();
  }

  return undefined;
}

function extractEntityLabel(entityType: string | undefined, req: AuditedRequest, body: unknown): string | undefined {
  const requestBody = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const responseBody = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const candidateSets = [responseBody, requestBody];
  for (const source of candidateSets) {
    const nestedCandidates = [
      source.user,
      source.item,
      source.order,
      source.vendor,
      source.reorder,
      source.tag,
      source.keyDoc,
      source.session,
      source.tenant,
    ].filter((value) => value && typeof value === "object") as Array<Record<string, unknown>>;

    for (const nested of nestedCandidates) {
      const possible = [
        nested.name,
        nested.email,
        nested.sku,
        nested.barcode,
        nested.tagId,
        nested.location,
        nested.keyPrefix,
      ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
      if (possible) {
        return possible.trim();
      }
    }

    const topLevel = [
      source.name,
      source.email,
      source.sku,
      source.barcode,
      source.tagId,
      source.locationHint,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    if (topLevel) {
      return topLevel.trim();
    }
  }

  if (entityType === "tenant_membership") {
    const email = requestBody.email;
    if (typeof email === "string" && email.trim()) return email.trim();
  }

  return undefined;
}

function buildMetadata(req: AuditedRequest, res: AuditedResponse): Record<string, unknown> {
  const responseBody = res.locals.auditResponseBody;
  const error =
    responseBody && typeof responseBody === "object" && typeof (responseBody as Record<string, unknown>).error === "string"
      ? String((responseBody as Record<string, unknown>).error)
      : undefined;

  const metadata: Record<string, unknown> = {
    params: sanitizeValue(req.params ?? {}),
    query: sanitizeValue(req.query ?? {}),
    body: sanitizeValue(req.body ?? {}),
  };

  const sourceHeader = String(req.header("x-source") ?? "").trim();
  if (sourceHeader) {
    metadata.source = sourceHeader;
  }

  if (typeof req.gateKeyName === "string" && req.gateKeyName.trim()) {
    metadata.gateKeyName = req.gateKeyName.trim();
  }

  if (typeof req.gateKeyLocationHint === "string" && req.gateKeyLocationHint.trim()) {
    metadata.gateKeyLocation = req.gateKeyLocationHint.trim();
  }

  if (error) {
    metadata.error = error;
  }

  return metadata;
}

export function setAuditContext(res: Response, patch: AuditContextPatch): void {
  const locals = (res as AuditedResponse).locals;
  const current = locals.audit ?? {};
  locals.audit = {
    ...current,
    ...patch,
    metadata: patch.metadata ? { ...(current.metadata ?? {}), ...patch.metadata } : current.metadata,
  };
}

export function captureAuditResponse(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  (res as AuditedResponse).json = ((body: unknown) => {
    (res as AuditedResponse).locals.auditResponseBody = body;
    return originalJson(body);
  }) as Response["json"];
  next();
}

export function auditRequestLogger(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    void persistAuditEntry(req as AuditedRequest, res as AuditedResponse);
  });
  next();
}

async function persistAuditEntry(req: AuditedRequest, res: AuditedResponse): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const routeKey = getRouteKey(req);
  const method = String(req.method ?? "GET").toUpperCase();
  const context = res.locals.audit ?? {};
  if (context.skip) {
    return;
  }

  if (!shouldAuditRequest(method, routeKey, Boolean(context.type || context.summary))) {
    return;
  }

  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return;
  }

  const descriptor = auditDescriptorMap[`${method} ${routeKey}`] ?? buildFallbackDescriptor(method, routeKey);
  const outcome = res.statusCode >= 400 ? "failure" : "success";
  const responseActor = resolveActorFromResponseBody(res.locals.auditResponseBody);
  const auth = req.auth;

  const actorSource =
    context.actorSource ??
    (typeof req.gateKeyName === "string" && req.gateKeyName.trim() ? "hardware" : auth?.id || responseActor.id ? "user" : "system");
  const actorUserId = context.actorUserId ?? auth?.id ?? responseActor.id;
  const actorName = context.actorName ?? auth?.name ?? responseActor.name ?? req.gateKeyName ?? undefined;
  const actorEmail =
    context.actorEmail ??
    auth?.email ??
    responseActor.email ??
    (typeof (req.body as Record<string, unknown> | undefined)?.email === "string"
      ? String((req.body as Record<string, unknown>).email).trim().toLowerCase()
      : undefined);
  const actorRole = context.actorRole ?? auth?.role ?? responseActor.role;
  const actorTenantRole = context.actorTenantRole ?? req.tenantRole ?? auth?.role;

  const entityType = context.entityType ?? descriptor.entityType;
  const entityId = context.entityId ?? extractEntityId(entityType, req, res.locals.auditResponseBody);
  const entityLabel = context.entityLabel ?? extractEntityLabel(entityType, req, res.locals.auditResponseBody);
  const summary = context.summary ?? (outcome === "failure" ? descriptor.failureSummary : descriptor.successSummary);

  try {
    await TenantAuditLogModel.create({
      tenantId,
      actorUserId,
      actorName,
      actorEmail,
      actorRole,
      actorTenantRole,
      actorSource,
      type: context.type ?? descriptor.type,
      category: context.category ?? descriptor.category,
      summary,
      entityType,
      entityId,
      entityLabel,
      targetUserId: context.targetUserId,
      fromRole: context.fromRole,
      toRole: context.toRole,
      method,
      path: String(req.originalUrl ?? req.url ?? routeKey).split("?")[0] ?? routeKey,
      routeKey,
      requestId: req.requestId,
      statusCode: res.statusCode,
      outcome,
      ip: req.ip,
      userAgent: req.header("user-agent") ?? undefined,
      metadata: {
        ...buildMetadata(req, res),
        ...(context.metadata ?? {}),
      },
    });
  } catch (error) {
    console.error("audit log write failed", error);
  }
}
