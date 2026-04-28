import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<AuthStackParamList, "RecoverAccount">;

type RecoveryDetails = {
  ok: true;
  email: string;
  otpRequired: boolean;
  otpSentAt?: string | null;
  otpExpiresAt?: string | null;
  loginAt?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export function RecoverAccountScreen({ route, navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const token = (() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      if (urlToken) return urlToken;
    }
    return route.params?.token ?? "";
  })();

  const initialStatus = (() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("status");
    }
    return null;
  })();

  const [email, setEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifying, setVerifying] = useState(true);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    initialStatus === "otp-failed"
      ? "We secured the account, but sending the recovery code failed. Try resending the code below."
      : initialStatus === "otp-sent"
        ? "We secured the account and sent a recovery code to your email."
        : null
  );
  const [details, setDetails] = useState<RecoveryDetails | null>(null);
  const [success, setSuccess] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const Form: any = Platform.OS === "web" ? "form" : View;
  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  useEffect(() => {
    if (!token) {
      if (mountedRef.current) {
        setVerifying(false);
        setError("Recovery token is missing");
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<RecoveryDetails>(`/auth/recover-account/${encodeURIComponent(token)}`, {
          method: "GET",
        });
        if (!cancelled && mountedRef.current) {
          setDetails(res);
          setEmail(res.email);
          setVerifying(false);
        }
      } catch (e) {
        if (!cancelled && mountedRef.current) {
          setError(e instanceof Error ? e.message : "Recovery session is invalid or expired");
          setVerifying(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordsMatch = useMemo(() => password === confirmPassword, [password, confirmPassword]);
  const canSubmit = useMemo(
    () => token.length > 0 && otp.trim().length >= 6 && password.length >= 8 && passwordsMatch,
    [confirmPassword, otp, password, passwordsMatch, token]
  );

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await apiRequest<{ ok: true; message: string }>("/auth/recover-account", {
        method: "POST",
        body: JSON.stringify({ token, otp: otp.trim(), password }),
      });
      if (mountedRef.current) {
        setSuccess(true);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to recover account");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function onResendOtp() {
    if (!token || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; message: string; sent: boolean }>("/auth/recover-account/resend-otp", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      if (mountedRef.current) {
        setNotice(res.message);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to resend recovery code");
      }
    } finally {
      if (mountedRef.current) setResending(false);
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
              <Text style={{ fontSize: 32, marginBottom: 16 }}>🔒</Text>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Preparing account recovery...</Text>
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
                Account Secured
              </Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: 16 }}>
                Your password has been updated and every active session was signed out. You can sign in again now.
              </Text>
            </View>
            <View style={{ height: 12 }} />
            <AppButton title="Back to Sign in" onPress={() => navigation.navigate("Login")} />
          </Card>
        </View>
      </Screen>
    );
  }

  if (error && !details) {
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
                Recovery Link Unavailable
              </Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: 16 }}>
                {error}
              </Text>
            </View>
            <View style={{ height: 12 }} />
            <AppButton title="Back to Sign in" onPress={() => navigation.navigate("Login")} />
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
              Recover Your Account
            </Text>
            {email ? (
              <MutedText style={{ marginBottom: 12 }}>
                We secured <Text style={{ fontWeight: "600" }}>{email}</Text>. Enter the recovery code we just emailed you and choose a new password.
              </MutedText>
            ) : null}

            {details?.loginAt ? (
              <MutedText style={{ marginBottom: 16 }}>
                Reported sign-in: {new Date(details.loginAt).toUTCString()}
              </MutedText>
            ) : (
              <View style={{ height: 4 }} />
            )}

            {notice ? (
              <>
                <MutedText style={{ color: theme.colors.success, marginBottom: 12 }}>{notice}</MutedText>
              </>
            ) : null}

            {error ? (
              <>
                <ErrorText>{error}</ErrorText>
                <View style={{ height: 12 }} />
              </>
            ) : null}

            <TextField
              label="Recovery Code"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="6-digit code"
            />

            <View style={{ height: 12 }} />

            <TextField
              label="New Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="newPassword"
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />

            <View style={{ height: 12 }} />

            <TextField
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="newPassword"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              errorText={confirmPassword.length > 0 && !passwordsMatch ? "Passwords do not match" : undefined}
            />

            <View style={{ height: 16 }} />

            <AppButton title="Secure Account" onPress={onSubmit} disabled={!canSubmit || loading} loading={loading} />

            <View style={{ height: 12 }} />

            <AppButton
              title={resending ? "Sending code..." : "Resend recovery code"}
              onPress={onResendOtp}
              disabled={resending}
              variant="secondary"
            />

            <View style={{ height: 12 }} />

            <AppButton title="Back to Sign in" onPress={() => navigation.navigate("Login")} variant="secondary" />
          </Card>
        </Form>
      </View>
    </Screen>
  );
}
