import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";
import { apiRequest } from "../api/client";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  const canSubmit = useMemo(() => email.trim().length > 0, [email]);

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      if (mountedRef.current) {
        setSuccess(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send reset email";
      if (mountedRef.current) {
        setError(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  if (success) {
    return (
      <Screen scroll center tabBarPadding={false} sidebarInset={false}>
        <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
          <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
          <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
          <View style={{ height: 18 }} />

          <Card style={{ width: "100%", maxWidth: isDesktopWeb ? 460 : 520 }}>
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>✉️</Text>
              <Text style={[theme.typography.heading, { color: theme.colors.text, textAlign: "center", marginBottom: 8 }]}>
                Check your email
              </Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: "center", lineHeight: 22 }}>
                If an account with <Text style={{ fontWeight: "700" }}>{email}</Text> exists, we've sent a password reset link.
              </Text>
              <View style={{ height: 24 }} />
              <MutedText style={{ textAlign: "center" }}>
                The link will expire in 1 hour. Check your spam folder if you don't see the email.
              </MutedText>
            </View>

            <View style={{ height: 12 }} />

            <AppButton
              title="Back to Sign in"
              onPress={() => navigation.navigate("Login")}
              variant="secondary"
            />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll center tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
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
            <Text style={[theme.typography.heading, { color: theme.colors.text, marginBottom: 8 }]}>
              Forgot Password?
            </Text>
            <MutedText style={{ marginBottom: 16 }}>
              Enter your email and we'll send you a link to reset your password.
            </MutedText>

            {error ? (
              <>
                <ErrorText>{error}</ErrorText>
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

            <View style={{ height: 16 }} />

            <AppButton
              title="Send Reset Link"
              onPress={onSubmit}
              disabled={!canSubmit || loading}
              loading={loading}
            />

            <View style={{ height: 12 }} />

            <AppButton title="Back to Sign in" onPress={() => navigation.navigate("Login")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
