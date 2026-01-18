import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiRequest } from "../api/client";
import { setApiTenantId } from "../api/tenant";
import { clearToken, getToken, setToken } from "./token";
import { clearActiveTenantId, getActiveTenantId, setActiveTenantId as persistActiveTenantId } from "./tenant";

export type UserRole = "inventory_staff" | "manager" | "admin";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type TenantInfo = {
  id: string;
  name: string;
  slug: string;
};

type AuthContextValue = {
  loading: boolean;
  token: string | null;
  user: AuthUser | null;
  tenants: TenantInfo[];
  tenantsLoaded: boolean;
  tenantChosenThisSession: boolean;
  activeTenantId: string | null;
  apiOnline: boolean | null;
  apiLastCheckedAt: number | null;
  apiLastError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshTenants: () => Promise<void>;
  setActiveTenantId: (id: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue>({
  loading: true,
  token: null,
  user: null,
  tenants: [],
  tenantsLoaded: false,
  tenantChosenThisSession: false,
  activeTenantId: null,
  apiOnline: null,
  apiLastCheckedAt: null,
  apiLastError: null,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
  refreshMe: async () => undefined,
  refreshTenants: async () => undefined,
  setActiveTenantId: async () => undefined,
});

type AuthProviderProps = {
  children: React.ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantsLoaded, setTenantsLoaded] = useState(false);
  const [tenantChosenThisSession, setTenantChosenThisSession] = useState(false);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [apiLastCheckedAt, setApiLastCheckedAt] = useState<number | null>(null);
  const [apiLastError, setApiLastError] = useState<string | null>(null);
  const apiPollingRef = useRef(false);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    const res = await apiRequest<{ ok: true; user: AuthUser; token?: string }>("/auth/me", {
      method: "GET",
      token,
    });
    setUser(res.user);
    if (res.token && res.token !== token) {
      await setToken(res.token);
      setTokenState(res.token);
    }
  }, [token]);

  const refreshTenants = useCallback(async () => {
    if (!token) return;

    const endpoint = user?.role === "admin" ? "/tenants" : "/tenants/mine";
    const res = await apiRequest<{ ok: true; tenants: TenantInfo[] }>(endpoint, {
      method: "GET",
      token,
    });

    const list = Array.isArray(res.tenants) ? res.tenants : [];
    setTenants(list);
    setTenantsLoaded(true);

    const stored = await getActiveTenantId();
    const preferred = activeTenantId ?? stored;
    const preferredOk = preferred && list.some((t) => t.id === preferred);
    const next = list.length === 1 ? list[0]?.id ?? null : preferredOk ? preferred : null;

    setActiveTenantIdState(next);
    setApiTenantId(next);
    if (next) {
      await persistActiveTenantId(next);
    } else {
      await clearActiveTenantId();
    }
  }, [activeTenantId, token, user?.role]);

  const setActiveTenantId = useCallback(
    async (id: string) => {
      const next = id?.trim() || null;
      if (!next) return;
      setActiveTenantIdState(next);
      setApiTenantId(next);
      await persistActiveTenantId(next);
      setTenantChosenThisSession(true);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getToken();
        if (cancelled) return;
        setTokenState(stored);
        setActiveTenantIdState(null);
        setApiTenantId(null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setUser(null);
        setTenants([]);
        setTenantsLoaded(false);
        setTenantChosenThisSession(false);
        setActiveTenantIdState(null);
        setApiTenantId(null);
        return;
      }
      try {
        await refreshMe();
        setTenantChosenThisSession(false);
        await refreshTenants();
      } catch {
        if (cancelled) return;
        await clearToken();
        await clearActiveTenantId();
        setTokenState(null);
        setUser(null);
        setTenants([]);
        setTenantsLoaded(false);
        setTenantChosenThisSession(false);
        setActiveTenantIdState(null);
        setApiTenantId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshMe, refreshTenants]);

  useEffect(() => {
    if (apiPollingRef.current) return;
    apiPollingRef.current = true;

    let cancelled = false;

    const ping = async () => {
      try {
        const timeoutMs = 3000;
        const res = (await Promise.race([
          apiRequest<{ ok: true; dbConnected: boolean }>("/health", { method: "GET" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), timeoutMs)),
        ])) as { ok: true; dbConnected: boolean };

        if (cancelled) return;
        setApiOnline(Boolean(res?.ok));
        setApiLastCheckedAt(Date.now());
        setApiLastError(null);
      } catch (e) {
        if (cancelled) return;
        setApiOnline(false);
        setApiLastCheckedAt(Date.now());
        setApiLastError(e instanceof Error ? e.message : "Health check failed");
      }
    };

    ping();
    const id = setInterval(ping, 15_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<{ ok: true; token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    await setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    await refreshTenants();
  }, [refreshTenants]);

  const signUp = useCallback(async (name: string, email: string, password: string, inviteCode?: string) => {
    const res = await apiRequest<{ ok: true; token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, inviteCode: inviteCode ? inviteCode.trim() : undefined }),
    });

    await setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    await refreshTenants();
  }, [refreshTenants]);

  const signOut = useCallback(async () => {
    await clearToken();
    await clearActiveTenantId();
    setTokenState(null);
    setUser(null);
    setTenants([]);
    setTenantsLoaded(false);
    setTenantChosenThisSession(false);
    setActiveTenantIdState(null);
    setApiTenantId(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      token,
      user,
      tenants,
      tenantsLoaded,
      tenantChosenThisSession,
      activeTenantId,
      apiOnline,
      apiLastCheckedAt,
      apiLastError,
      signIn,
      signUp,
      signOut,
      refreshMe,
      refreshTenants,
      setActiveTenantId,
    }),
    [
      loading,
      token,
      user,
      tenants,
      tenantsLoaded,
      tenantChosenThisSession,
      activeTenantId,
      apiOnline,
      apiLastCheckedAt,
      apiLastError,
      signIn,
      signUp,
      signOut,
      refreshMe,
      refreshTenants,
      setActiveTenantId,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
