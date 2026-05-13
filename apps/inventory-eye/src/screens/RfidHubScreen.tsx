import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, Vibration, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

type Mode = "assign" | "authorize" | "exit" | "tags";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  quantity: number;
  location?: string;
};

type OrderStatus = "created" | "picking" | "authorized" | "fulfilled" | "cancelled";

type OrderLine = {
  itemId: string;
  quantity: number;
  skuSnapshot?: string;
  nameSnapshot?: string;
};

type OrderWorkflowLine = {
  itemId: string;
  name: string;
  sku: string;
  requestedQuantity: number;
  reservedUnits: number;
  taggedReservedUnits: number;
  barcodeFallbackUnits: number;
  activeAuthorizations: number;
  dispatchedUnits: number;
};

type OrderWorkflow = {
  requestedUnits: number;
  reservedUnits: number;
  taggedReservedUnits: number;
  barcodeFallbackUnits: number;
  activeAuthorizations: number;
  dispatchedUnits: number;
  lines: OrderWorkflowLine[];
};

type Order = {
  _id: string;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  authorizationLocation?: string | null;
  authorizationExpiresAt?: string | null;
  items: OrderLine[];
};

type OrderDetailResponse = {
  ok: true;
  order: Order;
  workflow: OrderWorkflow;
};

type TagRecord = {
  _id: string;
  tagId: string;
  itemId?: string | null;
  itemBarcode?: string | null;
  itemName?: string | null;
  itemSku?: string | null;
  status: "active" | "inactive";
  assignedAt?: string | null;
  deactivatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  activeExitAuthorizations?: number;
};

type ExitSession = {
  id: string;
  token: string;
  expiresAt: string;
  location: string;
  orderId?: string;
};

type ExitScanLog = {
  value: string;
  mode: "tagId" | "barcode";
  authorized: boolean;
  decision: string;
  itemName?: string;
  when: Date;
};

type StationConfig = {
  receiveLocations: string[];
  gateLocations: string[];
  windowMinutes: number[];
  defaults: {
    receiveLocation: string;
    gateLocation: string;
    windowMinutes: number;
  };
};

type StationConfigResponse = {
  ok: true;
  stations: StationConfig;
};

type ReceivingContext = {
  id: string;
  itemId: string;
  location: string;
  source?: string;
  status: "active" | "released";
  receivedCount: number;
  lastTagId?: string | null;
  lastScanAt?: string | null;
  expiresAt: string;
  item: InventoryItem | null;
};

type Props = NativeStackScreenProps<MoreStackParamList, "RfidHub">;

const DEFAULT_STATION_CONFIG: StationConfig = {
  receiveLocations: ["RECEIVING_STAGING"],
  gateLocations: ["EXIT_MAIN"],
  windowMinutes: [5, 10, 15],
  defaults: {
    receiveLocation: "RECEIVING_STAGING",
    gateLocation: "EXIT_MAIN",
    windowMinutes: 10,
  },
};

const MODE_TAB_ITEMS: Array<{ key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "assign", label: "Receive", icon: "download-outline" },
  { key: "authorize", label: "Authorize", icon: "shield-checkmark-outline" },
  { key: "exit", label: "Exit", icon: "exit-outline" },
  { key: "tags", label: "Tags", icon: "pricetag-outline" },
];

function getAllowedModes(role?: string | null): Mode[] {
  if (role === "admin") return ["assign", "authorize", "exit", "tags"];
  if (role === "manager") return ["assign", "authorize", "exit"];
  return ["assign"];
}

function successFeedback() {
  try {
    if (Platform.OS !== "web") {
      Vibration.vibrate(40);
      return;
    }
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => {
      try {
        oscillator.stop();
        ctx.close?.();
      } catch {
        // ignore
      }
    }, 90);
  } catch {
    // ignore
  }
}

function errorFeedback() {
  try {
    if (Platform.OS !== "web") {
      Vibration.vibrate([0, 40, 30, 40]);
      return;
    }
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 220;
    gain.gain.value = 0.06;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => {
      try {
        oscillator.stop();
        ctx.close?.();
      } catch {
        // ignore
      }
    }, 120);
  } catch {
    // ignore
  }
}

function toneForStatus(status: string) {
  if (status === "fulfilled") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "authorized") return "warning" as const;
  if (status === "picking") return "primary" as const;
  if (status === "active") return "success" as const;
  if (status === "inactive") return "default" as const;
  return "default" as const;
}

function formatCountdown(expiresAt?: string | null) {
  if (!expiresAt) return "-";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatStationLabel(value: string) {
  const normalized = value.replace(/_/g, " ").trim();
  if (!normalized) return "";
  if (/[a-z]/.test(normalized)) return normalized;
  return normalized.toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
}

function truncateValue(value: string, start = 8, end = 4) {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function useIsDesktopWeb() {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= 900;
}

function ModeTabs({
  mode,
  onChange,
  items,
}: {
  mode: Mode;
  onChange: (value: Mode) => void;
  items: Array<{ key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap }>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map((item) => {
        const active = item.key === mode;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Ionicons name={item.icon} size={15} color={active ? theme.colors.text : theme.colors.textMuted} />
            <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ResultFlash({ visible, success, title, subtitle }: { visible: boolean; success: boolean; title: string; subtitle?: string }) {
  if (!visible) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: (success ? theme.colors.success : theme.colors.danger) + "dd",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 24,
      }}
    >
      <Ionicons name={success ? "checkmark-circle" : "close-circle"} size={80} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 16 }}>{title}</Text>
      {subtitle ? <Text style={{ color: "#fff", fontSize: 15, marginTop: 8, textAlign: "center" }}>{subtitle}</Text> : null}
    </View>
  );
}

type StationCapture = {
  value: string;
  label: string;
  at: Date;
};

function PassiveScanDock({
  title,
  detail,
  enabled,
  busy,
  lastCapture,
  statusLabel,
  minimal,
  onScan,
}: {
  title: string;
  detail?: string;
  enabled: boolean;
  busy: boolean;
  lastCapture: StationCapture | null;
  statusLabel?: string;
  minimal?: boolean;
  onScan: (value: string) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const [buffer, setBuffer] = useState("");

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const flushScan = useCallback(
    (rawValue?: string) => {
      const nextValue = (rawValue ?? buffer).trim();
      if (!enabled || busy || !nextValue) return;
      setBuffer("");
      onScan(nextValue);
    },
    [buffer, busy, enabled, onScan]
  );

  useEffect(() => {
    if (!enabled) return;
    const boot = setTimeout(focusInput, 80);
    const interval = setInterval(focusInput, 1200);
    return () => {
      clearTimeout(boot);
      clearInterval(interval);
    };
  }, [enabled, focusInput, title]);

  useEffect(() => {
    if (!enabled || busy) return;
    const nextValue = buffer.trim();
    if (!nextValue) return;
    const timer = setTimeout(() => flushScan(nextValue), 140);
    return () => clearTimeout(timer);
  }, [buffer, busy, enabled, flushScan]);

  const input = (
    <TextInput
      ref={inputRef}
      value={buffer}
      onChangeText={setBuffer}
      onSubmitEditing={() => flushScan()}
      autoCapitalize="none"
      autoCorrect={false}
      blurOnSubmit={false}
      caretHidden
      contextMenuHidden
      showSoftInputOnFocus={false}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
    />
  );

  if (minimal) {
    return (
      <Pressable onPress={focusInput}>
        <View
          style={{
            minHeight: 220,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: 20,
            paddingVertical: 28,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Ionicons name="radio-outline" size={28} color={theme.colors.text} />
          </View>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{busy ? "Processing" : statusLabel ?? title}</Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 14, textAlign: "center" }}>
            {lastCapture ? `${lastCapture.label} | ${truncateValue(lastCapture.value, 12, 6)}` : detail ?? "Waiting for RFID scan"}
          </Text>
          {lastCapture ? <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{lastCapture.at.toLocaleTimeString()}</Text> : null}
          {input}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={focusInput}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="radio-outline" size={18} color={theme.colors.text} />
            </View>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{title}</Text>
          </View>
          <Badge label={busy ? "Processing" : enabled ? statusLabel ?? "Live" : "Paused"} tone={busy ? "warning" : enabled ? "success" : "default"} />
        </View>

        <View
          style={{
            marginTop: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: 14,
            paddingVertical: 20,
            backgroundColor: theme.colors.surface2,
            gap: 8,
            alignItems: "center",
          }}
        >
          <Ionicons name="scan-outline" size={24} color={theme.colors.textMuted} />
          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{busy ? "Processing" : statusLabel ?? "Waiting"}</Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
            {lastCapture ? `${lastCapture.label} | ${truncateValue(lastCapture.value, 12, 6)}` : detail ?? "Waiting for scan"}
          </Text>
          {lastCapture ? <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{lastCapture.at.toLocaleTimeString()}</Text> : null}
        </View>

        {input}
      </Card>
    </Pressable>
  );
}

function ReceiveMode({ token, stationConfig, initialItemId }: { token: string; stationConfig: StationConfig; initialItemId?: string }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [activeItem, setActiveItem] = useState<InventoryItem | null>(null);
  const [context, setContext] = useState<ReceivingContext | null>(null);
  const [location, setLocation] = useState<string>(stationConfig.defaults.receiveLocation || DEFAULT_STATION_CONFIG.defaults.receiveLocation);
  const [query, setQuery] = useState("");
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (stationConfig.receiveLocations.includes(location)) return;
    setLocation(stationConfig.defaults.receiveLocation || stationConfig.receiveLocations[0] || DEFAULT_STATION_CONFIG.defaults.receiveLocation);
  }, [location, stationConfig]);

  const hydrateContext = useCallback((nextContext: ReceivingContext | null) => {
    setContext(nextContext);
    if (nextContext?.item) {
      setActiveItem(nextContext.item);
      setLocation(nextContext.location);
      return;
    }
    if (!nextContext) return;
    setLocation(nextContext.location);
  }, []);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "80");
      if (query.trim()) params.set("q", query.trim());
      const res = await apiRequest<{ ok: true; items: InventoryItem[] }>(`/inventory/items?${params.toString()}`, { method: "GET", token });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoadingItems(false);
    }
  }, [query, token]);

  const loadActiveContext = useCallback(async (silent = false) => {
    if (!silent) setError(null);
    try {
      const res = await apiRequest<{ ok: true; context: ReceivingContext | null }>("/rfid/receiving-contexts/active", { method: "GET", token });
      hydrateContext(res.context);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load receiving state");
    }
  }, [hydrateContext, token]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadActiveContext(true);
  }, [loadActiveContext]);

  useEffect(() => {
    if (!initialItemId || context) return;
    apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${encodeURIComponent(initialItemId)}`, { method: "GET", token })
      .then((res) => {
        setActiveItem(res.item);
        setMessage(`${res.item.name} selected`);
      })
      .catch(() => undefined);
  }, [context, initialItemId, token]);

  useEffect(() => {
    if (!context) return;
    const timer = setInterval(() => {
      void loadActiveContext(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [context, loadActiveContext]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = needle
      ? items.filter((item) => `${item.name} ${item.sku} ${item.barcode ?? ""} ${item.location ?? ""}`.toLowerCase().includes(needle))
      : items;
    return source.slice(0, 12);
  }, [items, query]);

  const armContext = useCallback(async () => {
    if (!activeItem?._id || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ ok: true; context: ReceivingContext }>("/rfid/receiving-contexts", {
        method: "POST",
        token,
        body: JSON.stringify({
          itemId: activeItem._id,
          location,
        }),
      });
      hydrateContext(res.context);
      setMessage(`${res.context.item?.name ?? activeItem.name} is armed for RFID receiving`);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to arm receiving");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }, [activeItem, hydrateContext, location, saving, token]);

  const releaseContext = useCallback(async () => {
    if (!context || saving) {
      setContext(null);
      setActiveItem(null);
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/rfid/receiving-contexts/${encodeURIComponent(context.id)}`, { method: "DELETE", token });
      setContext(null);
      setActiveItem(null);
      setMessage("Receiving item released");
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to release receiving item");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }, [context, saving, token]);

  const selectedIsArmed = Boolean(context && activeItem && context.itemId === activeItem._id);

  return (
    <View style={{ gap: 14 }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}

      <PassiveScanDock
        title="Receive"
        detail={selectedIsArmed ? "Waiting for RFID tag scan" : "Select item and location to arm receiving"}
        enabled={false}
        busy={saving}
        lastCapture={
          context?.lastTagId
            ? { value: context.lastTagId, label: "Last RFID tag", at: context.lastScanAt ? new Date(context.lastScanAt) : new Date() }
            : null
        }
        statusLabel={selectedIsArmed ? "Waiting for RFID scan" : "Not armed"}
        minimal
        onScan={() => undefined}
      />

      <Card>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Receiving item</Text>
              <MutedText>{selectedIsArmed ? "Hardware can now send tagId only." : "Choose the product these blank tags belong to."}</MutedText>
            </View>
            <Badge label={selectedIsArmed ? `Received ${context?.receivedCount ?? 0}` : "Idle"} tone={selectedIsArmed ? "success" : "default"} />
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface2,
              paddingHorizontal: 12,
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search item, SKU, barcode"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: theme.colors.text, fontSize: 14, minHeight: 46 }}
            />
            {loadingItems ? <ActivityIndicator color={theme.colors.primary} /> : null}
          </View>

          {activeItem ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: selectedIsArmed ? theme.colors.success : theme.colors.border,
                borderRadius: theme.radius.md,
                backgroundColor: selectedIsArmed ? theme.colors.success + "12" : theme.colors.surface,
                padding: 14,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>{activeItem.name}</Text>
                  <MutedText>{`${activeItem.sku} | Qty ${activeItem.quantity}`}</MutedText>
                </View>
                <Badge label={selectedIsArmed ? "Armed" : "Selected"} tone={selectedIsArmed ? "success" : "primary"} />
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {stationConfig.receiveLocations.map((station) => {
                  const active = location === station;
                  return (
                    <Pressable
                      key={station}
                      disabled={selectedIsArmed || saving}
                      onPress={() => setLocation(station)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface2,
                        opacity: selectedIsArmed && !active ? 0.55 : 1,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 12 }}>{formatStationLabel(station)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <AppButton
                  title={selectedIsArmed ? "Receiving armed" : "Arm receiving"}
                  onPress={armContext}
                  disabled={selectedIsArmed || saving}
                  loading={saving && !selectedIsArmed}
                  iconName="radio-outline"
                />
                <AppButton title={selectedIsArmed ? "Release" : "Clear"} onPress={releaseContext} variant="secondary" disabled={saving} />
              </View>
            </View>
          ) : null}
        </View>
      </Card>

      {!selectedIsArmed ? (
        <Card>
          <View style={{ gap: 8 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Items</Text>
            {filteredItems.length === 0 ? <MutedText>No items found.</MutedText> : null}
            {filteredItems.map((item) => {
              const selected = activeItem?._id === item._id;
              return (
                <Pressable
                  key={item._id}
                  onPress={() => {
                    setActiveItem(item);
                    setMessage(null);
                    setError(null);
                  }}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "800" }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 13 }} numberOfLines={1}>{`${item.sku} | ${item.location || "No location"}`}</Text>
                  </View>
                  <Badge label={selected ? "Selected" : `Qty ${item.quantity}`} tone={selected ? "primary" : "default"} />
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function AuthorizationMode({
  token,
  onSwitchMode,
  stationConfig,
  isDesktopWeb,
}: {
  token: string;
  onSwitchMode: (mode: Mode) => void;
  stationConfig: StationConfig;
  isDesktopWeb: boolean;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [showCompactDetail, setShowCompactDetail] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);
  const [workflow, setWorkflow] = useState<OrderWorkflow | null>(null);
  const [gateLocation, setGateLocation] = useState(stationConfig.defaults.gateLocation || DEFAULT_STATION_CONFIG.defaults.gateLocation);
  const [windowMinutes, setWindowMinutes] = useState(stationConfig.defaults.windowMinutes || DEFAULT_STATION_CONFIG.defaults.windowMinutes);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; orders: Order[] }>("/orders", { method: "GET", token });
      const openOrders = res.orders.filter((order) => order.status !== "fulfilled" && order.status !== "cancelled");
      setOrders(openOrders);
      if (isDesktopWeb && !selectedId && openOrders[0]) {
        setSelectedId(openOrders[0]._id);
      }
      if (!isDesktopWeb && !openOrders.some((order) => order._id === selectedId)) {
        setSelectedId("");
        setShowCompactDetail(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [isDesktopWeb, selectedId, token]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setWorkflow(null);
      return;
    }
    try {
      const res = await apiRequest<OrderDetailResponse>(`/orders/${selectedId}`, { method: "GET", token });
      setDetail(res.order);
      setWorkflow(res.workflow);
      setGateLocation(res.order.authorizationLocation || stationConfig.defaults.gateLocation || DEFAULT_STATION_CONFIG.defaults.gateLocation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load order detail");
    }
  }, [selectedId, stationConfig.defaults.gateLocation, token]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (stationConfig.gateLocations.includes(gateLocation)) return;
    setGateLocation(stationConfig.defaults.gateLocation || stationConfig.gateLocations[0] || DEFAULT_STATION_CONFIG.defaults.gateLocation);
  }, [gateLocation, stationConfig]);

  useEffect(() => {
    if (stationConfig.windowMinutes.includes(windowMinutes)) return;
    setWindowMinutes(stationConfig.defaults.windowMinutes || stationConfig.windowMinutes[0] || DEFAULT_STATION_CONFIG.defaults.windowMinutes);
  }, [stationConfig, windowMinutes]);

  async function startPicking() {
    if (!selectedId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<OrderDetailResponse>(`/orders/${selectedId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status: "picking" }),
      });
      setDetail(res.order);
      setWorkflow(res.workflow);
      setMessage("Units reserved");
      successFeedback();
      void loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reserve units");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }

  async function authorizeExit() {
    if (!selectedId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ ok: true; order: Order; workflow: OrderWorkflow; authorization: { location: string; expiresAt: string } }>(
        `/orders/${selectedId}/authorize-exit`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ location: gateLocation, minutes: windowMinutes }),
        }
      );
      setDetail(res.order);
      setWorkflow(res.workflow);
      setMessage(`${formatStationLabel(res.authorization.location)} live until ${new Date(res.authorization.expiresAt).toLocaleTimeString()}`);
      successFeedback();
      void loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to authorize gate exit");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = useMemo(() => orders.find((order) => order._id === selectedId) ?? detail, [detail, orders, selectedId]);
  const detailPane = selectedOrder && workflow ? (
    <Card style={isDesktopWeb ? { width: 420 } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{`Order #${selectedOrder._id.slice(-6)}`}</Text>
          {!isDesktopWeb ? <MutedText>{formatStationLabel(selectedOrder.authorizationLocation || gateLocation)}</MutedText> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Badge label={selectedOrder.status} tone={toneForStatus(selectedOrder.status)} />
          {!isDesktopWeb ? <AppButton title="Back" onPress={() => setShowCompactDetail(false)} variant="secondary" iconName="chevron-back" iconOnly /> : null}
        </View>
      </View>

      {isDesktopWeb ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 760 }}>
            <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
              {[
                { label: "Product", width: 220 },
                { label: "SKU", width: 160 },
                { label: "Need", width: 70 },
                { label: "Reserved", width: 90 },
                { label: "Tagged", width: 80 },
                { label: "Fallback", width: 80 },
              ].map((column) => (
                <Text key={column.label} style={{ width: column.width, color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                  {column.label}
                </Text>
              ))}
            </View>
            {workflow.lines.map((line) => (
              <View key={line.itemId} style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={{ width: 220, color: theme.colors.text, fontWeight: "700" }}>{line.name}</Text>
                <Text style={{ width: 160, color: theme.colors.textMuted }}>{line.sku}</Text>
                <Text style={{ width: 70, color: theme.colors.textMuted }}>{line.requestedQuantity}</Text>
                <Text style={{ width: 90, color: theme.colors.textMuted }}>{line.reservedUnits}</Text>
                <Text style={{ width: 80, color: theme.colors.textMuted }}>{line.taggedReservedUnits}</Text>
                <Text style={{ width: 80, color: theme.colors.textMuted }}>{line.barcodeFallbackUnits}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={{ gap: 8 }}>
          {workflow.lines.map((line) => (
            <View
              key={line.itemId}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: 12,
                backgroundColor: theme.colors.surface2,
                gap: 4,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{line.name}</Text>
              <MutedText>{line.sku}</MutedText>
              <MutedText>{`Need ${line.requestedQuantity} | Reserved ${line.reservedUnits} | Tagged ${line.taggedReservedUnits}`}</MutedText>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 12 }} />
      <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Gate</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stationConfig.gateLocations.map((preset) => {
          const active = gateLocation === preset;
          return (
            <Pressable
              key={preset}
              onPress={() => setGateLocation(preset)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{formatStationLabel(preset)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: 12 }} />
      <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Window</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stationConfig.windowMinutes.map((minutes) => {
          const active = windowMinutes === minutes;
          return (
            <Pressable
              key={minutes}
              onPress={() => setWindowMinutes(minutes)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{minutes} min</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: 12 }} />
      <View style={{ gap: 10 }}>
        {selectedOrder.status === "created" ? (
          <AppButton title="Reserve units" onPress={() => void startPicking()} variant="secondary" disabled={saving} loading={saving} />
        ) : null}
        <AppButton title={selectedOrder.status === "authorized" ? "Refresh authorization" : "Authorize exit"} onPress={() => void authorizeExit()} disabled={saving} loading={saving} />
        {selectedOrder.status === "authorized" ? <AppButton title="Open Exit" onPress={() => onSwitchMode("exit")} variant="secondary" /> : null}
      </View>
    </Card>
  ) : isDesktopWeb ? (
    <Card style={{ width: 420 }}>
      <MutedText>Select an order to see details.</MutedText>
    </Card>
  ) : null;

  return (
    <View style={{ gap: 14 }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
          <Card style={{ flex: 1 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Orders</Text>

            {loading ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : orders.length === 0 ? (
              <MutedText>No open orders.</MutedText>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ minWidth: 760 }}>
                  <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
                    {[
                      { label: "Order", width: 170 },
                      { label: "Created", width: 190 },
                      { label: "Gate", width: 220 },
                      { label: "Status", width: 120 },
                    ].map((column) => (
                      <Text key={column.label} style={{ width: column.width, color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                        {column.label}
                      </Text>
                    ))}
                  </View>
                  {orders.map((order) => {
                    const active = order._id === selectedId;
                    return (
                      <Pressable
                        key={order._id}
                        onPress={() => setSelectedId(order._id)}
                        style={{
                          flexDirection: "row",
                          paddingHorizontal: 12,
                          paddingVertical: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                          backgroundColor: active ? theme.colors.surface2 : theme.colors.surface,
                        }}
                      >
                        <Text style={{ width: 170, color: theme.colors.text, fontWeight: "700" }}>{`Order #${order._id.slice(-6)}`}</Text>
                        <Text style={{ width: 190, color: theme.colors.textMuted }}>{new Date(order.createdAt).toLocaleString()}</Text>
                        <Text style={{ width: 220, color: theme.colors.textMuted }}>{formatStationLabel(order.authorizationLocation || gateLocation)}</Text>
                        <View style={{ width: 120 }}>
                          <Badge label={order.status} tone={toneForStatus(order.status)} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </Card>
          {detailPane}
        </View>
      ) : (
        <>
          {showCompactDetail && detailPane ? (
            detailPane
          ) : (
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Orders</Text>

              {loading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : orders.length === 0 ? (
                <MutedText>No open orders.</MutedText>
              ) : (
                <View style={{ gap: 8 }}>
                  {orders.map((order) => (
                    <Pressable
                      key={order._id}
                      onPress={() => {
                        setSelectedId(order._id);
                        setShowCompactDetail(true);
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: selectedId === order._id ? theme.colors.primary : theme.colors.border,
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radius.md,
                        padding: 12,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{`Order #${order._id.slice(-6)}`}</Text>
                        <Badge label={order.status} tone={toneForStatus(order.status)} />
                      </View>
                      <MutedText>{formatStationLabel(order.authorizationLocation || gateLocation)}</MutedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          )}
        </>
      )}
    </View>
  );
}

function ExitMode({ token, stationConfig, isDesktopWeb }: { token: string; stationConfig: StationConfig; isDesktopWeb: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [gateLocation, setGateLocation] = useState(stationConfig.defaults.gateLocation || DEFAULT_STATION_CONFIG.defaults.gateLocation);
  const [session, setSession] = useState<ExitSession | null>(null);
  const [countdown, setCountdown] = useState("-");
  const [scanLog, setScanLog] = useState<ExitScanLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const [flashTitle, setFlashTitle] = useState("AUTHORIZED");
  const [flashSubtitle, setFlashSubtitle] = useState<string | undefined>(undefined);
  const [flashSuccess, setFlashSuccess] = useState(true);
  const [lastCapture, setLastCapture] = useState<StationCapture | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await apiRequest<{ ok: true; orders: Order[] }>("/orders?status=authorized", { method: "GET", token });
      setOrders(res.orders);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (stationConfig.gateLocations.includes(gateLocation)) return;
    setGateLocation(stationConfig.defaults.gateLocation || stationConfig.gateLocations[0] || DEFAULT_STATION_CONFIG.defaults.gateLocation);
  }, [gateLocation, stationConfig]);

  useEffect(() => {
    if (selectedOrderId && orders.some((order) => order._id === selectedOrderId)) return;
    if (!orders[0]) {
      setSelectedOrderId("");
      setSession(null);
      return;
    }
    setSelectedOrderId(orders[0]._id);
    setGateLocation(orders[0].authorizationLocation || stationConfig.defaults.gateLocation || DEFAULT_STATION_CONFIG.defaults.gateLocation);
  }, [orders, selectedOrderId, stationConfig.defaults.gateLocation]);

  useEffect(() => {
    if (!session) {
      setCountdown("-");
      return;
    }
    const timer = setInterval(() => {
      const next = formatCountdown(session.expiresAt);
      setCountdown(next);
      if (next === "Expired") {
        setSession(null);
        setScanLog([]);
      }
    }, 1000);
    setCountdown(formatCountdown(session.expiresAt));
    return () => clearInterval(timer);
  }, [session]);

  const requestSession = useCallback(
    async (orderIdOverride?: string, silent = false) => {
      const orderId = orderIdOverride ?? selectedOrderId;
      if (!orderId || loading) return;
      setLoading(true);
      if (!silent) setError(null);
      try {
        const res = await apiRequest<{ ok: true; session: ExitSession }>("/rfid/exit-sessions", {
          method: "POST",
          token,
          body: JSON.stringify({
            orderId,
            location: gateLocation,
            minutes: stationConfig.windowMinutes[0] ?? 5,
          }),
        });
        setSession(res.session);
        if (!silent) {
          setScanLog([]);
          successFeedback();
        }
      } catch (e) {
        if (!silent) {
          setError(e instanceof Error ? e.message : "Failed to request exit token");
          errorFeedback();
        }
      } finally {
        setLoading(false);
      }
    },
    [gateLocation, loading, selectedOrderId, stationConfig.windowMinutes, token]
  );

  const desiredOrderId = selectedOrderId || orders[0]?._id || "";
  const sessionStillValid =
    !!session &&
    session.location === gateLocation &&
    (session.orderId || "") === desiredOrderId &&
    new Date(session.expiresAt).getTime() - Date.now() > 15000;

  useEffect(() => {
    if (!desiredOrderId || loading || verifying || sessionStillValid) return;
    void requestSession(desiredOrderId, true);
  }, [desiredOrderId, loading, requestSession, sessionStillValid, verifying]);

  async function verifyScan(value: string) {
    if (!session || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await apiRequest<{
        ok: true;
        mode?: "tagId" | "barcode";
        authorized: boolean;
        decision: string;
        item?: { name?: string };
        remainingAuthorizations: number;
      }>("/rfid/exit-sessions/verify", {
        method: "POST",
        token,
        body: JSON.stringify({
          token: session.token,
          value,
        }),
      });

      const resolvedMode = res.mode === "barcode" ? "barcode" : "tagId";

      setScanLog((prev) => [
        {
          value,
          mode: resolvedMode,
          authorized: res.authorized,
          decision: res.decision,
          itemName: res.item?.name,
          when: new Date(),
        },
        ...prev.slice(0, 11),
      ]);
      setLastCapture({
        value,
        label: resolvedMode === "barcode" ? "Barcode" : "RFID",
        at: new Date(),
      });

      setFlashSuccess(res.authorized);
      setFlashTitle(res.authorized ? "AUTHORIZED" : "DENIED");
      setFlashSubtitle(res.item?.name ? `${res.item.name} (${value})` : value);
      setFlashVisible(true);
      setTimeout(() => setFlashVisible(false), 1500);

      if (res.authorized) {
        successFeedback();
      } else {
        errorFeedback();
      }

      if (res.remainingAuthorizations === 0) {
        setSession(null);
        void loadOrders();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify exit scan");
      errorFeedback();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: orders.length > 0 ? 10 : 0 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Authorized</Text>
            {orders.length === 0 ? <MutedText>No active gate authorization.</MutedText> : null}
          </View>
          {session ? <Badge label={countdown} tone="success" /> : null}
        </View>

        {orders.length === 0 ? (
          <View />
        ) : isDesktopWeb ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 760 }}>
              <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
                {[
                  { label: "Order", width: 170 },
                  { label: "Status", width: 120 },
                  { label: "Gate", width: 220 },
                  { label: "Window", width: 100 },
                  { label: "Lane", width: 120 },
                ].map((column) => (
                  <Text key={column.label} style={{ width: column.width, color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                    {column.label}
                  </Text>
                ))}
              </View>
              {orders.map((order) => {
                const active = order._id === selectedOrderId;
                return (
                  <Pressable
                    key={order._id}
                    onPress={() => {
                      setSelectedOrderId(order._id);
                      setGateLocation(order.authorizationLocation || gateLocation);
                      setSession(null);
                    }}
                    style={{
                      flexDirection: "row",
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                      backgroundColor: active ? theme.colors.surface2 : theme.colors.surface,
                    }}
                  >
                    <Text style={{ width: 170, color: theme.colors.text, fontWeight: "700" }}>{`Order #${order._id.slice(-6)}`}</Text>
                    <View style={{ width: 120 }}>
                      <Badge label={order.status} tone={toneForStatus(order.status)} />
                    </View>
                    <Text style={{ width: 220, color: theme.colors.textMuted }}>{formatStationLabel(order.authorizationLocation || gateLocation)}</Text>
                    <Text style={{ width: 100, color: theme.colors.textMuted }}>{order.authorizationExpiresAt ? formatCountdown(order.authorizationExpiresAt) : "-"}</Text>
                    <Text style={{ width: 120, color: session?.orderId === order._id ? theme.colors.success : theme.colors.textMuted }}>
                      {session?.orderId === order._id ? "Live" : "Standby"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <View style={{ gap: 8 }}>
            {orders.map((order) => (
              <Pressable
                key={order._id}
                onPress={() => {
                  setSelectedOrderId(order._id);
                  setGateLocation(order.authorizationLocation || gateLocation);
                  setSession(null);
                }}
                style={{
                  borderWidth: 1,
                  borderColor: selectedOrderId === order._id ? theme.colors.primary : theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.md,
                  padding: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{`Order #${order._id.slice(-6)}`}</Text>
                  <Badge label={order.status} tone={toneForStatus(order.status)} />
                </View>
                <MutedText style={{ marginTop: 6 }}>{`${formatStationLabel(order.authorizationLocation || "-")} | ${order.authorizationExpiresAt ? formatCountdown(order.authorizationExpiresAt) : "-"}`}</MutedText>
              </Pressable>
            ))}
          </View>
        )}

        {stationConfig.gateLocations.length > 1 ? (
          <>
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: isDesktopWeb ? "row" : "column", alignItems: isDesktopWeb ? "center" : "stretch", gap: 10 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 }}>
                {stationConfig.gateLocations.map((preset) => {
                  const active = gateLocation === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() => {
                        setGateLocation(preset);
                        setSession(null);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                      }}
                    >
                      <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{formatStationLabel(preset)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {orders.length > 0 ? (
                <AppButton title={session ? "Re-arm" : "Arm lane"} onPress={() => void requestSession()} loading={loading} variant="secondary" />
              ) : null}
            </View>
          </>
        ) : null}

        {orders.length > 0 && stationConfig.gateLocations.length <= 1 ? (
          <>
            <View style={{ height: 12 }} />
            <AppButton title={session ? "Re-arm" : "Arm lane"} onPress={() => void requestSession()} loading={loading} variant="secondary" />
          </>
        ) : null}
      </Card>

      {session ? (
        <PassiveScanDock title="Exit" detail={formatStationLabel(session.location)} enabled busy={verifying || loading} lastCapture={lastCapture} statusLabel={countdown} onScan={(value) => void verifyScan(value)} />
      ) : null}

      {scanLog.length > 0 ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Scans</Text>
            <AppButton title="Clear" onPress={() => setScanLog([])} variant="secondary" />
          </View>
          <View style={{ gap: 8 }}>
            {scanLog.map((entry, index) => (
              <View
                key={`${entry.value}-${index}`}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  backgroundColor: entry.authorized ? theme.colors.success + "10" : theme.colors.danger + "10",
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{truncateValue(entry.value, 12, 6)}</Text>
                  <Badge label={entry.authorized ? "Allowed" : "Denied"} tone={entry.authorized ? "success" : "danger"} />
                </View>
                <MutedText>{entry.itemName ?? entry.decision}</MutedText>
                <MutedText>{`${entry.mode === "tagId" ? "RFID" : "Barcode"} | ${entry.when.toLocaleTimeString()}`}</MutedText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <ResultFlash visible={flashVisible} success={flashSuccess} title={flashTitle} subtitle={flashSubtitle} />
    </View>
  );
}

function TagsMode({ token, isDesktopWeb }: { token: string; isDesktopWeb: boolean }) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [selectedTag, setSelectedTag] = useState<TagRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiRequest<{ ok: true; tags: TagRecord[] }>(`/rfid/tags?${params.toString()}`, { method: "GET", token });
      setTags(res.tags);
      if (!selectedTagId && res.tags[0]) {
        setSelectedTagId(res.tags[0].tagId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, [selectedTagId, statusFilter, token]);

  const loadSelectedTag = useCallback(async () => {
    if (!selectedTagId) {
      setSelectedTag(null);
      return;
    }
    try {
      const res = await apiRequest<{ ok: true; tag: TagRecord }>(`/rfid/tags/${encodeURIComponent(selectedTagId)}`, { method: "GET", token });
      setSelectedTag(res.tag);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tag details");
    }
  }, [selectedTagId, token]);

  const loadInventoryCatalog = useCallback(async () => {
    try {
      const res = await apiRequest<{ ok: true; items: InventoryItem[] }>("/inventory/items", { method: "GET", token });
      setInventoryCatalog(
        [...res.items]
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, 24)
      );
    } catch {
      setInventoryCatalog([]);
    }
  }, [token]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    void loadSelectedTag();
  }, [loadSelectedTag]);

  useEffect(() => {
    void loadInventoryCatalog();
  }, [loadInventoryCatalog]);

  async function runTagAction(action: "activate" | "deactivate" | "remove", tagId: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (action === "remove") {
        await apiRequest(`/rfid/tags/${encodeURIComponent(tagId)}`, { method: "DELETE", token });
      } else {
        await apiRequest(`/rfid/tags/${encodeURIComponent(tagId)}/${action}`, { method: "POST", token });
      }
      setMessage(`${tagId} updated`);
      successFeedback();
      await loadTags();
      await loadSelectedTag();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update tag");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }

  async function reassignTag(tagId: string, itemId: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/rfid/tags/${encodeURIComponent(tagId)}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ itemId }),
      });
      setMessage(`${tagId} reassigned`);
      successFeedback();
      await loadTags();
      await loadSelectedTag();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign tag");
      errorFeedback();
    } finally {
      setSaving(false);
    }
  }

  const activeCount = useMemo(() => tags.filter((tag) => tag.status === "active").length, [tags]);
  const inactiveCount = useMemo(() => tags.filter((tag) => tag.status === "inactive").length, [tags]);
  const queuedExitCount = useMemo(() => tags.filter((tag) => (tag.activeExitAuthorizations ?? 0) > 0).length, [tags]);
  const reassignmentCandidates = useMemo(() => {
    if (!selectedTag) return inventoryCatalog.slice(0, 10);
    return inventoryCatalog.filter((item) => item._id !== selectedTag.itemId).slice(0, 10);
  }, [inventoryCatalog, selectedTag]);

  return (
    <View style={{ gap: 14 }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Registry</Text>
          <Pressable
            onPress={() => void loadTags()}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
          </Pressable>
        </View>

        <View style={{ height: 12 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["all", "active", "inactive"] as const).map((status) => {
            const active = statusFilter === status;
            const count = status === "all" ? tags.length : status === "active" ? activeCount : inactiveCount;
            return (
              <Pressable
                key={status}
                onPress={() => setStatusFilter(status)}
                style={{
                  minHeight: 36,
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>
                  {`${status} ${count}`}
                </Text>
              </Pressable>
            );
          })}
          <View
            style={{
              minHeight: 36,
              paddingVertical: 7,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: queuedExitCount > 0 ? theme.colors.warning : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>
              {`Queued ${queuedExitCount}`}
            </Text>
          </View>
        </View>
      </Card>

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tags</Text>
              {loading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : tags.length === 0 ? (
                <MutedText>No tags found.</MutedText>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ minWidth: 820 }}>
                    <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
                      {[
                        { label: "Tag", width: 200 },
                        { label: "Product", width: 220 },
                        { label: "SKU", width: 140 },
                        { label: "Status", width: 120 },
                        { label: "Queued", width: 90 },
                      ].map((column) => (
                        <Text key={column.label} style={{ width: column.width, color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                          {column.label}
                        </Text>
                      ))}
                    </View>
                    {tags.map((item) => {
                      const active = selectedTagId === item.tagId;
                      return (
                        <Pressable
                          key={item._id}
                          onPress={() => setSelectedTagId(item.tagId)}
                          style={{
                            flexDirection: "row",
                            paddingHorizontal: 12,
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.border,
                            backgroundColor: active ? theme.colors.surface2 : theme.colors.surface,
                          }}
                        >
                          <Text style={{ width: 200, color: theme.colors.text, fontWeight: "700" }}>{truncateValue(item.tagId, 16, 6)}</Text>
                          <Text style={{ width: 220, color: theme.colors.textMuted }}>{item.itemName || "Unassigned"}</Text>
                          <Text style={{ width: 140, color: theme.colors.textMuted }}>{item.itemSku || "-"}</Text>
                          <View style={{ width: 120 }}>
                            <Badge label={item.status} tone={toneForStatus(item.status)} />
                          </View>
                          <Text style={{ width: 90, color: theme.colors.textMuted }}>{item.activeExitAuthorizations ?? 0}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </Card>
          </View>

          <View style={{ width: 340, gap: 14 }}>
            {selectedTag ? (
              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Selected tag</Text>
                <View style={{ gap: 8 }}>
                  <Badge label={truncateValue(selectedTag.tagId, 14, 6)} tone="primary" />
                  <ListRow title="Product" subtitle={selectedTag.itemName || "Unassigned"} />
                  <ListRow title="SKU" subtitle={selectedTag.itemSku || "-"} />
                  <ListRow title="Barcode" subtitle={selectedTag.itemBarcode || "-"} />
                  <ListRow title="Queued exits" subtitle={String(selectedTag.activeExitAuthorizations ?? 0)} />
                  <ListRow title="Assigned" subtitle={selectedTag.assignedAt ? new Date(selectedTag.assignedAt).toLocaleString() : "-"} />
                  <ListRow title="Updated" subtitle={new Date(selectedTag.updatedAt).toLocaleString()} />
                </View>

                <View style={{ height: 12 }} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {selectedTag.status === "active" ? (
                    <AppButton title="Deactivate" onPress={() => void runTagAction("deactivate", selectedTag.tagId)} variant="secondary" disabled={saving} loading={saving} />
                  ) : (
                    <AppButton title="Activate" onPress={() => void runTagAction("activate", selectedTag.tagId)} variant="secondary" disabled={saving} loading={saving} />
                  )}
                  <AppButton title="Remove assignment" onPress={() => void runTagAction("remove", selectedTag.tagId)} variant="danger" disabled={saving} loading={saving} />
                </View>
              </Card>
            ) : null}

            {selectedTag ? (
              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 8 }]}>Reassign</Text>
                {reassignmentCandidates.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {reassignmentCandidates.map((item) => (
                      <Pressable
                        key={item._id}
                        onPress={() => void reassignTag(selectedTag.tagId, item._id)}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: theme.radius.md,
                          padding: 12,
                          backgroundColor: theme.colors.surface2,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.name}</Text>
                        <MutedText>{item.sku}</MutedText>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <MutedText>No inventory candidates loaded.</MutedText>
                )}
              </Card>
            ) : null}
          </View>
        </View>
      ) : (
        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tags</Text>
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : tags.length === 0 ? (
            <MutedText>No tags found.</MutedText>
          ) : (
            <FlatList
              data={tags}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedTagId(item.tagId)}
                  style={{
                    borderWidth: 1,
                    borderColor: selectedTagId === item.tagId ? theme.colors.primary : theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.md,
                    padding: 12,
                    marginBottom: 8,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{truncateValue(item.tagId, 12, 6)}</Text>
                    <Badge label={item.status} tone={toneForStatus(item.status)} />
                  </View>
                  <MutedText>{item.itemName || "Unassigned"}</MutedText>
                  <MutedText>{`Queued ${item.activeExitAuthorizations ?? 0}`}</MutedText>
                </Pressable>
              )}
            />
          )}
        </Card>
      )}

      {!isDesktopWeb && selectedTag ? (
        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Selected tag</Text>
          <View style={{ gap: 8 }}>
            <Badge label={truncateValue(selectedTag.tagId, 14, 6)} tone="primary" />
            <ListRow title="Product" subtitle={selectedTag.itemName || "Unassigned"} />
            <ListRow title="SKU" subtitle={selectedTag.itemSku || "-"} />
            <ListRow title="Barcode" subtitle={selectedTag.itemBarcode || "-"} />
            <ListRow title="Queued exits" subtitle={String(selectedTag.activeExitAuthorizations ?? 0)} />
            <ListRow title="Assigned" subtitle={selectedTag.assignedAt ? new Date(selectedTag.assignedAt).toLocaleString() : "-"} />
            <ListRow title="Updated" subtitle={new Date(selectedTag.updatedAt).toLocaleString()} />
          </View>

          <View style={{ height: 12 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {selectedTag.status === "active" ? (
              <AppButton title="Deactivate" onPress={() => void runTagAction("deactivate", selectedTag.tagId)} variant="secondary" disabled={saving} loading={saving} />
            ) : (
              <AppButton title="Activate" onPress={() => void runTagAction("activate", selectedTag.tagId)} variant="secondary" disabled={saving} loading={saving} />
            )}
            <AppButton title="Remove assignment" onPress={() => void runTagAction("remove", selectedTag.tagId)} variant="danger" disabled={saving} loading={saving} />
          </View>

          <View style={{ height: 16 }} />
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 8 }]}>Reassign</Text>
          {reassignmentCandidates.length > 0 ? (
            <View style={{ gap: 8 }}>
              {reassignmentCandidates.map((item) => (
                <Pressable
                  key={item._id}
                  onPress={() => void reassignTag(selectedTag.tagId, item._id)}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.md,
                    padding: 12,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.name}</Text>
                  <MutedText>{item.sku}</MutedText>
                  <MutedText>{item.barcode ? `Barcode ${item.barcode}` : "No barcode fallback"}</MutedText>
                </Pressable>
              ))}
            </View>
          ) : (
            <MutedText>No inventory candidates loaded.</MutedText>
          )}
        </Card>
      ) : null}
    </View>
  );
}

export function RfidHubScreen({ navigation, route }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const isDesktopWeb = useIsDesktopWeb();
  const [mode, setMode] = useState<Mode>(route.params?.initialMode ?? "assign");
  const [stationConfig, setStationConfig] = useState<StationConfig>(DEFAULT_STATION_CONFIG);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const allowedModes = useMemo(() => getAllowedModes(effectiveRole), [effectiveRole]);
  const modeTabItems = useMemo(() => MODE_TAB_ITEMS.filter((item) => allowedModes.includes(item.key)), [allowedModes]);
  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "MoreMenu");
  }, [navigation]);

  const loadStations = useCallback(async () => {
    if (!token) return;
    setStationsLoading(true);
    setStationsError(null);
    try {
      const res = await apiRequest<StationConfigResponse>("/rfid/stations", { method: "GET", token });
      setStationConfig(res.stations);
    } catch (e) {
      setStationConfig(DEFAULT_STATION_CONFIG);
      setStationsError(e instanceof Error ? e.message : "Failed to load RFID stations");
    } finally {
      setStationsLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadStations();
    }, [loadStations])
  );

  useEffect(() => {
    if (allowedModes.includes(mode)) return;
    setMode(allowedModes[0] ?? "assign");
  }, [allowedModes, mode]);

  useEffect(() => {
    const requestedMode = route.params?.initialMode;
    if (!requestedMode || !allowedModes.includes(requestedMode)) return;
    setMode(requestedMode);
  }, [allowedModes, route.params?.initialMode]);

  if (!token) {
    return (
      <Screen
        title="RFID Hub"
        center
        right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      >
        <MutedText>Sign in to use RFID operations.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen
      title="RFID Hub"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
    >
      <View style={{ gap: theme.spacing.md, paddingBottom: 40 }}>
        {stationsError ? <ErrorText>{stationsError}</ErrorText> : null}
        <ModeTabs mode={mode} onChange={setMode} items={modeTabItems} />

        {stationsLoading ? <ActivityIndicator color={theme.colors.primary} /> : null}

        {mode === "assign" ? <ReceiveMode token={token} stationConfig={stationConfig} initialItemId={route.params?.itemId} /> : null}
        {mode === "authorize" ? <AuthorizationMode token={token} onSwitchMode={setMode} stationConfig={stationConfig} isDesktopWeb={isDesktopWeb} /> : null}
        {mode === "exit" ? <ExitMode token={token} stationConfig={stationConfig} isDesktopWeb={isDesktopWeb} /> : null}
        {mode === "tags" ? <TagsMode token={token} isDesktopWeb={isDesktopWeb} /> : null}
      </View>
    </Screen>
  );
}
