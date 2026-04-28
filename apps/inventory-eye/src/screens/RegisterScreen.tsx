import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const Form: any = Platform.OS === "web" ? "form" : View;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  const canSubmit = useMemo(
    () => name.trim().length > 0 && email.trim().length > 0 && password.length >= 6,
    [name, email, password]
  );

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiRequest<{ ok: true; message: string; email?: string }>("/auth/register", {
        method: "POST",
        timeoutMs: 25000,
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      setSuccess(res.message || "Account created! Please check your email to verify your account before logging in.");
      // Clear form
      setName("");
      setEmail("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  return (
    <Screen scroll center tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
        <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
        <View style={{ height: 18 }} />

        <Form
          style={{ width: "100%", maxWidth: isDesktopWeb ? 520 : 520 }}
          onSubmit={(e: any) => {
            e?.preventDefault?.();
            onSubmit();
          }}
        >
          <Card>
            {success ? (
              <>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 12, textAlign: "center" }]}>
                  Check your email
                </Text>
                <MutedText style={{ textAlign: "center", marginBottom: 16 }}>
                  {success}
                </MutedText>
                <MutedText style={{ textAlign: "center", marginBottom: 16 }}>
                  Need another link later? You can resend a fresh verification email from sign in.
                </MutedText>
                <View style={{ height: 12 }} />
                <AppButton title="Go to login" onPress={() => navigation.navigate("Login")} variant="primary" />
              </>
            ) : (
              <>
                <TextField
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="name"
                  autoComplete="name"
                  placeholder="Full name"
                />

                <View style={{ height: 12 }} />

                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  placeholder="you@example.com"
                />

                <View style={{ height: 12 }} />

                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
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
              </>
            )}
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
