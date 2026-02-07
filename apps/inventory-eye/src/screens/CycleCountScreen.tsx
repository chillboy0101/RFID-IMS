import React, { useCallback } from "react";
import React2, { useCallback as useCallback2, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, TextInput, View, Vibration, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "CycleCount">;

export function CycleCountScreen({ navigation }: Props) {
  const { token } = React2.useContext(AuthContext);
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

  type InventoryItem = {
    _id: string;
    name: string;
    sku: string;
    barcode?: string;
    quantity: number;
    location?: string;
  };

  type LookupResponse = { ok: true; item: InventoryItem };

  const [barcode, setBarcode] = useState("");
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [countedQty, setCountedQty] = useState("");
  const [reason, setReason] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");

  const [countNext, setCountNext] = useState(true);

  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const scannerRef = useRef<TextInput>(null);

  const autoLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLookupBarcodeRef = useRef<string>("");

  const successFeedback = useCallback2(() => {
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
        o.frequency.value = 820;
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        setTimeout(() => {
          try {
            o.stop();
            ctx.close?.();
          } catch {
          }
        }, 80);
      }
    } catch {
    }
  }, []);

  const delta = useMemo(() => {
    if (!item) return null;
    const n = Number(countedQty);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n) || n < 0) return null;
    return n - item.quantity;
  }, [countedQty, item]);

  const canSubmit = useMemo(() => {
    return Boolean(token && item && typeof delta === "number" && Number.isFinite(delta));
  }, [delta, item, token]);

  const doLookup = useCallback2(
    async (value: string) => {
      if (!token) return;
      const q = value.trim();
      if (!q) return;
      if (q.length > 120) {
        setLookupError("Barcode is too long");
        return;
      }

      setLookupLoading(true);
      setLookupError(null);
      setSubmitError(null);
      try {
        const res = await apiRequest<LookupResponse>(`/inventory/lookup?barcode=${encodeURIComponent(q)}`, { method: "GET", token });
        setItem(res.item);
        setCountedQty("");
        setLastResult("");
      } catch (e) {
        setItem(null);
        setLookupError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setLookupLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    const raw = barcode.trim();
    if (!raw) {
      setLookupError(null);
      setItem(null);
      return;
    }
    if (raw === lastLookupBarcodeRef.current) return;

    if (autoLookupTimeoutRef.current) clearTimeout(autoLookupTimeoutRef.current);
    autoLookupTimeoutRef.current = setTimeout(() => {
      lastLookupBarcodeRef.current = raw;
      doLookup(raw).catch(() => undefined);
    }, 350);

    return () => {
      if (autoLookupTimeoutRef.current) clearTimeout(autoLookupTimeoutRef.current);
    };
  }, [barcode, doLookup]);

  const clearForNext = useCallback2(() => {
    setBarcode("");
    setItem(null);
    setCountedQty("");
    setReason("");
    setLookupError(null);
    setSubmitError(null);
    setLastResult("");
    lastLookupBarcodeRef.current = "";
    try {
      setTimeout(() => scannerRef.current?.focus(), 50);
    } catch {
    }
  }, []);

  const onSubmit = useCallback2(async () => {
    if (!token || !item || submitLoading) return;
    const n = Number(countedQty);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      setSubmitError("Counted quantity must be a whole number (0 or more)");
      return;
    }
    const d = n - item.quantity;
    if (!Number.isFinite(d)) {
      setSubmitError("Invalid delta");
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    try {
      await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${item._id}/adjust`, {
        method: "POST",
        token,
        body: JSON.stringify({
          delta: d,
          reason: reason.trim() ? `Cycle count: ${reason.trim()}` : "Cycle count",
        }),
      });
      successFeedback();
      setLastResult(`Saved. Delta: ${d >= 0 ? "+" : ""}${d}`);
      if (countNext) {
        clearForNext();
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitLoading(false);
    }
  }, [clearForNext, countedQty, countNext, item, reason, submitLoading, successFeedback, token]);

  return (
    <Screen
      title="Cycle Count"
      scroll
      right={
        !isDesktopWeb ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton title="Scan" onPress={() => setBarcodeScanOpen(true)} variant="secondary" iconName="barcode-outline" iconOnly />
            <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
          </View>
        ) : null
      }
    >
      <BarcodeScanModal
        visible={barcodeScanOpen}
        title="Scan item barcode"
        onClose={() => setBarcodeScanOpen(false)}
        onScanned={(value) => {
          setBarcodeScanOpen(false);
          setBarcode(value);
        }}
      />

      {lookupError ? <ErrorText>{lookupError}</ErrorText> : null}
      {submitError ? <ErrorText>{submitError}</ErrorText> : null}
      {lastResult ? <MutedText>{lastResult}</MutedText> : null}

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Find item</Text>
        <TextField
          ref={scannerRef}
          label="Barcode"
          value={barcode}
          onChangeText={setBarcode}
          placeholder="Type or scan barcode"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <MutedText style={{ marginTop: 8 }}>Auto-lookup runs as you type/scan.</MutedText>
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={2}>
              {item?.name ?? "-"}
            </Text>
            <MutedText style={{ marginTop: 6 }}>SKU: {item?.sku ?? "-"}</MutedText>
            <MutedText style={{ marginTop: 6 }}>Location: {item?.location ?? "-"}</MutedText>
          </View>
          <Badge label={lookupLoading ? "Loading…" : `System Qty: ${item?.quantity ?? "-"}`} tone={typeof item?.quantity === "number" && item.quantity === 0 ? "warning" : "default"} />
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Count</Text>
        <TextField
          label="Counted quantity"
          value={countedQty}
          onChangeText={setCountedQty}
          placeholder="e.g. 12"
          keyboardType="numeric"
          autoCapitalize="none"
        />

        <View style={{ height: 12 }} />

        <TextField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. damaged, missing, recount" />

        <View style={{ height: 12 }} />

        <MutedText>
          Delta: {typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${delta}` : "-"}
        </MutedText>

        <View style={{ height: 16 }} />

        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <AppButton
            title={countNext ? "Count & Next: ON" : "Count & Next: OFF"}
            onPress={() => setCountNext((v) => !v)}
            variant="secondary"
          />
          <AppButton title="Clear" onPress={clearForNext} variant="secondary" />
          <AppButton title="Save count" onPress={onSubmit} loading={submitLoading} disabled={!canSubmit || lookupLoading} />
        </View>
      </Card>
    </Screen>
  );
}
