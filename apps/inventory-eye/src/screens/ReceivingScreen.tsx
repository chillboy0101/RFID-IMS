import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Platform, Text, TextInput, View, useWindowDimensions } from "react-native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  quantity: number;
  location?: string;
  rfidTagId?: string;
};

type LookupResponse = { ok: true; item: InventoryItem };
type ReceiveResponse = { ok: true; item: InventoryItem; units: Array<{ _id: string; tagId?: string; location?: string; status?: string }> };

export function ReceivingScreen() {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [barcode, setBarcode] = useState("");
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [tagId, setTagId] = useState("");
  const [scanValue, setScanValue] = useState("");
  const scannerRef = useRef<TextInput>(null);

  const [location, setLocation] = useState("RECEIVING_STAGING");
  const [quantity, setQuantity] = useState("1");

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");

  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);

  const effectiveQuantity = useMemo(() => {
    if (tagId.trim()) return 1;
    const n = Number(quantity);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }, [quantity, tagId]);

  const canSubmit = useMemo(() => {
    return !!token && !!item?._id && effectiveQuantity >= 1;
  }, [effectiveQuantity, item?._id, token]);

  const lookupByBarcode = useCallback(
    async (nextBarcode: string) => {
      const b = nextBarcode.trim();
      setBarcode(b);
      setItem(null);
      setLookupError(null);
      setLastResult("");
      if (!b) return;
      if (!token) {
        setLookupError("You must be signed in to lookup items.");
        return;
      }

      setLookupLoading(true);
      try {
        const res = await apiRequest<LookupResponse>(`/inventory/lookup?barcode=${encodeURIComponent(b)}`, { method: "GET", token });
        setItem(res.item);
      } catch (e) {
        setLookupError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setLookupLoading(false);
      }
    },
    [token]
  );

  const submitReceiving = useCallback(async () => {
    setSubmitError(null);
    setLastResult("");

    if (!token) {
      setSubmitError("You must be signed in.");
      return;
    }
    if (!item?._id) {
      setSubmitError("Lookup an item by barcode first.");
      return;
    }
    if (submitLoading) return;
    if (effectiveQuantity < 1) {
      setSubmitError("Quantity must be at least 1.");
      return;
    }

    setSubmitLoading(true);
    try {
      const res = await apiRequest<ReceiveResponse>("/inventory/receiving/units", {
        method: "POST",
        token,
        body: JSON.stringify({
          itemId: item._id,
          tagId: tagId.trim() || undefined,
          location: location.trim() || "RECEIVING_STAGING",
          quantity: effectiveQuantity,
        }),
      });

      setItem(res.item);
      setLastResult(`Received ${effectiveQuantity} unit${effectiveQuantity === 1 ? "" : "s"}`);
      setScanValue("");
      setTagId("");
      setQuantity("1");
      setTimeout(() => scannerRef.current?.focus(), 50);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Receiving failed");
    } finally {
      setSubmitLoading(false);
    }
  }, [effectiveQuantity, item?._id, location, submitLoading, tagId, token]);

  return (
    <Screen
      title="Receiving"
      scroll
      right={!isDesktopWeb ? <AppButton title="Scan" onPress={() => setBarcodeScanOpen(true)} variant="secondary" /> : null}
    >
      {lookupError ? <ErrorText>{lookupError}</ErrorText> : null}
      {submitError ? <ErrorText>{submitError}</ErrorText> : null}

      {lastResult ? (
        <View style={{ marginBottom: 10 }}>
          <Badge label="Success" tone="success" />
          <MutedText style={{ marginTop: 6 }}>{lastResult}</MutedText>
        </View>
      ) : null}

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>1) Scan item barcode</Text>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextField
              label="Barcode"
              value={barcode}
              onChangeText={setBarcode}
              placeholder="Tap and scan / type"
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => void lookupByBarcode(barcode)}
            />
          </View>
          <AppButton title={lookupLoading ? "Searching…" : "Lookup"} onPress={() => void lookupByBarcode(barcode)} disabled={lookupLoading} loading={lookupLoading} />
        </View>

        {item ? (
          <View style={{ marginTop: 10, gap: 6 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <Badge label="Item found" tone="success" />
              <MutedText>{item.name}</MutedText>
            </View>
            <MutedText>SKU: {item.sku}</MutedText>
            <MutedText>Current qty: {String(item.quantity ?? 0)}</MutedText>
          </View>
        ) : (
          <MutedText style={{ marginTop: 10 }}>Lookup an existing inventory item by barcode to receive units into it.</MutedText>
        )}
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>2) Scan RFID tag (EPC)</Text>
        <MutedText>Use your handheld RFID reader in keyboard mode (HID) and scan into the field below.</MutedText>
        <View style={{ height: 12 }} />

        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextField
              ref={scannerRef}
              label="RFID tag scan input"
              value={scanValue}
              onChangeText={setScanValue}
              placeholder="Tap then scan tag"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => {
                const trimmed = scanValue.trim();
                setScanValue(trimmed);
                setTagId(trimmed);
              }}
            />
          </View>
          <AppButton title="Ready" onPress={() => scannerRef.current?.focus()} variant="secondary" />
        </View>

        {tagId ? (
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Badge label="Tag captured" tone="success" />
            <MutedText>{tagId}</MutedText>
          </View>
        ) : (
          <MutedText style={{ marginTop: 10 }}>Optional: you can receive without tag (bulk qty), or with tag (1 unit).</MutedText>
        )}
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>3) Confirm</Text>
        <TextField label="Location" value={location} onChangeText={setLocation} placeholder="RECEIVING_STAGING" autoCapitalize="none" />
        <View style={{ height: 12 }} />
        <TextField
          label={tagId.trim() ? "Quantity (fixed to 1 when tag is provided)" : "Quantity"}
          value={tagId.trim() ? "1" : quantity}
          onChangeText={setQuantity}
          editable={!tagId.trim()}
          placeholder="1"
          keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
        />
        <View style={{ height: 12 }} />

        <AppButton title="Receive" onPress={() => void submitReceiving()} disabled={!canSubmit || submitLoading} loading={submitLoading} />
      </Card>

      <BarcodeScanModal
        visible={barcodeScanOpen}
        title="Scan barcode"
        onClose={() => setBarcodeScanOpen(false)}
        onScanned={(value) => {
          setBarcodeScanOpen(false);
          void lookupByBarcode(value);
        }}
      />
    </Screen>
  );
}
