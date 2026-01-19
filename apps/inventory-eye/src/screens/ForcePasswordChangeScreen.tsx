import React, { useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

export function ForcePasswordChangeScreen() {
  const { token, user, refreshMe, signOut } = useContext(AuthContext);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const title = useMemo(() => "Set new password", []);

  async function onSubmit() {
    if (!token || busy) return;
    setError(null);

    if (!oldPassword || newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    try {
      await apiRequest<{ ok: true; user: any }>("/auth/change-password", {
        method: "POST",
        token,
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change password");
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
          <Card>
            <MutedText>
              {user?.email ? `Hi ${user.email}. ` : ""}
              You must set a new password before continuing.
            </MutedText>
            <View style={{ height: 12 }} />

            <TextField label="Temporary password" value={oldPassword} onChangeText={setOldPassword} secureTextEntry placeholder="Temporary password" />
            <View style={{ height: 12 }} />

            <TextField label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="At least 6 characters" />
            <View style={{ height: 12 }} />

            <TextField
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Repeat new password"
            />

            {error ? (
              <>
                <View style={{ height: 12 }} />
                <ErrorText>{error}</ErrorText>
              </>
            ) : null}

            <View style={{ height: 12 }} />
            <AppButton title={busy ? "Saving..." : "Save new password"} onPress={onSubmit} disabled={busy || !token} />

            <View style={{ height: 10 }} />
            <AppButton title="Sign out" onPress={() => signOut()} variant="secondary" disabled={busy} />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
