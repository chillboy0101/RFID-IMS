import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { signIn, authLastError } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const Form: any = Platform.OS === "web" ? "form" : View;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim().length > 0 && password.length > 0, [email, password]);

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg === "Request timeout") {
        setError("Server not responding. Please try again in a moment.");
      } else if (msg.toLowerCase().includes("network")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  return (
    <Screen scroll center tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
        <View style={{ height: 18 }} />

        <Form
          style={{ width: "100%", maxWidth: isDesktopWeb ? 460 : 520 }}
          onSubmit={(e: any) => {
            e?.preventDefault?.();
            onSubmit();
          }}
        >
          <Card>
            {authLastError ? (
              <>
                <ErrorText>{authLastError}</ErrorText>
                <View style={{ height: 12 }} />
              </>
            ) : null}
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
            />

            <View style={{ height: 12 }} />

            <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />

            <View style={{ height: 12 }} />

            {error ? <ErrorText>{error}</ErrorText> : null}

            <View style={{ height: 12 }} />

            <AppButton
              title="Sign in"
              onPress={onSubmit}
              disabled={!canSubmit || loading}
              loading={loading}
            />

            <View style={{ height: 10 }} />

            <AppButton title="Create an account" onPress={() => navigation.navigate("Register")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
