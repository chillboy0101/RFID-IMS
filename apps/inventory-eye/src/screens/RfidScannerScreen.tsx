import React, { useCallback, useContext, useRef, useState } from "react";
import { Platform, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "RfidScanner">;

export function RfidScannerScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") {
      navigation.popToTop();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const scannerRef = useRef<TextInput>(null);
  const [scanValue, setScanValue] = useState("");
  const [lastScan, setLastScan] = useState<string>("");
  const [location, setLocation] = useState<string>("");

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string>("");

  async function sendToSystem() {
    if (!token) {
      setSendError("You must be signed in to send RFID events.");
      return;
    }
    if (sending) return;
    if (!lastScan.trim()) {
      setSendError("Scan a tag first.");
      return;
    }

    setSending(true);
    setSendError(null);
    setSendResult("");

    try {
      const res = await apiRequest<any>("/rfid/events", {
        method: "POST",
        token,
        body: JSON.stringify({
          tagId: lastScan.trim(),
          eventType: "scan",
          location: location.trim() ? location.trim() : undefined,
          source: "scanner-test",
        }),
      });

      setSendResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send RFID event");
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen
      title="RFID Scanner"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      {sendError ? <ErrorText>{sendError}</ErrorText> : null}

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Scanner test</Text>
        <MutedText>Use this to verify the RFID reader is working (keyboard-wedge / Bluetooth HID).</MutedText>

        <View style={{ height: 12 }} />
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextField
              ref={scannerRef}
              label="Scan here"
              value={scanValue}
              onChangeText={setScanValue}
              placeholder="Tap then scan a tag"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => {
                const trimmed = scanValue.trim();
                setScanValue(trimmed);
                setLastScan(trimmed);
              }}
            />
          </View>
          <AppButton title="Ready to scan" onPress={() => scannerRef.current?.focus()} variant="secondary" />
        </View>

        {lastScan ? (
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Badge label="Captured" tone="success" />
            <MutedText>Value: {lastScan}</MutedText>
          </View>
        ) : (
          <MutedText style={{ marginTop: 10 }}>No scan captured yet.</MutedText>
        )}

        <View style={{ height: 12 }} />
        <MutedText>
          Next steps after a successful scan:
          {"\n"}- Search inventory by RFID (Inventory page)
          {"\n"}- Assign an RFID tag to an item (Edit item)
          {"\n"}- Pick items faster in Orders using RFID search
        </MutedText>
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Integration test</Text>
        <MutedText>Send the last scanned tag to the system to verify backend ingestion.</MutedText>

        <View style={{ height: 12 }} />
        <TextField label="Location (optional)" value={location} onChangeText={setLocation} placeholder="e.g. Aisle 3" autoCapitalize="none" />

        <View style={{ height: 12 }} />
        <AppButton title="Send to system" onPress={sendToSystem} disabled={sending} loading={sending} />

        {sendResult ? (
          <View style={{ marginTop: 12 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 8 }]}>Result</Text>
            <Text
              selectable
              style={{
                color: theme.colors.textMuted,
                fontFamily: "monospace" as any,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {sendResult}
            </Text>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
