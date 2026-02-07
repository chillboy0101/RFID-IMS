import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, TextInput, View, Vibration, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "Putaway">;

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  quantity: number;
  location?: string;
};

type LookupResponse = { ok: true; item: InventoryItem };
type PendingResponse = { ok: true; pending: number };
type AssignResponse = {
  ok: true;
  item: InventoryItem;
  unit: { _id: string; tagId?: string; location?: string; status?: string };
  pending: number;
};

export function PutawayScreen({ navigation }: Props) {
  const { token } = React.useContext(AuthContext);
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

  const [barcode, setBarcode] = useState("");
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [pending, setPending] = useState<number>(0);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);

  const scannerRef = useRef<TextInput>(null);
  const [scanValue, setScanValue] = useState("");
  const [tagId, setTagId] = useState("");

  const [binLocation, setBinLocation] = useState("BIN_A1");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");

  const autoLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLookupBarcodeRef = useRef<string>("");

  const successFeedback = useCallback(() => {
    try {
      if (Platform.OS !== "web") {
        Vibration.vibrate(35);
      } else if (typeof window !== "undefined") {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 740;
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        setTimeout(() => {
          try {
            o.stop();
            ctx.close?.();
          } catch {
            // ignore
          }
        }, 80);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshPending = useCallback(
    async (itemId: string) => {
      if (!token) return;
      try {
        const res = await apiRequest<PendingResponse>(`/inventory/putaway/pending?itemId=${encodeURIComponent(itemId)}`, { method: "GET", token });
        setPending(res.pending);
      } catch {
        // ignore
      }
    },
    [token]
  );

  const lookupByBarcode = useCallback(
    async (nextBarcode: string) => {
      const b = nextBarcode.trim();
      setBarcode(b);
      setItem(null);
      setPending(0);
      setLookupError(null);
      setAssignError(null);
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
        void refreshPending(res.item._id);
      } catch (e) {
        setLookupError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setLookupLoading(false);
      }
    },
    [refreshPending, token]
  );

  useEffect(() => {
    if (autoLookupTimeoutRef.current) clearTimeout(autoLookupTimeoutRef.current);
    const b = barcode.trim();
    if (!b) {
      lastLookupBarcodeRef.current = "";
      setItem(null);
      setPending(0);
      setLookupError(null);
      return;
    }
    if (b === lastLookupBarcodeRef.current) return;

    autoLookupTimeoutRef.current = setTimeout(() => {
      lastLookupBarcodeRef.current = b;
      void lookupByBarcode(b);
    }, 250);

    return () => {
      if (autoLookupTimeoutRef.current) clearTimeout(autoLookupTimeoutRef.current);
    };
  }, [barcode, lookupByBarcode]);

  const canAssign = useMemo(() => {
    return !!token && !!item?._id && pending > 0 && !!tagId.trim() && !assignLoading;
  }, [assignLoading, item?._id, pending, tagId, token]);

  const assignTag = useCallback(async () => {
    setAssignError(null);
    setLastResult("");

    if (!token) {
      setAssignError("You must be signed in.");
      return;
    }
    if (!item?._id) {
      setAssignError("Lookup an item by barcode first.");
      return;
    }
    if (!tagId.trim()) {
      setAssignError("Scan an RFID tag first.");
      return;
    }
    if (assignLoading) return;

    setAssignLoading(true);
    try {
      const res = await apiRequest<AssignResponse>("/inventory/putaway/assign-tag", {
        method: "POST",
        token,
        body: JSON.stringify({
          itemId: item._id,
          tagId: tagId.trim(),
          location: binLocation.trim() || "BIN_A1",
        }),
      });

      setItem(res.item);
      setPending(res.pending);
      setLastResult(`Assigned tag. Pending: ${res.pending}`);
      successFeedback();

      setScanValue("");
      setTagId("");
      setTimeout(() => scannerRef.current?.focus(), 50);
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Putaway failed");
    } finally {
      setAssignLoading(false);
    }
  }, [assignLoading, binLocation, item?._id, successFeedback, tagId, token]);

  return (
    <Screen
      title="Putaway"
      scroll
      right={
        !isDesktopWeb ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
            <AppButton title="Scan" onPress={() => setBarcodeScanOpen(true)} variant="secondary" />
          </View>
        ) : null
      }
    >
      {lookupError ? <ErrorText>{lookupError}</ErrorText> : null}
      {assignError ? <ErrorText>{assignError}</ErrorText> : null}

      {lastResult ? (
        <View style={{ marginBottom: 10 }}>
          <Badge label="Success" tone="success" />
          <MutedText style={{ marginTop: 6 }}>{lastResult}</MutedText>
        </View>
      ) : null}

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>1) Lookup item by barcode</Text>
        <MutedText>Auto-lookup is enabled.</MutedText>
        <View style={{ height: 10 }} />

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
            <MutedText>Pending untagged units: {String(pending)}</MutedText>
          </View>
        ) : (
          <MutedText style={{ marginTop: 10 }}>Scan a barcode to start putaway tag assignment.</MutedText>
        )}
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>2) Scan RFID tag (EPC)</Text>
        <MutedText>Scan the tag to assign to the next pending unit.</MutedText>
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
        ) : null}
      </Card>

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>3) Assign to bin</Text>
        <TextField label="Bin location" value={binLocation} onChangeText={setBinLocation} placeholder="BIN_A1" autoCapitalize="none" />
        <View style={{ height: 12 }} />
        <AppButton title={assignLoading ? "Assigning…" : "Assign tag"} onPress={() => void assignTag()} disabled={!canAssign} loading={assignLoading} />
        {item && pending === 0 ? <MutedText style={{ marginTop: 10 }}>No pending untagged units for this item.</MutedText> : null}
      </Card>

      <BarcodeScanModal
        visible={barcodeScanOpen}
        title="Scan barcode"
        onClose={() => setBarcodeScanOpen(false)}
        onScanned={(value) => {
          setBarcodeScanOpen(false);
          setBarcode(value);
        }}
      />
    </Screen>
  );
}
