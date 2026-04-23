import React, { useEffect, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSearchParams } from "../hooks/useSearchParams";

import { apiRequest } from "../api/client";
import type { AuthStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, theme } from "../ui";

type Props = NativeStackScreenProps<AuthStackParamList, "VerifyEmail">;

export function VerifyEmailScreen({ route, navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  // Get token from route params first (React Navigation deep linking),
  // then fall back to URL search params for web
  const routeToken = route.params?.token;
  const searchParams = useSearchParams();
  const urlToken = searchParams?.token as string | undefined;
  const token = routeToken ?? urlToken;

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");

  const logoUri = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Verification token is missing. Please check your email for the correct verification link.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await apiRequest<{ ok: true; message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
          method: "GET",
          timeoutMs: 15000,
        });
        if (!cancelled) {
          setStatus("success");
          setMessage(res.message || "Email verified successfully!");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(e instanceof Error ? e.message : "Verification failed. The link may have expired.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Screen scroll center tabBarPadding={false} sidebarInset={false}>
      <View style={{ width: "100%", maxWidth: 520, alignItems: "center" }}>
        <Image source={{ uri: logoUri }} style={{ width: 180, height: 85, marginBottom: 10 }} resizeMode="contain" />
        <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: "center" }]}>VDL Fulfilment Ops</Text>
        <View style={{ height: 18 }} />

        <View style={{ width: "100%", maxWidth: isDesktopWeb ? 520 : 520 }}>
          <Card>
            {status === "loading" ? (
              <>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 12, textAlign: "center" }]}>
                  Verifying...
                </Text>
                <MutedText style={{ textAlign: "center" }}>
                  Please wait while we verify your email address.
                </MutedText>
              </>
            ) : status === "success" ? (
              <>
                <Text style={[theme.typography.h3, { color: theme.colors.success, marginBottom: 12, textAlign: "center" }]}>
                  Email Verified!
                </Text>
                <MutedText style={{ textAlign: "center", marginBottom: 16 }}>
                  {message}
                </MutedText>
                <View style={{ height: 12 }} />
                <AppButton title="Go to login" onPress={() => navigation.navigate("Login")} variant="primary" />
              </>
            ) : (
              <>
                <Text style={[theme.typography.h3, { color: theme.colors.error, marginBottom: 12, textAlign: "center" }]}>
                  Verification Failed
                </Text>
                <ErrorText style={{ textAlign: "center", marginBottom: 16 }}>
                  {message}
                </ErrorText>
                <View style={{ height: 12 }} />
                <AppButton
                  title="Back to login"
                  onPress={() => navigation.navigate("Login")}
                  variant="secondary"
                />
              </>
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}
