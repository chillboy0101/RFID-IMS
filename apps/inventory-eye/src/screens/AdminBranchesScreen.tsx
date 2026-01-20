import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext, type UserRole } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "Branches">;

type TenantInfo = {
  id: string;
  name: string;
  slug: string;
};

type BranchMember = {
  tenantId: string;
  userId: string;
  role: UserRole;
  user?: { id: string; name: string; email: string; role: UserRole } | null;
};

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantIds: string[];
  tenantCount: number;
  tenants?: TenantInfo[];
};

type TenantSessionRow = {
  jti: string;
  userId: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent?: boolean;
  user: { id: string; name: string; email: string; role: UserRole } | null;
};

const roles: UserRole[] = ["inventory_staff", "manager", "admin"];

type BranchRowProps = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  onSelect: (tenantId: string) => void;
};

const BranchRow = React.memo(function BranchRow({ id, name, slug, isActive, onSelect }: BranchRowProps) {
  return (
    <ListRow
      title={name}
      subtitle={slug}
      right={isActive ? <Badge label="Active" tone="success" /> : undefined}
      onPress={() => onSelect(id)}
    />
  );
});

type MemberCardProps = {
  member: BranchMember;
  busy: boolean;
  isSuperAdmin: boolean;
  onUpdateMemberRole: (userId: string, role: UserRole) => void;
  onUpdateGlobalRole: (userId: string, nextRole: UserRole) => void;
  onRemoveMember: (userId: string) => void;
};

const MemberCard = React.memo(function MemberCard({ member, busy, isSuperAdmin, onUpdateMemberRole, onUpdateGlobalRole, onRemoveMember }: MemberCardProps) {
  const displayRole = member.user?.role === "admin" ? "super_admin" : member.role;
  const displayTone = member.user?.role === "admin" ? "warning" : member.role === "admin" ? "primary" : "default";

  return (
    <Card>
      <ListRow
        title={member.user?.name || member.user?.email || member.userId}
        subtitle={member.user?.email || ""}
        right={<Badge label={displayRole} tone={displayTone} />}
      />
      <View style={{ height: 10 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {roles.map((r) => (
          <AppButton
            key={`${member.userId}-${r}`}
            title={r}
            onPress={() => onUpdateMemberRole(member.userId, r)}
            variant={member.role === r ? "primary" : "secondary"}
            disabled={busy}
          />
        ))}
        {isSuperAdmin ? (
          <AppButton
            title={member.user?.role === "admin" ? "Remove super-admin" : "Make super-admin"}
            onPress={() => onUpdateGlobalRole(member.userId, member.user?.role === "admin" ? "inventory_staff" : "admin")}
            disabled={busy}
            variant="secondary"
          />
        ) : null}
      </View>
      <View style={{ height: 10 }} />
      <AppButton title="Remove" onPress={() => onRemoveMember(member.userId)} variant="secondary" disabled={busy} />
    </Card>
  );
});

type SessionCardProps = {
  session: TenantSessionRow;
  busy: boolean;
  isSuperAdmin: boolean;
  onRevoke: (jti: string, isCurrent?: boolean) => void;
};

const SessionCard = React.memo(function SessionCard({ session, busy, onRevoke }: SessionCardProps) {
  return (
    <Card>
      <ListRow title={session.user?.name || session.user?.email || session.userId} subtitle={session.user?.email || ""} right={<Badge label="Active" tone="success" />} />
      <View style={{ height: 10 }} />
      <AppButton
        title="Force sign-out"
        onPress={() => onRevoke(session.jti, session.isCurrent)}
        disabled={busy || Boolean(session.isCurrent)}
        variant="secondary"
      />
    </Card>
  );
});

type AllUserCardProps = {
  user: AdminUserRow;
  busy: boolean;
  activeTenantId: string | null;
  onAssignToActive: (userId: string) => void;
  onDelete: (userId: string, email: string) => void;
};

const AllUserCard = React.memo(function AllUserCard({ user, busy, activeTenantId, onAssignToActive, onDelete }: AllUserCardProps) {
  return (
    <Card key={user.id} style={(user.tenantCount ?? 0) === 0 ? { borderColor: theme.colors.warning } : undefined}>
      <ListRow
        title={user.name || user.email}
        subtitle={user.email}
        right={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <Badge label={user.role === "admin" ? "super_admin" : user.role} tone={user.role === "admin" ? "warning" : user.role === "manager" ? "primary" : "default"} />
            <Badge
              label={(user.tenantCount ?? 0) === 0 ? "Unassigned" : `Branches: ${user.tenantCount}`}
              tone={(user.tenantCount ?? 0) === 0 ? "warning" : "default"}
            />
          </View>
        }
      />
      <View style={{ height: 10 }} />
      {(user.tenants?.length ?? 0) > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {user.tenants?.slice(0, 6).map((t) => <Badge key={`${user.id}-${t.id}`} label={t.name} tone="default" />)}
          {(user.tenants?.length ?? 0) > 6 ? <Badge label={`+${(user.tenants?.length ?? 0) - 6} more`} tone="default" /> : null}
        </View>
      ) : (
        <MutedText>No branches</MutedText>
      )}
      <View style={{ height: 10 }} />
      <AppButton
        title={activeTenantId ? "Assign to active branch" : "Select a branch to assign"}
        onPress={() => onAssignToActive(user.id)}
        disabled={busy || !activeTenantId}
        variant="secondary"
      />
      <View style={{ height: 10 }} />
      <AppButton title="Delete user" onPress={() => onDelete(user.id, user.email)} disabled={busy} variant="secondary" />
    </Card>
  );
});

export function AdminBranchesScreen({ navigation }: Props) {
  const { token, user, effectiveRole, tenants, activeTenantId, setActiveTenantId, refreshMe, refreshTenants } = useContext(AuthContext);
  const isSuperAdmin = user?.role === "admin";
  const isBranchAdmin = effectiveRole === "admin";

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState<UserRole>("inventory_staff");
  const [memberMakeSuperAdmin, setMemberMakeSuperAdmin] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("inventory_staff");
  const [inviteMakeSuperAdmin, setInviteMakeSuperAdmin] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [members, setMembers] = useState<BranchMember[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserRow[]>([]);
  const [branchTab, setBranchTab] = useState<"list" | "create">("list");
  const [adminTab, setAdminTab] = useState<"members" | "add" | "invites" | "sessions" | "users">("members");
  const [createUserName, setCreateUserName] = useState("");
  const [createUserEmail, setCreateUserEmail] = useState("");
  const [createUserPassword, setCreateUserPassword] = useState("");
  const [createUserRole, setCreateUserRole] = useState<UserRole>("inventory_staff");
  const [createUserMakeSuperAdmin, setCreateUserMakeSuperAdmin] = useState(false);
  const [sessions, setSessions] = useState<TenantSessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => (Array.isArray(tenants) ? (tenants as TenantInfo[]) : []), [tenants]);

  const loadMembers = useCallback(
    async (tenantId: string | null) => {
      if (!token || !isBranchAdmin) return;
      if (!tenantId) {
        setMembers([]);
        return;
      }
      const res = await apiRequest<{ ok: true; members: BranchMember[] }>(`/tenants/${tenantId}/members`, { method: "GET", token });
      setMembers(Array.isArray(res.members) ? res.members : []);
    },
    [isBranchAdmin, token]
  );

  const loadSessions = useCallback(
    async (tenantId: string | null) => {
      if (!token || !isBranchAdmin) return;
      if (!tenantId) {
        setSessions([]);
        return;
      }
      const res = await apiRequest<{ ok: true; sessions: TenantSessionRow[] }>(`/tenants/${tenantId}/sessions`, { method: "GET", token });
      setSessions(Array.isArray(res.sessions) ? res.sessions : []);
    },
    [isBranchAdmin, token]
  );

  useEffect(() => {
    if (!token) return;
    if (!isBranchAdmin) {
      setMembers([]);
      return;
    }
    if (adminTab !== "members") return;
    loadMembers(activeTenantId).catch(() => undefined);
  }, [activeTenantId, adminTab, isBranchAdmin, loadMembers, token]);

  useEffect(() => {
    if (!token) return;
    if (!isBranchAdmin) return;
    if (!activeTenantId) return;
    if (adminTab !== "sessions") return;
    loadSessions(activeTenantId).catch(() => undefined);
  }, [activeTenantId, adminTab, isBranchAdmin, loadSessions, token]);

  const loadAllUsers = useCallback(async () => {
    if (!token || !isSuperAdmin) return;
    const res = await apiRequest<{ ok: true; users: AdminUserRow[] }>("/admin/users-with-memberships", { method: "GET", token });
    setAllUsers(Array.isArray(res.users) ? res.users : []);
  }, [isSuperAdmin, token]);

  const unassignedUsersCount = useMemo(() => {
    let count = 0;
    for (const u of allUsers) {
      if ((u.tenantCount ?? 0) === 0) count++;
    }
    return count;
  }, [allUsers]);

  const createUserInActiveBranch = useCallback(async () => {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }

    const cleanName = createUserName.trim();
    const cleanEmail = createUserEmail.trim().toLowerCase();
    const cleanPassword = createUserPassword;
    if (!cleanName || !cleanEmail || !cleanPassword) {
      setError("Name, email and password are required");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/users`, {
        method: "POST",
        token,
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          password: cleanPassword,
          role: createUserRole,
          makeSuperAdmin: isSuperAdmin ? createUserMakeSuperAdmin : false,
        }),
      });
      setCreateUserName("");
      setCreateUserEmail("");
      setCreateUserPassword("");
      setCreateUserRole("inventory_staff");
      setCreateUserMakeSuperAdmin(false);
      await loadMembers(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, createUserEmail, createUserMakeSuperAdmin, createUserName, createUserPassword, createUserRole, isBranchAdmin, isSuperAdmin, loadMembers, token]);

  const confirmAction = useCallback(async (title: string, message: string): Promise<boolean> => {
    if (Platform.OS === "web") {
      return !!(globalThis as any).confirm?.(`${title}\n\n${message}`);
    }
    return await new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
      ]);
    });
  }, []);

  const revokeSession = useCallback(async (jti: string, isCurrent?: boolean) => {
    if (!token || !activeTenantId || busy) return;

    if (isCurrent) {
      setError("Cannot sign out the current session");
      return;
    }

    const ok = await confirmAction("Force sign-out", "Force sign-out this user from this branch?");
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      if (isSuperAdmin) {
        await apiRequest<{ ok: true }>(`/admin/sessions/${encodeURIComponent(jti)}/revoke`, { method: "POST", token });
      } else {
        await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/sessions/${encodeURIComponent(jti)}/revoke`, { method: "POST", token });
      }
      await loadSessions(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke session");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, confirmAction, isSuperAdmin, loadSessions, token]);

  const updateGlobalRole = useCallback(
    async (userId: string, role: UserRole) => {
      if (!token || !isSuperAdmin || busy) return;

      const ok = await confirmAction(
        "Change global role",
        role === "admin"
          ? "Promote this user to super-admin? This grants full access to all branches and global admin actions."
          : "Remove super-admin from this user? They will only have access via branch membership roles."
      );
      if (!ok) return;

      setBusy(true);
      setError(null);
      try {
        await apiRequest<{ ok: true }>(`/admin/users/${userId}/role`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ role }),
        });
        await loadAllUsers();
        await refreshTenants();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update global role");
      } finally {
        setBusy(false);
      }
    },
    [busy, confirmAction, isSuperAdmin, loadAllUsers, refreshTenants, token]
  );

  async function createInvite() {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }

    const clean = inviteEmail.trim().toLowerCase();
    if (!clean) {
      setError("Invite email is required");
      return;
    }

    setBusy(true);
    setError(null);
    setInviteCode(null);
    try {
      const res = await apiRequest<{ ok: true; invite: { code: string } }>(`/tenants/${activeTenantId}/invites`, {
        method: "POST",
        token,
        body: JSON.stringify({
          email: clean,
          role: inviteRole,
          makeSuperAdmin: isSuperAdmin ? inviteMakeSuperAdmin : false,
        }),
      });
      setInviteCode(res.invite.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  }

  const deleteUser = useCallback(async (userId: string, email: string) => {
    if (!token || !isSuperAdmin) return;

    const message = `Delete ${email}? This cannot be undone.`;
    const confirmed =
      Platform.OS === "web" ? !!(globalThis as any).confirm?.(message) : await new Promise<boolean>((resolve) => {
        Alert.alert("Delete user", message, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Delete", style: "destructive", onPress: () => resolve(true) },
        ]);
      });

    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/admin/users/${userId}`, { method: "DELETE", token });
      await Promise.all([loadMembers(activeTenantId), loadAllUsers()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, isSuperAdmin, loadAllUsers, loadMembers, token]);

  const assignUserToActiveBranch = useCallback(async (userId: string) => {
    if (!token || !isSuperAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members`, {
        method: "POST",
        token,
        body: JSON.stringify({ userId, role: memberRole }),
      });
      await Promise.all([loadMembers(activeTenantId), loadAllUsers()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, isSuperAdmin, loadAllUsers, loadMembers, memberRole, token]);

  const updateMemberRole = useCallback(async (userId: string, role: UserRole) => {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) return;
    if (busy) return;

    const ok = await confirmAction(
      "Change branch role",
      role === "admin" ? "Promote this user to branch admin for the active branch?" : `Set this user's role to ${role} for the active branch?`
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members`, {
        method: "POST",
        token,
        body: JSON.stringify({ userId, role }),
      });
      await loadMembers(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, confirmAction, isBranchAdmin, loadMembers, token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      setError(null);
      refreshTenants().catch(() => undefined);
      if (isBranchAdmin) {
        if (adminTab === "members") {
          loadMembers(activeTenantId).catch(() => undefined);
        }
        if (adminTab === "sessions") {
          loadSessions(activeTenantId).catch(() => undefined);
        }
      }
      if (isSuperAdmin) {
        if (adminTab === "users") {
          loadAllUsers().catch(() => undefined);
        }
      }
    }, [activeTenantId, adminTab, isBranchAdmin, isSuperAdmin, loadAllUsers, loadMembers, loadSessions, refreshTenants, token])
  );

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const selectBranch = useCallback(
    async (tenantId: string) => {
      setBusy(true);
      setError(null);
      try {
        await setActiveTenantId(tenantId);
        if (isBranchAdmin) {
          await loadMembers(tenantId);
          await loadSessions(tenantId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to switch branch");
      } finally {
        setBusy(false);
      }
    },
    [isBranchAdmin, loadMembers, loadSessions, setActiveTenantId]
  );

  async function createBranch() {
    if (!token || !isSuperAdmin) return;
    const cleanName = name.trim();
    const cleanSlug = slug.trim().toLowerCase();
    if (!cleanName || !cleanSlug) {
      setError("Name and slug are required");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; tenant?: { id: string } }>("/tenants", {
        method: "POST",
        token,
        body: JSON.stringify({ name: cleanName, slug: cleanSlug }),
      });
      setName("");
      setSlug("");
      await refreshTenants();
      if (res?.tenant?.id) {
        await setActiveTenantId(res.tenant.id);
      }
      setBranchTab("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create branch");
    } finally {
      setBusy(false);
    }
  }

  const selectAdminTab = useCallback(
    async (tab: "members" | "add" | "invites" | "sessions" | "users") => {
      setAdminTab(tab);
      if (tab === "sessions") {
        await refreshMe().catch(() => undefined);
      }
      if (tab === "members") {
        await loadMembers(activeTenantId).catch(() => undefined);
      }
      if (tab === "users" && isSuperAdmin) {
        await loadAllUsers().catch(() => undefined);
      }
    },
    [activeTenantId, isSuperAdmin, loadAllUsers, loadMembers, refreshMe]
  );

  async function addMember() {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email is required");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members`, {
        method: "POST",
        token,
        body: JSON.stringify({
          email: cleanEmail,
          role: memberRole,
          makeSuperAdmin: isSuperAdmin ? memberMakeSuperAdmin : false,
        }),
      });
      setEmail("");
      setMemberRole("inventory_staff");
      setMemberMakeSuperAdmin(false);
      await loadMembers(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  const removeMember = useCallback(async (userId: string) => {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) return;

    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members/${userId}`, {
        method: "DELETE",
        token,
      });
      await loadMembers(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, isBranchAdmin, loadMembers, token]);

  const branchRows = useMemo(() => {
    return list.map((t) => <BranchRow key={t.id} id={t.id} name={t.name} slug={t.slug} isActive={t.id === activeTenantId} onSelect={selectBranch} />);
  }, [activeTenantId, list, selectBranch]);

  const memberCards = useMemo(() => {
    return members.map((m) => (
      <MemberCard
        key={`${m.userId}-${m.tenantId}`}
        member={m}
        busy={busy}
        isSuperAdmin={isSuperAdmin}
        onUpdateMemberRole={updateMemberRole}
        onUpdateGlobalRole={updateGlobalRole}
        onRemoveMember={removeMember}
      />
    ));
  }, [busy, isSuperAdmin, members, removeMember, updateGlobalRole, updateMemberRole]);

  const sessionCards = useMemo(() => {
    return sessions.map((s) => <SessionCard key={s.jti} session={s} busy={busy} isSuperAdmin={isSuperAdmin} onRevoke={revokeSession} />);
  }, [busy, isSuperAdmin, revokeSession, sessions]);

  const allUserCards = useMemo(() => {
    return allUsers.map((u) => (
      <AllUserCard
        key={u.id}
        user={u}
        busy={busy}
        activeTenantId={activeTenantId}
        onAssignToActive={assignUserToActiveBranch}
        onDelete={deleteUser}
      />
    ));
  }, [activeTenantId, allUsers, assignUserToActiveBranch, busy, deleteUser]);

  return (
    <Screen
      title="Branches and Users"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      busy={busy}
    >
      <View style={{ gap: theme.spacing.md }}>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Branches</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Badge label={`Total: ${list.length}`} tone="default" />
            <Badge label={activeTenantId ? "Active: set" : "Active: not set"} tone={activeTenantId ? "success" : "warning"} />
          </View>
          {isSuperAdmin ? (
            <>
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <AppButton title="Branches" onPress={() => setBranchTab("list")} variant={branchTab === "list" ? "primary" : "secondary"} />
                <AppButton
                  title="Create branch"
                  onPress={() => setBranchTab("create")}
                  variant={branchTab === "create" ? "primary" : "secondary"}
                  disabled={busy}
                />
              </View>
            </>
          ) : null}
          <View style={{ height: 12 }} />
          {branchTab === "create" && isSuperAdmin ? (
            <>
              <TextField value={name} onChangeText={setName} placeholder="Branch name" autoCapitalize="words" />
              <View style={{ height: 10 }} />
              <TextField value={slug} onChangeText={setSlug} placeholder="slug (e.g. dome)" autoCapitalize="none" />
              <View style={{ height: 12 }} />
              <AppButton title="Create" onPress={createBranch} disabled={busy} loading={busy} />
            </>
          ) : (
            <View style={{ gap: 10 }}>
              {list.length ? branchRows : <MutedText>No branches found.</MutedText>}
            </View>
          )}
        </Card>

        {isBranchAdmin ? (
          <>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Users</Text>
              {!activeTenantId ? (
                <MutedText>Select an active branch above to manage users.</MutedText>
              ) : (
                <>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <AppButton title="Members" onPress={() => selectAdminTab("members")} variant={adminTab === "members" ? "primary" : "secondary"} />
                    <AppButton title="Add user" onPress={() => selectAdminTab("add")} variant={adminTab === "add" ? "primary" : "secondary"} />
                    <AppButton title="Invites" onPress={() => selectAdminTab("invites")} variant={adminTab === "invites" ? "primary" : "secondary"} />
                    <AppButton title="Active sessions" onPress={() => selectAdminTab("sessions")} variant={adminTab === "sessions" ? "primary" : "secondary"} />
                    {isSuperAdmin ? (
                      <AppButton title="All users" onPress={() => selectAdminTab("users")} variant={adminTab === "users" ? "primary" : "secondary"} />
                    ) : null}
                  </View>

                  {adminTab === "add" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <MutedText>Add user to the active branch by email.</MutedText>
                      <View style={{ height: 12 }} />
                      <TextField value={email} onChangeText={setEmail} placeholder="user@email.com" autoCapitalize="none" keyboardType="email-address" />
                      <View style={{ height: 10 }} />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {roles.map((r) => (
                          <AppButton key={r} title={r} onPress={() => setMemberRole(r)} variant={memberRole === r ? "primary" : "secondary"} />
                        ))}
                        {isSuperAdmin ? (
                          <AppButton
                            title="super_admin"
                            onPress={() => setMemberMakeSuperAdmin((v) => !v)}
                            variant={memberMakeSuperAdmin ? "primary" : "secondary"}
                            disabled={busy}
                          />
                        ) : null}
                      </View>
                      <View style={{ height: 12 }} />
                      <AppButton title="Add user" onPress={addMember} disabled={busy} loading={busy} variant="secondary" />

                      <View style={{ height: theme.spacing.lg }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Create user</Text>
                      <TextField value={createUserName} onChangeText={setCreateUserName} placeholder="Full name" autoCapitalize="words" />
                      <View style={{ height: 10 }} />
                      <TextField
                        value={createUserEmail}
                        onChangeText={setCreateUserEmail}
                        placeholder="user@email.com"
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                      <View style={{ height: 10 }} />
                      <TextField value={createUserPassword} onChangeText={setCreateUserPassword} placeholder="Temporary password" secureTextEntry />
                      <View style={{ height: 10 }} />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {roles.map((r) => (
                          <AppButton
                            key={`create-${r}`}
                            title={r}
                            onPress={() => setCreateUserRole(r)}
                            variant={createUserRole === r ? "primary" : "secondary"}
                            disabled={busy}
                          />
                        ))}
                        {isSuperAdmin ? (
                          <AppButton
                            title="super_admin"
                            onPress={() => setCreateUserMakeSuperAdmin((v) => !v)}
                            variant={createUserMakeSuperAdmin ? "primary" : "secondary"}
                            disabled={busy}
                          />
                        ) : null}
                      </View>
                      <View style={{ height: 12 }} />
                      <AppButton title="Create user" onPress={createUserInActiveBranch} disabled={busy} loading={busy} variant="secondary" />
                    </>
                  ) : null}

                  {adminTab === "invites" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Invites</Text>
                      <MutedText>Create an invite code and share it with the user to join this branch.</MutedText>
                      <View style={{ height: 12 }} />
                      <TextField
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                        placeholder="Invite email (required)"
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                      <View style={{ height: 10 }} />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {roles.map((r) => (
                          <AppButton key={r} title={r} onPress={() => setInviteRole(r)} variant={inviteRole === r ? "primary" : "secondary"} />
                        ))}
                        {isSuperAdmin ? (
                          <AppButton
                            title="super_admin"
                            onPress={() => setInviteMakeSuperAdmin((v) => !v)}
                            variant={inviteMakeSuperAdmin ? "primary" : "secondary"}
                            disabled={busy}
                          />
                        ) : null}
                      </View>
                      <View style={{ height: 12 }} />
                      <AppButton title="Create invite" onPress={createInvite} disabled={busy} loading={busy} variant="secondary" />
                      {inviteCode ? (
                        <>
                          <View style={{ height: 12 }} />
                          <Text selectable style={[theme.typography.body, { color: theme.colors.text }]}>Invite code: {inviteCode}</Text>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {adminTab === "members" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Members</Text>
                      <View style={{ gap: 10 }}>
                        {members.length ? memberCards : <MutedText>No members found.</MutedText>}
                      </View>
                    </>
                  ) : null}

                  {adminTab === "sessions" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Active sessions</Text>
                      <MutedText>{isSuperAdmin ? "Super-admin can sign out anyone." : "Branch admin can sign out users from this branch."}</MutedText>
                      <View style={{ height: 12 }} />
                      <View style={{ gap: 10 }}>
                        {sessions.length ? sessionCards : <MutedText>No active sessions found.</MutedText>}
                      </View>
                    </>
                  ) : null}

                  {adminTab === "users" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>All users</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <Badge label={`Total: ${allUsers.length}`} tone="default" />
                        <Badge label={`Unassigned: ${unassignedUsersCount}`} tone="warning" />
                      </View>
                      <View style={{ height: 12 }} />
                      <MutedText>Select a role in Add user, then assign users to the active branch.</MutedText>
                      <View style={{ height: 12 }} />
                      <View style={{ gap: 10 }}>
                        {allUsers.length ? allUserCards : <MutedText>No users found.</MutedText>}
                      </View>
                    </>
                  ) : null}
                </>
              )}
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
