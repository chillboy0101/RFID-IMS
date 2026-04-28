import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import { apiRequest } from "../api/client";
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
  const [showResend, setShowResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  const canSubmit = useMemo(() => email.trim().length > 0 && password.length > 0, [email, password]);

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    setShowResend(false);
    setResendMessage(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg === "Request timeout") {
        setError("Server not responding. Please try again in a moment.");
      } else if (msg.toLowerCase().includes("network")) {
        setError("Network error. Check your connection and try again.");
      } else if (msg.toLowerCase().includes("verify") || msg.toLowerCase().includes("verification")) {
        setError(msg);
        setShowResend(true);
      } else {
        setError(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function onResendVerification() {
    setResending(true);
    setResendMessage(null);
    try {
      const res = await apiRequest<{ ok: true; message: string }>("/auth/resend-verification", {
        method: "POST",
        timeoutMs: 25000,
        body: JSON.stringify({ email: email.trim() }),
      });
      setResendMessage(
        res.message || "If the account is still unverified, we sent a fresh verification email."
      );
    } catch (e) {
      // Keep the response generic to avoid email enumeration details.
      setResendMessage("If the account is still unverified, we sent a fresh verification email.");
    } finally {
      if (mountedRef.current) setResending(false);
    }
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

            {showResend && !resendMessage && (
              <>
                <View style={{ height: 8 }} />
                <Pressable onPress={onResendVerification} disabled={resending} style={{ alignSelf: "center" }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "600", fontSize: 14 }}>
                    {resending ? "Sending..." : "Resend verification email"}
                  </Text>
                </Pressable>
              </>
            )}

            {resendMessage && (
              <>
                <View style={{ height: 8 }} />
                <MutedText style={{ color: theme.colors.success, textAlign: "center" }}>
                  {resendMessage}
                </MutedText>
              </>
            )}

            <View style={{ height: 12 }} />

            <AppButton
              title="Sign in"
              onPress={onSubmit}
              disabled={!canSubmit || loading}
              loading={loading}
            />

            <View style={{ height: 8 }} />

            <Pressable onPress={() => navigation.navigate("ForgotPassword")} style={{ alignSelf: "center" }}>
              <Text style={{ color: theme.colors.primary, fontWeight: "600", fontSize: 14 }}>
                Forgot Password?
              </Text>
            </Pressable>

            <View style={{ height: 10 }} />

            <AppButton title="Create an account" onPress={() => navigation.navigate("Register")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
