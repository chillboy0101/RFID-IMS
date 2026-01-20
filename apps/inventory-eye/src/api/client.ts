import { API_BASE_URL } from "../config";
import { getApiTenantId } from "./tenant";

export type ApiError = {
  ok: false;
  error: string;
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null; timeoutMs?: number } = {}
): Promise<T> {
  const { token, timeoutMs = 20000, ...init } = options;

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

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const doFetch = async () => {
    const url = `${API_BASE_URL}${path}`;

    if (!init.signal && typeof AbortController !== "undefined") {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller?.abort(), timeoutMs);
      return fetch(url, { ...init, headers, signal: controller.signal });
    }

    if (timeoutMs > 0) {
      return (await Promise.race([
        fetch(url, { ...init, headers }),
        new Promise<Response>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
        }),
      ])) as Response;
    }

    return fetch(url, { ...init, headers });
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw e instanceof Error ? e : new Error("Network error");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

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
