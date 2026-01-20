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
  mustChangePassword?: boolean;
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
  authLastError: string | null;
  activeTenantRole: UserRole | null;
  effectiveRole: UserRole | null;
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
  refreshMe: () => Promise<AuthUser | null>;
  refreshTenants: (roleOverride?: UserRole) => Promise<void>;
  setActiveTenantId: (id: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue>({
  loading: true,
  token: null,
  user: null,
  authLastError: null,
  activeTenantRole: null,
  effectiveRole: null,
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
  refreshMe: async () => null,
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
  const [authLastError, setAuthLastError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [membershipRolesByTenantId, setMembershipRolesByTenantId] = useState<Record<string, UserRole>>({});
  const [tenantsLoaded, setTenantsLoaded] = useState(false);
  const [tenantChosenThisSession, setTenantChosenThisSession] = useState(false);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [apiLastCheckedAt, setApiLastCheckedAt] = useState<number | null>(null);
  const [apiLastError, setApiLastError] = useState<string | null>(null);
  const apiPollingRef = useRef(false);

  const refreshMe = useCallback(async (): Promise<AuthUser | null> => {
    if (!token) return null;
    const res = await apiRequest<{ ok: true; user: AuthUser; token?: string }>("/auth/me", {
      method: "GET",
      token,
    });
    setUser(res.user);
    if (res.token && res.token !== token) {
      await setToken(res.token);
      setTokenState(res.token);
    }
    return res.user;
  }, [token]);

  const refreshTenants = useCallback(async (roleOverride?: UserRole) => {
    if (!token) return;

    const effectiveRole = roleOverride ?? user?.role;
    const endpoint = effectiveRole === "admin" ? "/tenants" : "/tenants/mine";
    const res = await apiRequest<{ ok: true; tenants: TenantInfo[]; memberships?: Array<{ tenantId: string; role: UserRole }> }>(endpoint, {
      method: "GET",
      token,
    });

    const list = Array.isArray(res.tenants) ? res.tenants : [];
    setTenants(list);
    setTenantsLoaded(true);

    if (effectiveRole === "admin") {
      const map: Record<string, UserRole> = {};
      for (const t of list) {
        map[t.id] = "admin";
      }
      setMembershipRolesByTenantId(map);
    } else {
      const map: Record<string, UserRole> = {};
      for (const m of Array.isArray(res.memberships) ? res.memberships : []) {
        if (m?.tenantId && m?.role) {
          map[String(m.tenantId)] = m.role;
        }
      }
      setMembershipRolesByTenantId(map);
    }

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

  const activeTenantRole = useMemo<UserRole | null>(() => {
    if (!activeTenantId) return null;
    if (user?.role === "admin") return "admin";
    return membershipRolesByTenantId[activeTenantId] ?? null;
  }, [activeTenantId, membershipRolesByTenantId, user?.role]);

  const effectiveRole = useMemo<UserRole | null>(() => {
    return activeTenantRole;
  }, [activeTenantRole]);

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
        setMembershipRolesByTenantId({});
        setTenantsLoaded(false);
        setTenantChosenThisSession(false);
        setActiveTenantIdState(null);
        setApiTenantId(null);
        return;
      }
      try {
        const me = await refreshMe();
        setTenantChosenThisSession(false);
        await refreshTenants(me?.role ?? undefined);
        setAuthLastError(null);
      } catch (e) {
        if (cancelled) return;
        setAuthLastError(e instanceof Error ? e.message : "Signed out");
        await clearToken();
        await clearActiveTenantId();
        setTokenState(null);
        setUser(null);
        setTenants([]);
        setMembershipRolesByTenantId({});
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
    if (!token) return;
    let cancelled = false;

    const id = setInterval(() => {
      if (cancelled) return;
      (async () => {
        try {
          const me = await refreshMe();
          await refreshTenants(me?.role ?? undefined);
        } catch {
          // ignore
        }
      })();
    }, 120_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshMe, refreshTenants, token]);

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
    setAuthLastError(null);
    const res = await apiRequest<{ ok: true; token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      timeoutMs: 25000,
      body: JSON.stringify({ email, password }),
    });

    await setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    await refreshTenants(res.user.role);
  }, [refreshTenants]);

  const signUp = useCallback(async (name: string, email: string, password: string, inviteCode?: string) => {
    const res = await apiRequest<{ ok: true; token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      timeoutMs: 25000,
      body: JSON.stringify({ name, email, password, inviteCode: inviteCode ? inviteCode.trim() : undefined }),
    });

    await setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    await refreshTenants(res.user.role);
  }, [refreshTenants]);

  const signOut = useCallback(async () => {
    setAuthLastError(null);
    await clearToken();
    await clearActiveTenantId();
    setTokenState(null);
    setUser(null);
    setTenants([]);
    setMembershipRolesByTenantId({});
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
      authLastError,
      activeTenantRole,
      effectiveRole,
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
      authLastError,
      activeTenantRole,
      effectiveRole,
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
