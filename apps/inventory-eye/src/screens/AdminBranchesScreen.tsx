import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext, type UserRole } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
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
  user?: { id: string; name: string; email: string; role: UserRole; operatorTagId?: string | null } | null;
};

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  operatorTagId?: string | null;
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

type OperatorTagTarget = {
  userId: string;
  label: string;
  currentTag?: string | null;
  startedAt: string;
};

type StaffCardLatestResponse = {
  ok: true;
  event: { _id: string; tagId: string; observedAt: string } | null;
};

const roles: UserRole[] = ["inventory_staff", "manager", "admin"];
type AdminTab = "members" | "staffCards" | "add" | "sessions" | "users";

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
  onResendTemporaryPassword: (userId: string, email: string) => void;
  onAssignOperatorTag: (userId: string, label: string, currentTag?: string | null) => void;
  onRemoveOperatorTag: (userId: string, label: string) => void;
  onRemoveMember: (userId: string) => void;
};

const MemberCard = React.memo(function MemberCard({
  member,
  busy,
  isSuperAdmin,
  onUpdateMemberRole,
  onUpdateGlobalRole,
  onResendTemporaryPassword,
  onAssignOperatorTag,
  onRemoveOperatorTag,
  onRemoveMember,
}: MemberCardProps) {
  const displayRole = member.user?.role === "admin" ? "super_admin" : member.role;
  const displayTone = member.user?.role === "admin" ? "warning" : member.role === "admin" ? "primary" : "default";
  const memberEmail = member.user?.email || "";
  const memberLabel = member.user?.name || member.user?.email || member.userId;
  const operatorTagId = member.user?.operatorTagId ?? null;

  return (
    <Card>
      <ListRow
        title={memberLabel}
        subtitle={member.user?.email || ""}
        right={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <Badge label={displayRole} tone={displayTone} />
            <Badge label={operatorTagId ? "Staff card linked" : "No staff card"} tone={operatorTagId ? "success" : "default"} />
          </View>
        }
      />
      <View style={{ height: 10 }} />
      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.md,
          padding: 12,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "800" }}>Staff RFID card</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {operatorTagId || "Scan a staff card to identify this user at RFID readers."}
            </Text>
          </View>
          <Badge label={operatorTagId ? "Linked" : "Unassigned"} tone={operatorTagId ? "success" : "warning"} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <AppButton
            title={operatorTagId ? "Change card" : "Assign card"}
            onPress={() => onAssignOperatorTag(member.userId, memberLabel, operatorTagId)}
            variant="secondary"
            disabled={busy}
            iconName="radio-outline"
          />
          {operatorTagId ? (
            <AppButton
              title="Delete card"
              onPress={() => onRemoveOperatorTag(member.userId, memberLabel)}
              variant="secondary"
              disabled={busy}
              iconName="close-circle-outline"
            />
          ) : null}
        </View>
      </View>
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <AppButton
          title="Resend password email"
          onPress={() => onResendTemporaryPassword(member.userId, memberEmail)}
          variant="secondary"
          disabled={busy || !memberEmail}
        />
        <AppButton title="Remove" onPress={() => onRemoveMember(member.userId)} variant="secondary" disabled={busy} />
      </View>
    </Card>
  );
});

type StaffOperatorCardProps = {
  member: BranchMember;
  busy: boolean;
  onAssignOperatorTag: (userId: string, label: string, currentTag?: string | null) => void;
  onRemoveOperatorTag: (userId: string, label: string) => void;
};

const StaffOperatorCard = React.memo(function StaffOperatorCard({ member, busy, onAssignOperatorTag, onRemoveOperatorTag }: StaffOperatorCardProps) {
  const memberLabel = member.user?.name || member.user?.email || member.userId;
  const operatorTagId = member.user?.operatorTagId ?? null;

  return (
    <Card>
      <ListRow
        title={memberLabel}
        subtitle={member.user?.email || member.role}
        right={<Badge label={operatorTagId ? "Linked" : "Unassigned"} tone={operatorTagId ? "success" : "warning"} />}
      />
      <View style={{ height: 10 }} />
      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.md,
          padding: 12,
          gap: 10,
        }}
      >
        <Text style={{ color: theme.colors.textMuted, fontWeight: "800" }}>Staff RFID card</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.text, fontWeight: operatorTagId ? "800" : "600" }]} numberOfLines={2}>
          {operatorTagId || "No card assigned"}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <AppButton
            title={operatorTagId ? "Change card" : "Assign card"}
            onPress={() => onAssignOperatorTag(member.userId, memberLabel, operatorTagId)}
            variant={operatorTagId ? "secondary" : "primary"}
            disabled={busy}
            iconName="radio-outline"
          />
          {operatorTagId ? (
            <AppButton
              title="Delete card"
              onPress={() => onRemoveOperatorTag(member.userId, memberLabel)}
              variant="secondary"
              disabled={busy}
              iconName="close-circle-outline"
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
});

type StaffRfidCaptureModalProps = {
  visible: boolean;
  title: string;
  targetLabel?: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
};

function StaffRfidCaptureModal({ visible, title, targetLabel, busy, error, onClose }: StaffRfidCaptureModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(15, 23, 42, 0.56)",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 430,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            padding: 18,
            gap: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{title}</Text>
              {targetLabel ? (
                <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                  {targetLabel}
                </Text>
              ) : null}
            </View>
            <AppButton title="Close" onPress={onClose} variant="secondary" disabled={busy} />
          </View>

          <View
            style={{
              minHeight: 260,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              alignItems: "center",
              justifyContent: "center",
              padding: 22,
              gap: 14,
            }}
          >
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: theme.colors.primarySoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="radio-outline" size={44} color={theme.colors.text} />
            </View>
            <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: "center" }]}>Waiting for staff RFID card</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted, textAlign: "center", maxWidth: 290 }]}>
              Scan the staff card on the RFID reader. The portal will link the next RFID staff-card event automatically.
            </Text>
            <ActivityIndicator color={theme.colors.primaryPressed} accessible accessibilityRole="progressbar" accessibilityLabel="Waiting for RFID card scan" />
            {error ? <Text style={[theme.typography.body, { color: theme.colors.danger, textAlign: "center" }]}>{error}</Text> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

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
  onAssignOperatorTag: (userId: string, label: string, currentTag?: string | null) => void;
  onRemoveOperatorTag: (userId: string, label: string) => void;
  onDelete: (userId: string, email: string) => void;
};

const AllUserCard = React.memo(function AllUserCard({
  user,
  busy,
  activeTenantId,
  onAssignToActive,
  onAssignOperatorTag,
  onRemoveOperatorTag,
  onDelete,
}: AllUserCardProps) {
  const isInActiveBranch = Boolean(activeTenantId && user.tenantIds?.some((id) => String(id) === String(activeTenantId)));
  const userLabel = user.name || user.email;
  const operatorTagId = user.operatorTagId ?? null;

  return (
    <Card key={user.id} style={(user.tenantCount ?? 0) === 0 ? { borderColor: theme.colors.warning } : undefined}>
      <ListRow
        title={userLabel}
        subtitle={user.email}
        right={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <Badge label={user.role === "admin" ? "super_admin" : user.role} tone={user.role === "admin" ? "warning" : user.role === "manager" ? "primary" : "default"} />
            <Badge
              label={(user.tenantCount ?? 0) === 0 ? "Unassigned" : `Branches: ${user.tenantCount}`}
              tone={(user.tenantCount ?? 0) === 0 ? "warning" : "default"}
            />
            <Badge label={user.operatorTagId ? "Staff card linked" : "No staff card"} tone={user.operatorTagId ? "success" : "default"} />
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
      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.md,
          padding: 12,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "800" }}>Staff RFID card</Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {operatorTagId || (isInActiveBranch ? "No card assigned" : "Assign user to active branch first")}
            </Text>
          </View>
          <Badge label={operatorTagId ? "Linked" : "Unassigned"} tone={operatorTagId ? "success" : "warning"} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <AppButton
            title={operatorTagId ? "Change card" : "Assign card"}
            onPress={() => onAssignOperatorTag(user.id, userLabel, operatorTagId)}
            variant={operatorTagId ? "secondary" : "primary"}
            disabled={busy || !isInActiveBranch}
            iconName="radio-outline"
          />
          {operatorTagId ? (
            <AppButton
              title="Delete card"
              onPress={() => onRemoveOperatorTag(user.id, userLabel)}
              variant="secondary"
              disabled={busy || !isInActiveBranch}
              iconName="close-circle-outline"
            />
          ) : null}
        </View>
      </View>
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

export function AdminBranchesScreen({ navigation, route }: Props) {
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
  const [members, setMembers] = useState<BranchMember[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserRow[]>([]);
  const [branchTab, setBranchTab] = useState<"list" | "create">("list");
  const [adminTab, setAdminTab] = useState<AdminTab>(route.params?.initialTab === "staffCards" ? "staffCards" : "members");
  const [createUserName, setCreateUserName] = useState("");
  const [createUserEmail, setCreateUserEmail] = useState("");
  const [createUserRole, setCreateUserRole] = useState<UserRole>("inventory_staff");
  const [createUserMakeSuperAdmin, setCreateUserMakeSuperAdmin] = useState(false);
  const [sessions, setSessions] = useState<TenantSessionRow[]>([]);
  const [operatorTagTarget, setOperatorTagTarget] = useState<OperatorTagTarget | null>(null);
  const [operatorTagScanError, setOperatorTagScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");

  const showNotice = useCallback((message: string, tone: "success" | "warning" = "success") => {
    setNoticeTone(tone);
    setNotice(message);
  }, []);

  const list = useMemo(() => (Array.isArray(tenants) ? (tenants as TenantInfo[]) : []), [tenants]);

  useEffect(() => {
    if (route.params?.initialTab === "staffCards") {
      setAdminTab("staffCards");
    }
  }, [route.params?.initialTab]);

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
    if (adminTab !== "members" && adminTab !== "staffCards") return;
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

  const staffCardStats = useMemo(() => {
    let linked = 0;
    for (const member of members) {
      if (member.user?.operatorTagId) linked++;
    }
    return { linked, unassigned: Math.max(0, members.length - linked) };
  }, [members]);

  const createUserInActiveBranch = useCallback(async () => {
    if (!token || !isBranchAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }

    const cleanName = createUserName.trim();
    const cleanEmail = createUserEmail.trim().toLowerCase();
    if (!cleanName || !cleanEmail) {
      setError("Name and email are required");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ ok: true; warning?: string; notification?: { email?: string; delivered?: boolean } }>(
        `/tenants/${activeTenantId}/users`,
        {
          method: "POST",
          token,
          timeoutMs: 30000,
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            role: createUserRole,
            makeSuperAdmin: isSuperAdmin ? createUserMakeSuperAdmin : false,
          }),
        }
      );
      setCreateUserName("");
      setCreateUserEmail("");
      setCreateUserRole("inventory_staff");
      setCreateUserMakeSuperAdmin(false);
      if (res.notification?.delivered) {
        showNotice(`Account created. A temporary password was emailed to ${res.notification.email ?? cleanEmail}.`);
      } else {
        showNotice(
          res.warning ??
            `Account created for ${cleanEmail}, but the temporary password email was not delivered. Check SMTP settings, then use Resend password email.`,
          "warning"
        );
      }
      await loadMembers(activeTenantId);
      if (isSuperAdmin) {
        await loadAllUsers().catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, createUserEmail, createUserMakeSuperAdmin, createUserName, createUserRole, isBranchAdmin, isSuperAdmin, loadAllUsers, loadMembers, showNotice, token]);

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
      setNotice(null);
      try {
        await apiRequest<{ ok: true }>(`/admin/users/${userId}/role`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ role }),
        });
        await loadAllUsers();
        await refreshTenants();
        showNotice("Global role updated.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update global role");
      } finally {
        setBusy(false);
      }
    },
    [busy, confirmAction, isSuperAdmin, loadAllUsers, refreshTenants, showNotice, token]
  );

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
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>(`/admin/users/${userId}`, { method: "DELETE", token });
      await Promise.all([loadMembers(activeTenantId), loadAllUsers()]);
      showNotice(`${email} was deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, isSuperAdmin, loadAllUsers, loadMembers, showNotice, token]);

  const resendTemporaryPassword = useCallback(async (userId: string, emailAddress: string) => {
    if (!token || !activeTenantId || !isBranchAdmin || busy) return;

    const ok = await confirmAction(
      "Resend password email",
      `Send a new temporary password to ${emailAddress}? Their active sessions will be signed out.`
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ ok: true; notification?: { email?: string; delivered?: boolean } }>(
        `/tenants/${activeTenantId}/users/${userId}/resend-temporary-password`,
        { method: "POST", token, timeoutMs: 30000 }
      );
      showNotice(`Temporary password email sent to ${res.notification?.email ?? emailAddress}.`);
      await Promise.all([
        loadMembers(activeTenantId),
        isSuperAdmin ? loadAllUsers() : Promise.resolve(),
        loadSessions(activeTenantId),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resend password email");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, confirmAction, isBranchAdmin, isSuperAdmin, loadAllUsers, loadMembers, loadSessions, showNotice, token]);

  const openOperatorTagScanner = useCallback((userId: string, label: string, currentTag?: string | null) => {
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }
    setError(null);
    setOperatorTagScanError(null);
    setOperatorTagTarget({ userId, label, currentTag, startedAt: new Date().toISOString() });
  }, [activeTenantId]);

  const assignOperatorTagFromScan = useCallback(async (value: string) => {
    if (!token || !activeTenantId || !operatorTagTarget || busy) return;
    const operatorTagId = value.trim();
    if (!operatorTagId) {
      setOperatorTagScanError("Scan a staff RFID card first.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setOperatorTagScanError(null);
    setOperatorTagTarget(null);
    try {
      await apiRequest<{ ok: true; user?: { operatorTagId?: string | null } }>(
        `/tenants/${activeTenantId}/users/${operatorTagTarget.userId}/operator-tag`,
        {
          method: "PATCH",
          token,
          body: JSON.stringify({ operatorTagId }),
        }
      );
      await Promise.all([loadMembers(activeTenantId), isSuperAdmin ? loadAllUsers() : Promise.resolve()]);
      showNotice(`${operatorTagTarget.label} staff RFID card linked.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign staff RFID card");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, isSuperAdmin, loadAllUsers, loadMembers, operatorTagTarget, showNotice, token]);

  useEffect(() => {
    if (!operatorTagTarget || !token || !activeTenantId) return;

    let cancelled = false;
    let inFlight = false;
    const since = operatorTagTarget.startedAt;

    const pollLatestStaffCardEvent = async () => {
      if (cancelled || inFlight || busy) return;
      inFlight = true;
      try {
        const res = await apiRequest<StaffCardLatestResponse>(
          `/rfid/staff-card-events/latest?since=${encodeURIComponent(since)}`,
          { method: "GET", token, timeoutMs: 8000 }
        );
        if (!cancelled && res.event?.tagId) {
          cancelled = true;
          await assignOperatorTagFromScan(res.event.tagId);
        }
      } catch (e) {
        if (!cancelled) {
          setOperatorTagScanError(e instanceof Error ? e.message : "Failed to read RFID staff-card scan");
        }
      } finally {
        inFlight = false;
      }
    };

    void pollLatestStaffCardEvent();
    const pollId = setInterval(() => {
      void pollLatestStaffCardEvent();
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, [activeTenantId, assignOperatorTagFromScan, busy, operatorTagTarget, token]);

  const removeOperatorTag = useCallback(async (userId: string, label: string) => {
    if (!token || !activeTenantId || busy) return;
    const ok = await confirmAction("Delete staff RFID card", `Delete the staff RFID card from ${label}?`);
    if (!ok) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/users/${userId}/operator-tag`, {
        method: "DELETE",
        token,
      });
      await Promise.all([loadMembers(activeTenantId), isSuperAdmin ? loadAllUsers() : Promise.resolve()]);
      showNotice(`${label} staff RFID card deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete staff RFID card");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, confirmAction, isSuperAdmin, loadAllUsers, loadMembers, showNotice, token]);

  const assignUserToActiveBranch = useCallback(async (userId: string) => {
    if (!token || !isSuperAdmin) return;
    if (!activeTenantId) {
      setError("Select a branch first");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members`, {
        method: "POST",
        token,
        body: JSON.stringify({ userId, role: memberRole }),
      });
      await Promise.all([loadMembers(activeTenantId), loadAllUsers()]);
      showNotice("User assigned to the active branch.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign user");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, isSuperAdmin, loadAllUsers, loadMembers, memberRole, showNotice, token]);

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
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members`, {
        method: "POST",
        token,
        body: JSON.stringify({ userId, role }),
      });
      await loadMembers(activeTenantId);
      showNotice("Branch role updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, busy, confirmAction, isBranchAdmin, loadMembers, showNotice, token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      setError(null);
      refreshTenants().catch(() => undefined);
      if (isBranchAdmin) {
        if (adminTab === "members" || adminTab === "staffCards") {
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
    goBackOrNavigate(navigation, "PeopleData");
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
    setNotice(null);
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
      showNotice("Branch created and set as active.");
      setBranchTab("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create branch");
    } finally {
      setBusy(false);
    }
  }

  const selectAdminTab = useCallback(
    async (tab: AdminTab) => {
      setAdminTab(tab);
      if (tab === "sessions") {
        await refreshMe().catch(() => undefined);
      }
      if (tab === "members" || tab === "staffCards") {
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
    setNotice(null);
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
      showNotice(`${cleanEmail} was added to the active branch. This does not send a password email; use Resend password email if they need a new temporary password.`);
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

    const ok = await confirmAction("Remove branch member", "Remove this user from the active branch?");
    if (!ok) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>(`/tenants/${activeTenantId}/members/${userId}`, {
        method: "DELETE",
        token,
      });
      await loadMembers(activeTenantId);
      showNotice("User removed from the active branch.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusy(false);
    }
  }, [activeTenantId, confirmAction, isBranchAdmin, loadMembers, showNotice, token]);

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
        onResendTemporaryPassword={resendTemporaryPassword}
        onAssignOperatorTag={openOperatorTagScanner}
        onRemoveOperatorTag={removeOperatorTag}
        onRemoveMember={removeMember}
      />
    ));
  }, [busy, isSuperAdmin, members, openOperatorTagScanner, removeMember, removeOperatorTag, resendTemporaryPassword, updateGlobalRole, updateMemberRole]);

  const staffOperatorCards = useMemo(() => {
    return members.map((m) => (
      <StaffOperatorCard
        key={`operator-${m.userId}-${m.tenantId}`}
        member={m}
        busy={busy}
        onAssignOperatorTag={openOperatorTagScanner}
        onRemoveOperatorTag={removeOperatorTag}
      />
    ));
  }, [busy, members, openOperatorTagScanner, removeOperatorTag]);

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
        onAssignOperatorTag={openOperatorTagScanner}
        onRemoveOperatorTag={removeOperatorTag}
        onDelete={deleteUser}
      />
    ));
  }, [activeTenantId, allUsers, assignUserToActiveBranch, busy, deleteUser, openOperatorTagScanner, removeOperatorTag]);

  return (
    <Screen
      title="Branches and Users"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
      busy={busy}
    >
      <View style={{ gap: theme.spacing.md }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {notice ? <MutedText style={{ color: noticeTone === "warning" ? theme.colors.warning : theme.colors.success }}>{notice}</MutedText> : null}

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
                    <AppButton
                      title="Staff RFID cards"
                      onPress={() => selectAdminTab("staffCards")}
                      variant={adminTab === "staffCards" ? "primary" : "secondary"}
                    />
                    <AppButton title="Add user" onPress={() => selectAdminTab("add")} variant={adminTab === "add" ? "primary" : "secondary"} />
                    <AppButton title="Active sessions" onPress={() => selectAdminTab("sessions")} variant={adminTab === "sessions" ? "primary" : "secondary"} />
                    {isSuperAdmin ? (
                      <AppButton title="All users" onPress={() => selectAdminTab("users")} variant={adminTab === "users" ? "primary" : "secondary"} />
                    ) : null}
                  </View>

                  {adminTab === "add" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <MutedText>Use this only for accounts that already exist. It adds branch access but does not send a temporary password.</MutedText>
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
                      <AppButton title="Add existing user" onPress={addMember} disabled={busy} loading={busy} variant="secondary" />

                      <View style={{ height: theme.spacing.lg }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Create new user</Text>
                      <MutedText>
                        We will email a temporary password automatically. The user will be required to change it on first sign-in.
                      </MutedText>
                      <View style={{ height: 12 }} />
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
                      <AppButton title="Create user and send email" onPress={createUserInActiveBranch} disabled={busy} loading={busy} variant="secondary" />
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

                  {adminTab === "staffCards" ? (
                    <>
                      <View style={{ height: theme.spacing.md }} />
                      <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Staff RFID cards</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <Badge label={`Linked: ${staffCardStats.linked}`} tone="success" />
                        <Badge label={`Unassigned: ${staffCardStats.unassigned}`} tone={staffCardStats.unassigned ? "warning" : "default"} />
                      </View>
                      <View style={{ height: 12 }} />
                      <MutedText>Scan a staff card here so every hardware scan can be tied to the correct user.</MutedText>
                      <View style={{ height: 12 }} />
                      <View style={{ gap: 10 }}>
                        {members.length ? staffOperatorCards : <MutedText>No members found.</MutedText>}
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
                      <MutedText>Assign users to the active branch before linking their staff RFID card.</MutedText>
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
      <StaffRfidCaptureModal
        visible={Boolean(operatorTagTarget)}
        title={operatorTagTarget?.currentTag ? "Change staff RFID card" : "Assign staff RFID card"}
        targetLabel={operatorTagTarget?.label}
        busy={busy}
        error={operatorTagScanError}
        onClose={() => {
          setOperatorTagScanError(null);
          setOperatorTagTarget(null);
        }}
      />
    </Screen>
  );
}
