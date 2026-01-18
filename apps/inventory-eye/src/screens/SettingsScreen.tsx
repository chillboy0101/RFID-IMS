import React, { useCallback, useContext, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, theme, useThemeMode } from "../ui";

export function SettingsScreen() {
  const { user, signOut } = useContext(AuthContext);
  const navigation = useNavigation();
  const { mode, setMode, resolved } = useThemeMode();

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

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

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string>("");
  const [pingError, setPingError] = useState<string | null>(null);

  async function pingApi() {
    if (pinging) return;
    setPinging(true);
    setPingError(null);
    setPingResult("");
    try {
      const res = await apiRequest<{ ok: true; dbConnected: boolean }>("/health", { method: "GET" });
      setPingResult(`ok=${res.ok} dbConnected=${String(res.dbConnected)}`);
    } catch (e) {
      setPingError(e instanceof Error ? e.message : "Network request failed");
    } finally {
      setPinging(false);
    }
  }

  return (
    <Screen
      title="Settings"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Account</Text>
            <MutedText style={{ marginTop: 6 }}>{user?.email ?? "-"}</MutedText>
          </View>
          <Badge
            label={user?.role ?? "-"}
            tone={user?.role === "admin" ? "warning" : user?.role === "manager" ? "primary" : "default"}
          />
        </View>

        <View style={{ height: 12 }} />
        <Text style={{ color: theme.colors.text }}>Name</Text>
        <MutedText style={{ marginTop: 4 }}>{user?.name ?? "-"}</MutedText>

        <View style={{ height: 12 }} />
        <Text style={{ color: theme.colors.text }}>Role-based access</Text>
        <MutedText style={{ marginTop: 4 }}>
          Your role controls access to admin-only features like integrations and managing operational settings.
        </MutedText>
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Device & compatibility</Text>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Ionicons name="phone-portrait-outline" size={18} color={theme.colors.textMuted} />
            <MutedText>Mobile</MutedText>
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Ionicons name="laptop-outline" size={18} color={theme.colors.textMuted} />
            <MutedText>Desktop</MutedText>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Appearance</Text>
        <MutedText>Theme</MutedText>
        <View style={{ height: 10 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <AppButton title="System" onPress={() => setMode("system")} variant={mode === "system" ? "primary" : "secondary"} />
          <AppButton title="Light" onPress={() => setMode("light")} variant={mode === "light" ? "primary" : "secondary"} />
          <AppButton title="Dark" onPress={() => setMode("dark")} variant={mode === "dark" ? "primary" : "secondary"} />
          <View style={{ flexGrow: 1 }} />
          <Badge label={`Active: ${resolved}`} tone={resolved === "dark" ? "primary" : "default"} />
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>API</Text>
        <MutedText>Connection check</MutedText>

        {pingError ? (
          <View style={{ marginTop: 10 }}>
            <ErrorText>{pingError}</ErrorText>
          </View>
        ) : null}
        {pingResult ? (
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Badge label="Ping OK" tone="success" />
            <MutedText>{pingResult}</MutedText>
          </View>
        ) : null}

        <View style={{ marginTop: 12 }}>
          <AppButton title={pinging ? "Pinging..." : "Ping API"} onPress={pingApi} disabled={pinging} loading={pinging} />
        </View>
      </Card>

      <Card>
        <AppButton title="Sign out" onPress={() => signOut()} variant="danger" />
      </Card>
    </Screen>
  );
}
