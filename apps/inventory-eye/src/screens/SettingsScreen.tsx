import React, { useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, Card, ErrorText, LivePulse, MutedText, Screen, TextField, theme, useThemeMode } from "../ui";

type ClearInventoryResponse = {
  ok: true;
  tenant: { id: string; name: string; slug: string };
  deleted: Record<string, number>;
};

function formatRole(userRole?: string | null, effectiveRole?: string | null) {
  if (userRole === "admin") return "Super admin";
  if (effectiveRole === "admin") return "Admin";
  if (effectiveRole === "manager") return "Manager";
  return "Inventory staff";
}

function formatDeletedKey(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function SettingSegment({
  label,
  active,
  onPress,
  loading,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={(state) => [
        {
          minHeight: 44,
          minWidth: 92,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface2,
          justifyContent: "center",
          alignItems: "center",
          opacity: loading ? 0.65 : 1,
          ...(Platform.OS === "web" ? ({ cursor: loading ? "default" : "pointer" } as any) : null),
        },
        state.pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.text} />
      ) : (
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function SettingsStat({
  icon,
  label,
  value,
  accent,
  pulse,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent?: "success" | "warning" | "danger" | "default";
  pulse?: boolean;
}) {
  const color =
    accent === "success"
      ? theme.colors.success
      : accent === "warning"
        ? theme.colors.warning
        : accent === "danger"
          ? theme.colors.danger
          : theme.colors.textMuted;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: 12,
        paddingVertical: 11,
      }}
    >
      {pulse ? <LivePulse /> : <Ionicons name={icon} size={18} color={color} />}
      <View style={{ minWidth: 0, flex: 1 }}>
        <MutedText>{label}</MutedText>
        <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 2 }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function SettingsScreen() {
  const { user, token, signOut, effectiveRole, apiOnline, apiLastError, activeTenantId, tenants } = useContext(AuthContext);
  const navigation = useNavigation();
  const { mode, setMode, resolved } = useThemeMode();

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [themeLoading, setThemeLoading] = useState<null | "system" | "light" | "dark">(null);
  const [signingOut, setSigningOut] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState("");
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<Record<string, number> | null>(null);

  const roleLabel = formatRole(user?.role, effectiveRole);
  const isSuperAdmin = user?.role === "admin";
  const canClearInventory = isSuperAdmin && Boolean(token && activeTenantId);
  const activeBranchName = useMemo(() => {
    return tenants.find((tenant) => tenant.id === activeTenantId)?.name ?? "No branch selected";
  }, [activeTenantId, tenants]);

  const onlineTone = apiOnline === false ? "danger" : apiOnline === true ? "success" : "default";
  const onlineLabel = apiOnline === false ? "Offline" : apiOnline === true ? "Connected" : "Syncing";

  const onBack = useCallback(() => {
    if (!isDesktopWeb) {
      (navigation as any).navigate?.("More", { screen: "MoreMenu" });
      return;
    }
    if ((navigation as any)?.canGoBack?.() && (navigation as any).canGoBack()) {
      (navigation as any).goBack();
      return;
    }
    (navigation as any).navigate?.("More", { screen: "MoreMenu" });
  }, [isDesktopWeb, navigation]);

  const changeTheme = useCallback(
    async (nextMode: "system" | "light" | "dark") => {
      if (themeLoading || nextMode === mode) return;
      setThemeLoading(nextMode);
      try {
        await setMode(nextMode);
      } finally {
        setThemeLoading(null);
      }
    },
    [mode, setMode, themeLoading]
  );

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [signOut, signingOut]);

  const closeClearModal = useCallback(() => {
    if (clearLoading) return;
    setClearModalOpen(false);
    setClearConfirm("");
    setClearError(null);
  }, [clearLoading]);

  const handleClearInventoryData = useCallback(async () => {
    if (clearLoading || !token || !activeTenantId) return;
    const confirm = clearConfirm.trim();
    if (confirm !== "CLEAR INVENTORY") {
      setClearError("Type CLEAR INVENTORY to confirm this reset.");
      return;
    }

    setClearLoading(true);
    setClearError(null);
    try {
      const res = await apiRequest<ClearInventoryResponse>("/admin/clear-inventory-data", {
        method: "POST",
        token,
        timeoutMs: 30000,
        headers: { "X-Tenant-ID": activeTenantId },
        body: JSON.stringify({ confirm }),
      });
      setClearResult(res.deleted);
      setClearModalOpen(false);
      setClearConfirm("");
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Unable to clear inventory data.");
    } finally {
      setClearLoading(false);
    }
  }, [activeTenantId, clearConfirm, clearLoading, token]);

  const accountCard = (
    <Card style={{ gap: 16 }}>
      <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 16, justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Text style={[theme.typography.title, { color: theme.colors.text, fontSize: 24 }]} numberOfLines={1}>
              {user?.name ?? "Account"}
            </Text>
            <Badge label={roleLabel} tone={user?.role === "admin" ? "warning" : effectiveRole === "manager" ? "primary" : "default"} />
          </View>
          <MutedText style={{ marginTop: 8 }}>{user?.email ?? "-"}</MutedText>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignSelf: isDesktopWeb ? "flex-start" : "stretch" }}>
          <Badge label={activeBranchName} tone="default" />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
            }}
          >
            {apiOnline === true ? <LivePulse /> : <Ionicons name="cloud-outline" size={16} color={theme.colors.textMuted} />}
            <Text
              style={{
                color:
                  onlineTone === "danger"
                    ? theme.colors.danger
                    : onlineTone === "success"
                      ? theme.colors.success
                      : theme.colors.textMuted,
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              {onlineLabel}
            </Text>
          </View>
        </View>
      </View>
      {apiLastError ? <ErrorText>{apiLastError}</ErrorText> : null}
    </Card>
  );

  const workspaceCard = (
    <Card>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Workspace</Text>
      <View style={{ marginTop: 16, gap: 10 }}>
        <SettingsStat icon="business-outline" label="Active branch" value={activeBranchName} />
        <SettingsStat
          icon={Platform.OS === "web" ? "laptop-outline" : "phone-portrait-outline"}
          label="Device"
          value={Platform.OS === "web" ? "Web / Desktop" : "Mobile"}
        />
        <SettingsStat icon="shield-checkmark-outline" label="Access level" value={roleLabel} accent={user?.role === "admin" ? "warning" : "default"} />
      </View>
    </Card>
  );

  const appearanceCard = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Appearance</Text>
          <MutedText style={{ marginTop: 6 }}>Choose the display mode for this device.</MutedText>
        </View>
        <Badge label={`Active ${resolved}`} tone={resolved === "dark" ? "primary" : "default"} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <SettingSegment label="System" active={mode === "system"} onPress={() => changeTheme("system")} loading={themeLoading === "system"} />
        <SettingSegment label="Light" active={mode === "light"} onPress={() => changeTheme("light")} loading={themeLoading === "light"} />
        <SettingSegment label="Dark" active={mode === "dark"} onPress={() => changeTheme("dark")} loading={themeLoading === "dark"} />
      </View>
    </Card>
  );

  const sessionCard = (
    <Card>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Session</Text>
      <MutedText style={{ marginTop: 6 }}>Sign out from this device when you are done working.</MutedText>

      <View style={{ marginTop: 16 }}>
        <AppButton title="Sign out" onPress={handleSignOut} variant="danger" loading={signingOut} disabled={signingOut} />
      </View>
    </Card>
  );

  const dangerCard = isSuperAdmin ? (
    <Card style={{ gap: 14, borderColor: "rgba(239, 68, 68, 0.28)" }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Clean test data</Text>
          <MutedText style={{ marginTop: 6 }}>
            Clear inventory, orders, RFID scan data, and related operational records for {activeBranchName}. Users, branches,
            staff cards, gate keys, vendors, and audit logs stay untouched.
          </MutedText>
        </View>
        <Badge label="Admin" tone="danger" />
      </View>

      {clearResult ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(clearResult).map(([key, value]) => (
            <Badge key={key} label={`${formatDeletedKey(key)} ${value}`} tone={value > 0 ? "warning" : "default"} />
          ))}
        </View>
      ) : null}

      {clearError ? <ErrorText>{clearError}</ErrorText> : null}

      <AppButton
        title="Clear test inventory"
        onPress={() => {
          setClearError(null);
          setClearModalOpen(true);
        }}
        variant="danger"
        iconName="trash-outline"
        disabled={!canClearInventory || clearLoading}
      />
    </Card>
  ) : null;

  const clearModal = (
    <Modal visible={clearModalOpen} transparent animationType="fade" onRequestClose={closeClearModal}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(15, 23, 42, 0.42)",
          padding: theme.spacing.md,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 520,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            padding: theme.spacing.md,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Clear test inventory?</Text>
              <MutedText style={{ marginTop: 6 }}>
                This removes sample inventory, orders, RFID tags, scan events, exit sessions, and related alerts for{" "}
                {activeBranchName}.
              </MutedText>
            </View>
            <AppButton title="Close" onPress={closeClearModal} variant="secondary" iconName="close" iconOnly disabled={clearLoading} />
          </View>

          <View
            style={{
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: "rgba(239, 68, 68, 0.24)",
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              padding: 12,
            }}
          >
            <Text style={[theme.typography.label, { color: theme.colors.danger }]}>This does not delete users, branches, vendors, audit logs, or gate keys.</Text>
          </View>

          <TextField
            label="Type CLEAR INVENTORY"
            value={clearConfirm}
            onChangeText={setClearConfirm}
            placeholder="CLEAR INVENTORY"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!clearLoading}
            errorText={clearError ?? undefined}
          />

          <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 10 }}>
            <AppButton title="Cancel" onPress={closeClearModal} variant="secondary" disabled={clearLoading} style={{ flex: 1 }} />
            <AppButton
              title="Clear inventory"
              onPress={handleClearInventoryData}
              variant="danger"
              loading={clearLoading}
              disabled={clearLoading || clearConfirm.trim() !== "CLEAR INVENTORY" || !canClearInventory}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <Screen
      title="Settings"
      scroll
      busy={signingOut}
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md }}>
          <View style={{ flex: 1.4, minWidth: 0, gap: theme.spacing.md }}>
            {accountCard}
            {appearanceCard}
          </View>
          <View style={{ flex: 1, minWidth: 320, gap: theme.spacing.md }}>
            {workspaceCard}
            {sessionCard}
            {dangerCard}
          </View>
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {accountCard}
          {workspaceCard}
          {appearanceCard}
          {sessionCard}
          {dangerCard}
        </View>
      )}
      {clearModal}
    </Screen>
  );
}
