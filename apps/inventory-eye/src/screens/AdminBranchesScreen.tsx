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

const roles: UserRole[] = ["inventory_staff", "manager", "admin"];

export function AdminBranchesScreen({ navigation }: Props) {
  const { token, user, effectiveRole, tenants, activeTenantId, setActiveTenantId, refreshTenants } = useContext(AuthContext);
  const isSuperAdmin = user?.role === "admin";
  const isBranchAdmin = effectiveRole === "admin";

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState<UserRole>("inventory_staff");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("inventory_staff");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [members, setMembers] = useState<BranchMember[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserRow[]>([]);
  const [adminTab, setAdminTab] = useState<"members" | "add" | "invites" | "users">("members");
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

  useEffect(() => {
    if (!token) return;
    if (!isBranchAdmin) {
      setMembers([]);
      return;
    }
    loadMembers(activeTenantId).catch(() => undefined);
  }, [activeTenantId, isBranchAdmin, loadMembers, token]);

  const loadAllUsers = useCallback(async () => {
    if (!token || !isSuperAdmin) return;
    const res = await apiRequest<{ ok: true; users: AdminUserRow[] }>("/admin/users-with-memberships", { method: "GET", token });
    setAllUsers(Array.isArray(res.users) ? res.users : []);
  }, [isSuperAdmin, token]);

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
        body: JSON.stringify({ email: clean, role: inviteRole }),
      });
      setInviteCode(res.invite.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(userId: string, email: string) {
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
  }

  async function assignUserToActiveBranch(userId: string) {
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
  }

  async function updateMemberRole(userId: string, role: UserRole) {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) return;

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
  }

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      setError(null);
      refreshTenants().catch(() => undefined);
      if (isBranchAdmin) {
        loadMembers(activeTenantId).catch(() => undefined);
      }
      if (isSuperAdmin) {
        loadAllUsers().catch(() => undefined);
      }
    }, [activeTenantId, isBranchAdmin, isSuperAdmin, loadAllUsers, loadMembers, refreshTenants, token])
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
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to switch branch");
      } finally {
        setBusy(false);
      }
    },
    [isBranchAdmin, loadMembers, setActiveTenantId]
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
      await apiRequest<{ ok: true }>("/tenants", {
        method: "POST",
        token,
        body: JSON.stringify({ name: cleanName, slug: cleanSlug }),
      });
      setName("");
      setSlug("");
      await refreshTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create branch");
    } finally {
      setBusy(false);
    }
  }

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
        body: JSON.stringify({ email: cleanEmail, role: memberRole }),
      });
      setEmail("");
      await loadMembers(activeTenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
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
  }

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
          <View style={{ height: 12 }} />
          <View style={{ gap: 10 }}>
            {list.length ? (
              list.map((t) => (
                <ListRow
                  key={t.id}
                  title={t.name}
                  subtitle={t.slug}
                  right={t.id === activeTenantId ? <Badge label="Active" tone="success" /> : undefined}
                  onPress={() => selectBranch(t.id)}
                />
              ))
            ) : (
              <MutedText>No branches found.</MutedText>
            )}
          </View>
        </Card>

        {isBranchAdmin ? (
          <>
            {isSuperAdmin ? (
              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Create branch</Text>
                <TextField value={name} onChangeText={setName} placeholder="Branch name" autoCapitalize="words" />
                <View style={{ height: 10 }} />
                <TextField value={slug} onChangeText={setSlug} placeholder="slug (e.g. dome)" autoCapitalize="none" />
                <View style={{ height: 12 }} />
                <AppButton title={busy ? "Working..." : "Create"} onPress={createBranch} disabled={busy} />
              </Card>
            ) : null}

            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Users</Text>
              {!activeTenantId ? (
                <MutedText>Select an active branch above to manage users.</MutedText>
              ) : (
                <>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <AppButton title="Members" onPress={() => setAdminTab("members")} variant={adminTab === "members" ? "primary" : "secondary"} />
                    <AppButton title="Add user" onPress={() => setAdminTab("add")} variant={adminTab === "add" ? "primary" : "secondary"} />
                    <AppButton title="Invites" onPress={() => setAdminTab("invites")} variant={adminTab === "invites" ? "primary" : "secondary"} />
                    {isSuperAdmin ? (
                      <AppButton title="All users" onPress={() => setAdminTab("users")} variant={adminTab === "users" ? "primary" : "secondary"} />
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
                      </View>
                      <View style={{ height: 12 }} />
                      <AppButton title={busy ? "Working..." : "Add user"} onPress={addMember} disabled={busy} variant="secondary" />
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
                          <AppButton key={`invite-${r}`} title={r} onPress={() => setInviteRole(r)} variant={inviteRole === r ? "primary" : "secondary"} />
                        ))}
                      </View>
                      <View style={{ height: 12 }} />
                      <AppButton title={busy ? "Working..." : "Create invite"} onPress={createInvite} disabled={busy} variant="secondary" />
                      {inviteCode ? (
                        <>
                          <View style={{ height: 12 }} />
                          <Card style={{ backgroundColor: theme.colors.surface2 }}>
                            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Invite code</Text>
                            <View style={{ height: 8 }} />
                            <Text style={[theme.typography.body, { color: theme.colors.text }]} selectable>
                              {inviteCode}
                            </Text>
                          </Card>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {adminTab === "members" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Members</Text>
                      <View style={{ gap: 10 }}>
                        {members.length ? (
                          members.map((m) => (
                            <Card key={`${m.userId}-${m.tenantId}`}>
                              <ListRow
                                title={m.user?.name || m.user?.email || m.userId}
                                subtitle={m.user?.email || ""}
                                right={<Badge label={m.role} tone={m.role === "admin" ? "primary" : "default"} />}
                              />
                              <View style={{ height: 10 }} />
                              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                                {roles.map((r) => (
                                  <AppButton
                                    key={`${m.userId}-${r}`}
                                    title={r}
                                    onPress={() => updateMemberRole(m.userId, r)}
                                    variant={m.role === r ? "primary" : "secondary"}
                                    disabled={busy}
                                  />
                                ))}
                              </View>
                              <View style={{ height: 10 }} />
                              <AppButton title="Remove" onPress={() => removeMember(m.userId)} variant="secondary" disabled={busy} />
                            </Card>
                          ))
                        ) : (
                          <MutedText>No members found.</MutedText>
                        )}
                      </View>
                    </>
                  ) : null}

                  {adminTab === "users" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>All users</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <Badge label={`Total: ${allUsers.length}`} tone="default" />
                        <Badge label={`Unassigned: ${allUsers.filter((u) => (u.tenantCount ?? 0) === 0).length}`} tone="warning" />
                      </View>
                      <View style={{ height: 12 }} />
                      <MutedText>Select a role in Add user, then assign users to the active branch.</MutedText>
                      <View style={{ height: 12 }} />
                      <View style={{ gap: 10 }}>
                        {allUsers.length ? (
                          allUsers.map((u) => (
                            <Card key={u.id} style={(u.tenantCount ?? 0) === 0 ? { borderColor: theme.colors.warning } : undefined}>
                              <ListRow
                                title={u.name || u.email}
                                subtitle={u.email}
                                right={
                                  <Badge
                                    label={(u.tenantCount ?? 0) === 0 ? "Unassigned" : `Branches: ${u.tenantCount}`}
                                    tone={(u.tenantCount ?? 0) === 0 ? "warning" : "default"}
                                  />
                                }
                              />
                              <View style={{ height: 10 }} />
                              {(u.tenants?.length ?? 0) > 0 ? (
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                  {u.tenants?.slice(0, 6).map((t) => <Badge key={`${u.id}-${t.id}`} label={t.name} tone="default" />)}
                                  {(u.tenants?.length ?? 0) > 6 ? <Badge label={`+${(u.tenants?.length ?? 0) - 6} more`} tone="default" /> : null}
                                </View>
                              ) : (
                                <MutedText>No branches</MutedText>
                              )}
                              <View style={{ height: 10 }} />
                              <AppButton
                                title={activeTenantId ? "Assign to active branch" : "Select a branch to assign"}
                                onPress={() => assignUserToActiveBranch(u.id)}
                                disabled={busy || !activeTenantId}
                                variant="secondary"
                              />
                              <View style={{ height: 10 }} />
                              <AppButton
                                title="Delete user"
                                onPress={() => deleteUser(u.id, u.email)}
                                disabled={busy}
                                variant="secondary"
                              />
                            </Card>
                          ))
                        ) : (
                          <MutedText>No users found.</MutedText>
                        )}
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
