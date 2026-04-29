import React, { useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, Card, ErrorText, LivePulse, MutedText, Screen, theme, useThemeMode } from "../ui";

function formatRole(userRole?: string | null, effectiveRole?: string | null) {
  if (userRole === "admin") return "Super admin";
  if (effectiveRole === "manager") return "Manager";
  if (effectiveRole === "admin") return "Admin";
  return "Inventory staff";
}

function formatMode(mode: "system" | "light" | "dark") {
  if (mode === "system") return "System";
  if (mode === "light") return "Light";
  return "Dark";
}

function formatTimestamp(value: number | null) {
  if (!value) return "Waiting for check";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
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
        backgroundColor: theme.colors.surface,
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
  const { user, signOut, effectiveRole, apiOnline, apiLastCheckedAt, apiLastError, activeTenantId, tenants } = useContext(AuthContext);
  const navigation = useNavigation();
  const { mode, setMode, resolved } = useThemeMode();

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [pinging, setPinging] = useState(false);
  const [themeLoading, setThemeLoading] = useState<null | "system" | "light" | "dark">(null);
  const [signingOut, setSigningOut] = useState(false);
  const [pingResult, setPingResult] = useState<string>("");
  const [pingError, setPingError] = useState<string | null>(null);

  const roleLabel = formatRole(user?.role, effectiveRole);
  const activeBranchName = useMemo(() => {
    return tenants.find((tenant) => tenant.id === activeTenantId)?.name ?? "No branch selected";
  }, [activeTenantId, tenants]);

  const onlineTone = apiOnline === false ? "danger" : apiOnline === true ? "success" : "default";
  const onlineLabel = apiOnline === false ? "Offline" : apiOnline === true ? "Online" : "Checking";

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

  const pingApi = useCallback(async () => {
    if (pinging) return;
    setPinging(true);
    setPingError(null);
    setPingResult("");
    try {
      const res = await apiRequest<{ ok: true; dbConnected: boolean }>("/health", { method: "GET" });
      setPingResult(`API reachable · database ${res.dbConnected ? "connected" : "unavailable"}`);
    } catch (e) {
      setPingError(e instanceof Error ? e.message : "Network request failed");
    } finally {
      setPinging(false);
    }
  }, [pinging]);

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

  const accountCard = (
    <Card>
      <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 16, justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Text style={[theme.typography.title, { color: theme.colors.text, fontSize: 24 }]}>
              {user?.name ?? "Account"}
            </Text>
            <Badge label={roleLabel} tone={user?.role === "admin" ? "warning" : effectiveRole === "manager" ? "primary" : "default"} />
          </View>
          <MutedText style={{ marginTop: 8 }}>{user?.email ?? "-"}</MutedText>
        </View>

        <View style={{ width: isDesktopWeb ? 280 : "100%", gap: 10 }}>
          <SettingsStat
            icon="business-outline"
            label="Active branch"
            value={activeBranchName}
          />
          <SettingsStat
            icon="cloud-done-outline"
            label="Sync status"
            value={onlineLabel}
            accent={onlineTone}
            pulse={apiOnline === true}
          />
        </View>
      </View>
    </Card>
  );

  const appearanceCard = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Appearance</Text>
          <MutedText style={{ marginTop: 6 }}>Keep the interface consistent across warehouse devices and desktop stations.</MutedText>
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

  const systemCard = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>System</Text>
          <MutedText style={{ marginTop: 6 }}>Connection, compatibility, and service checks.</MutedText>
        </View>
        {apiOnline === true ? <LivePulse /> : null}
      </View>

      <View style={{ marginTop: 16, gap: 10 }}>
        <SettingsStat
          icon="server-outline"
          label="API"
          value={apiOnline === false ? "Offline" : apiOnline === true ? "Reachable" : "Checking"}
          accent={onlineTone}
        />
        <SettingsStat
          icon="time-outline"
          label="Last check"
          value={formatTimestamp(apiLastCheckedAt)}
        />
        <SettingsStat
          icon={Platform.OS === "web" ? "laptop-outline" : "phone-portrait-outline"}
          label="Device"
          value={Platform.OS === "web" ? "Web / Desktop" : "Mobile"}
        />
      </View>

      {apiLastError ? <ErrorText style={{ marginTop: 14 }}>{apiLastError}</ErrorText> : null}
      {pingError ? <ErrorText style={{ marginTop: 8 }}>{pingError}</ErrorText> : null}
      {pingResult ? <MutedText style={{ marginTop: 10 }}>{pingResult}</MutedText> : null}

      <View style={{ marginTop: 16 }}>
        <AppButton title="Run connection check" onPress={pingApi} loading={pinging} disabled={pinging} />
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
            {systemCard}
          </View>
          <View style={{ flex: 1, minWidth: 320, gap: theme.spacing.md }}>
            {appearanceCard}
            {sessionCard}
          </View>
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {accountCard}
          {appearanceCard}
          {systemCard}
          {sessionCard}
        </View>
      )}
    </Screen>
  );
}
