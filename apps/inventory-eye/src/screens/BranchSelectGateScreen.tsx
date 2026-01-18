import React, { useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";

import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

export function BranchSelectGateScreen() {
  const { tenants, activeTenantId, setActiveTenantId, signOut } = useContext(AuthContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const hasTenants = tenants.length > 0;

  const title = useMemo(() => "Select branch", []);

  async function handleSelect(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setActiveTenantId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set branch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll center busy={busy} tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>{title}</Text>
        <View style={{ height: 18 }} />

        <View style={{ width: "100%", maxWidth: isDesktopWeb ? 620 : 520, gap: theme.spacing.md }}>
        {!hasTenants ? (
          <Card>
            <MutedText>No branches are available for this account.</MutedText>
            <View style={{ height: theme.spacing.md }} />
            <AppButton title="Sign out" onPress={() => signOut()} variant="secondary" />
          </Card>
        ) : (
          <>
            <Card>
              <MutedText>Select the VDL branch you are working in to continue.</MutedText>
              <View style={{ height: 12 }} />
              <Badge label={`Branches: ${tenants.length}`} />
              {error ? (
                <>
                  <View style={{ height: 12 }} />
                  <ErrorText>{error}</ErrorText>
                </>
              ) : null}
            </Card>

            <Card>
              <View style={{ gap: 10 }}>
                {tenants.map((t) => (
                  <ListRow
                    key={t.id}
                    title={t.name}
                    subtitle={t.slug}
                    right={t.id === activeTenantId ? <Badge label="Selected" tone="success" /> : undefined}
                    onPress={() => handleSelect(t.id)}
                  />
                ))}
              </View>

              <View style={{ height: theme.spacing.md }} />
              <AppButton title="Sign out" onPress={() => signOut()} variant="secondary" />
            </Card>
          </>
        )}
        </View>
      </View>
    </Screen>
  );
}
