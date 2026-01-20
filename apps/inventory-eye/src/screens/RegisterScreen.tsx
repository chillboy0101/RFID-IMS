import React, { useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { signUp } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const Form: any = Platform.OS === "web" ? "form" : View;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => name.trim().length > 0 && email.trim().length > 0 && password.length >= 6,
    [name, email, password]
  );

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await signUp(name.trim(), email.trim(), password, inviteCode.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setLoading(false);
    }
  }

  return (
    <Screen scroll center tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>Inventory Eye</Text>
        <View style={{ height: 18 }} />

        <Form
          style={{ width: "100%", maxWidth: isDesktopWeb ? 520 : 520 }}
          onSubmit={(e: any) => {
            e?.preventDefault?.();
            onSubmit();
          }}
        >
          <Card>
            <TextField label="Name" value={name} onChangeText={setName} placeholder="Full name" />

            <View style={{ height: 12 }} />

            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
            />

            <View style={{ height: 12 }} />

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
            />

            <View style={{ height: 12 }} />

            <TextField
              label="Invite code (optional)"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              placeholder="Paste invite code"
            />

            <View style={{ height: 12 }} />

            {error ? <ErrorText>{error}</ErrorText> : null}

            <View style={{ height: 12 }} />

            <AppButton
              title="Create account"
              onPress={onSubmit}
              disabled={!canSubmit || loading}
              loading={loading}
            />

            <View style={{ height: 10 }} />

            <AppButton title="Back to login" onPress={() => navigation.navigate("Login")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
