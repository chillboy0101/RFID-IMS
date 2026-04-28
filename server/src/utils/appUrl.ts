import type { Request } from "express";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstConfiguredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const first = value
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  return first ? normalizeBaseUrl(first) : null;
}

function isLocalLikeHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") return true;
  if (value === "10.0.2.2") return true;
  if (/^10\./.test(value)) return true;
  if (/^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d+)\./);
  if (!match) return false;
  const octet = Number(match[1]);
  return octet >= 16 && octet <= 31;
}

function getRequestHost(req: Request): string | null {
  const hostHeader = req.get("host")?.trim();
  if (!hostHeader) return null;
  return hostHeader.replace(/:\d+$/, "");
}

export function resolveAppBaseUrl(req?: Request): string | null {
  const configured = normalizeBaseUrl(process.env.APP_BASE_URL ?? "");
  if (configured) return configured;

  const corsOrigin = firstConfiguredOrigin(process.env.CORS_ORIGIN);
  if (corsOrigin) return corsOrigin;

  if (!req) return null;

  const originHeader = req.get("origin")?.trim();
  if (originHeader) {
    return normalizeBaseUrl(originHeader);
  }

  const host = getRequestHost(req);
  if (host && isLocalLikeHost(host)) {
    return `http://${host}:8081`;
  }

  return null;
}

