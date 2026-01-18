import { NativeModules, Platform } from "react-native";

function tryParseHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

function isLanLikeHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "10.0.2.2") return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function getDevBundleHost(): string | null {
  const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;
  if (!scriptURL) return null;
  const m = scriptURL.match(/^https?:\/\/([^/:?#]+)(?::\d+)?/);
  return m?.[1] ?? null;
}

function getDefaultApiBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:4000`;
  }

  if (Platform.OS === "android") {
    return "http://10.0.2.2:4000";
  }

  return "http://localhost:4000";
}

const DEFAULT_API_BASE_URL = getDefaultApiBaseUrl();

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

let resolved = envUrl ?? DEFAULT_API_BASE_URL;

if (envUrl) {
  const envHost = tryParseHost(envUrl);

  if (Platform.OS === "web") {
    const webHost = typeof window !== "undefined" ? window.location?.hostname : null;
    if (envHost && webHost && isLanLikeHost(envHost) && envHost !== webHost) {
      resolved = envUrl.replace(envHost, webHost);
    }
  } else {
    const devHost = getDevBundleHost();
    if (envHost && devHost && isLanLikeHost(envHost) && envHost !== devHost) {
      resolved = envUrl.replace(envHost, devHost);
    }
  }
}

export const API_BASE_URL = resolved;
