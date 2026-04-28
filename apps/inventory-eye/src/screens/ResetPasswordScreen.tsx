import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";
import { apiRequest } from "../api/client";

type Props = NativeStackScreenProps<AuthStackParamList, "ResetPassword">;

export function ResetPasswordScreen({ route, navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  // Get token directly from URL on web (synchronous), fallback to route params
  const token = (() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      if (urlToken) return urlToken;
    }
    return route.params?.token ?? "";
  })();

  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const Form: any = Platform.OS === "web" ? "form" : View;

  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  // Verify token on mount
  useEffect(() => {
    if (!token) {
      if (mountedRef.current) {
        setVerifying(false);
        setError("No reset token provided");
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<{ ok: true; valid: boolean; email: string }>(`/auth/reset-password/${encodeURIComponent(token)}`, {
          method: "GET",
        });
        if (!cancelled && mountedRef.current) {
          setEmail(res.email);
          setVerifying(false);
        }
      } catch (e) {
        if (!cancelled && mountedRef.current) {
          setVerifying(false);
          setError(e instanceof Error ? e.message : "Invalid or expired reset token");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordsMatch = useMemo(() => password === confirmPassword, [password, confirmPassword]);
  const canSubmit = useMemo(
    () => token.length > 0 && password.length >= 8 && passwordsMatch,
    [token, password, passwordsMatch]
  );

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await apiRequest<{ ok: true; message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      if (mountedRef.current) {
        setSuccess(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reset password";
      if (mountedRef.current) {
        setError(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  if (verifying) {
    return (
      <Screen scroll center tabBarPadding={false} sidebarInset={false}>
        <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
          <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
          <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
          <View style={{ height: 18 }} />

          <Card style={{ width: "100%", maxWidth: isDesktopWeb ? 460 : 520 }}>
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontSize: 32, marginBottom: 16 }}>🔐</Text>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Verifying reset link...</Text>
            </View>
          </Card>
        </View>
      </Screen>
    );
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
              <Text style={{ fontSize: 48, marginBottom: 16 }}>✅</Text>
              <Text style={[theme.typography.h2, { color: theme.colors.text, textAlign: "center", marginBottom: 8 }]}>
                Password Reset Complete
              </Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: 16 }}>
                Your password has been successfully reset. You can now sign in with your new password.
              </Text>
            </View>

            <View style={{ height: 12 }} />

            <AppButton
              title="Sign in"
              onPress={() => navigation.navigate("Login")}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen scroll center tabBarPadding={false} sidebarInset={false}>
        <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
          <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
          <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
          <View style={{ height: 18 }} />

          <Card style={{ width: "100%", maxWidth: isDesktopWeb ? 460 : 520 }}>
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>❌</Text>
              <Text style={[theme.typography.h2, { color: theme.colors.text, textAlign: "center", marginBottom: 8 }]}>
                {error === "No reset token provided" ? "Invalid Reset Link" : "Reset Failed"}
              </Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: 16 }}>
                {error === "No reset token provided"
                  ? "This password reset link is invalid or has expired. Please request a new one."
                  : error}
              </Text>
            </View>

            <View style={{ height: 12 }} />

            <AppButton
              title="Request New Reset Link"
              onPress={() => navigation.navigate("ForgotPassword")}
            />

            <View style={{ height: 12 }} />

            <AppButton title="Back to Sign in" onPress={() => navigation.navigate("Login")} variant="secondary" />
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
            <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 8 }]}>
              Set New Password
            </Text>
            {email && (
              <MutedText style={{ marginBottom: 16 }}>
                Resetting password for <Text style={{ fontWeight: "600" }}>{email}</Text>
              </MutedText>
            )}

            <TextField
              label="New Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 8 characters"
            />

            <View style={{ height: 12 }} />

            <TextField
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Re-enter your password"
              errorText={confirmPassword.length > 0 && !passwordsMatch ? "Passwords do not match" : undefined}
            />

            <View style={{ height: 16 }} />

            <AppButton
              title="Reset Password"
              onPress={onSubmit}
              disabled={!canSubmit || loading}
              loading={loading}
            />

            <View style={{ height: 12 }} />

            <AppButton title="Cancel" onPress={() => navigation.navigate("Login")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
