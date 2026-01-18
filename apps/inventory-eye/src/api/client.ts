import { API_BASE_URL } from "../config";
import { getApiTenantId } from "./tenant";

export type ApiError = {
  ok: false;
  error: string;
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, ...init } = options;

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const tenantId = getApiTenantId();
  if (tenantId && !headers.has("X-Tenant-ID")) {
    headers.set("X-Tenant-ID", tenantId);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();

  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: text || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    if (typeof data === "object" && data && "error" in data) {
      throw new Error(String((data as any).error));
    }
    throw new Error(`HTTP ${res.status}`);
  }

  return data as T;
}
