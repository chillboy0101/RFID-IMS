import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
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

const LOCATION_PRESETS = ["RECEIVING_STAGING", "BIN_A1", "BIN_B2", "STAGING", "EXIT_MAIN", "EXIT_LOADING_BAY"];
const GATE_PRESETS = ["EXIT_MAIN", "EXIT_LOADING_BAY", "EXIT_REAR"];
const WINDOW_PRESETS = [5, 10, 15];

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

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (value: Mode) => void }) {
  const items: Array<{ key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = [
    { key: "assign", label: "Receive", icon: "download-outline", color: "#0D9488" },
    { key: "authorize", label: "Authorize", icon: "shield-checkmark-outline", color: "#7C3AED" },
    { key: "exit", label: "Exit", icon: "exit-outline", color: theme.colors.warning },
    { key: "tags", label: "Tags", icon: "pricetag-outline", color: theme.colors.primary },
  ];

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
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 16,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? item.color : theme.colors.border,
              backgroundColor: active ? item.color : theme.colors.surface,
            }}
          >
            <Ionicons name={item.icon} size={16} color={active ? "#fff" : theme.colors.textMuted} />
            <Text style={{ color: active ? "#fff" : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{item.label}</Text>
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
  subtitle,
  accentColor,
  enabled,
  busy,
  lastCapture,
  statusLabel,
  onScan,
}: {
  title: string;
  subtitle: string;
  accentColor: string;
  enabled: boolean;
  busy: boolean;
  lastCapture: StationCapture | null;
  statusLabel?: string;
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

  return (
    <Pressable onPress={focusInput}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{title}</Text>
            <MutedText>{subtitle}</MutedText>
          </View>
          <Badge label={busy ? "Processing" : enabled ? statusLabel ?? "Live" : "Paused"} tone={busy ? "warning" : enabled ? "success" : "default"} />
        </View>

        <View
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: accentColor,
            borderStyle: "dashed",
            borderRadius: theme.radius.lg,
            padding: 18,
            backgroundColor: accentColor + "10",
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: accentColor,
              }}
            >
              <Ionicons name="radio-outline" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800" }}>{busy ? "Scanner busy" : "Scanner armed"}</Text>
              <MutedText>{lastCapture ? `${lastCapture.label}: ${lastCapture.value}` : "Waiting for the next hardware scan."}</MutedText>
            </View>
          </View>
          <MutedText>{lastCapture ? `Last capture ${lastCapture.at.toLocaleTimeString()}` : "Tap anywhere on this panel if the reader focus needs to be re-armed."}</MutedText>
        </View>

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
      </Card>
    </Pressable>
  );
}

function ReceiveMode({ token }: { token: string }) {
  const [activeItem, setActiveItem] = useState<InventoryItem | null>(null);
  const [location, setLocation] = useState("RECEIVING_STAGING");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);
  const [lastCapture, setLastCapture] = useState<StationCapture | null>(null);
  const [lastLinkedTag, setLastLinkedTag] = useState<string | null>(null);
  const [flashVisible, setFlashVisible] = useState(false);

  const clearSku = useCallback(() => {
    setActiveItem(null);
    setMessage(null);
    setLastLinkedTag(null);
  }, []);

  const lookupItem = useCallback(
    async (value: string) => {
      setError(null);
      try {
        const res = await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/lookup?barcode=${encodeURIComponent(value)}`, { method: "GET", token });
        setActiveItem(res.item);
        setLastCapture({ value, label: "SKU barcode", at: new Date() });
        setMessage(`${res.item.name} armed for receiving`);
        successFeedback();
      } catch (e) {
        setActiveItem(null);
        setError(e instanceof Error ? e.message : "Item not found");
        errorFeedback();
      }
    },
    [token]
  );

  const assignTag = useCallback(
    async (value: string) => {
      if (!activeItem?._id || saving) return;
      setSaving(true);
      setError(null);
      try {
        await apiRequest("/inventory/receiving/units", {
          method: "POST",
          token,
          body: JSON.stringify({
            itemId: activeItem._id,
            tagId: value,
            location,
            quantity: 1,
          }),
        });
        setLastLinkedTag(value);
        setLastCapture({ value, label: "RFID tag", at: new Date() });
        setReceivedCount((count) => count + 1);
        setMessage(`${activeItem.name} linked to ${value}`);
        successFeedback();
        setFlashVisible(true);
        setTimeout(() => setFlashVisible(false), 1400);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to assign tag");
        errorFeedback();
      } finally {
        setSaving(false);
      }
    },
    [activeItem?._id, activeItem?.name, location, saving, token]
  );

  const handleScan = useCallback(
    async (value: string) => {
      if (!value.trim() || saving) return;
      if (!activeItem) {
        await lookupItem(value);
        return;
      }
      await assignTag(value);
    },
    [activeItem, assignTag, lookupItem, saving]
  );

  return (
    <View style={{ gap: 14 }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <Badge label={message} tone="success" /> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Badge label={activeItem ? `SKU ${activeItem.sku}` : "Awaiting SKU"} tone={activeItem ? "primary" : "default"} />
        <Badge label={`Location ${location}`} tone="default" />
        <Badge label={`Linked ${receivedCount}`} tone={receivedCount > 0 ? "success" : "default"} />
      </View>

      <PassiveScanDock
        title={activeItem ? "Receive lane armed" : "SKU capture armed"}
        subtitle={
          activeItem
            ? `${activeItem.name} is locked for this station. Each RFID scan receives one unit into ${location}.`
            : "Scan the incoming barcode once to lock the SKU, then keep scanning RFID tags without touching the screen."
        }
        accentColor="#0D9488"
        enabled
        busy={saving}
        lastCapture={lastCapture}
        statusLabel={activeItem ? "Receiving" : "Waiting"}
        onScan={(value) => void handleScan(value)}
      />

      {activeItem ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{activeItem.name}</Text>
              <MutedText>SKU: {activeItem.sku}</MutedText>
              <MutedText>Current quantity: {activeItem.quantity}</MutedText>
              <MutedText>Stage location: {location}</MutedText>
            </View>
            <Badge label="Locked" tone="primary" />
          </View>

          <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {lastLinkedTag ? <Badge label={`Last tag ${lastLinkedTag}`} tone="success" /> : null}
            <Badge label={`Session count ${receivedCount}`} tone={receivedCount > 0 ? "success" : "default"} />
          </View>

          <View style={{ height: 12 }} />
          <AppButton title="Change active SKU" onPress={clearSku} variant="secondary" />
        </Card>
      ) : null}

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Station location</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {LOCATION_PRESETS.map((preset) => (
            <Pressable
              key={preset}
              onPress={() => setLocation(preset)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: location === preset ? "#0D9488" : theme.colors.border,
                backgroundColor: location === preset ? "#0D9488" : theme.colors.surface,
              }}
            >
              <Text style={{ color: location === preset ? "#fff" : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{preset}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <ResultFlash visible={flashVisible} success title="TAG ASSIGNED" subtitle={message ?? undefined} />
    </View>
  );
}

function AuthorizationMode({ token, onSwitchMode }: { token: string; onSwitchMode: (mode: Mode) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [workflow, setWorkflow] = useState<OrderWorkflow | null>(null);
  const [gateLocation, setGateLocation] = useState("EXIT_MAIN");
  const [windowMinutes, setWindowMinutes] = useState(10);
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
      if (!selectedId && openOrders[0]) {
        setSelectedId(openOrders[0]._id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [selectedId, token]);

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
      setGateLocation(res.order.authorizationLocation || "EXIT_MAIN");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load order detail");
    }
  }, [selectedId, token]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

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
      setMessage("Units reserved for the selected order");
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
      setMessage(`Gate ${res.authorization.location} is open until ${new Date(res.authorization.expiresAt).toLocaleTimeString()}`);
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

    return (
      <View style={{ gap: 14 }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {message ? <Badge label={message} tone="success" /> : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Badge label={`Open ${orders.length}`} tone={orders.length > 0 ? "primary" : "default"} />
          <Badge label={`Gate ${gateLocation}`} tone="default" />
          <Badge label={`Window ${windowMinutes} min`} tone="warning" />
        </View>

        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Order queue</Text>

          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : orders.length === 0 ? (
            <MutedText>No open orders right now.</MutedText>
        ) : (
          <View style={{ gap: 8 }}>
            {orders.map((order) => (
              <Pressable
                key={order._id}
                onPress={() => setSelectedId(order._id)}
                style={{
                  borderWidth: 1,
                  borderColor: selectedId === order._id ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selectedId === order._id ? theme.colors.primarySoft : theme.colors.surface,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Order #{order._id.slice(-6)}</Text>
                  <Badge label={order.status} tone={toneForStatus(order.status)} />
                </View>
                <MutedText>{order.items.length} line{order.items.length === 1 ? "" : "s"}</MutedText>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

        {selectedOrder && workflow ? (
          <>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Gate control</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <Badge label={`Requested ${workflow.requestedUnits}`} />
                <Badge label={`Reserved ${workflow.reservedUnits}`} tone={workflow.reservedUnits >= workflow.requestedUnits ? "primary" : "warning"} />
                <Badge label={`Tagged ${workflow.taggedReservedUnits}`} tone={workflow.taggedReservedUnits > 0 ? "success" : "default"} />
                <Badge label={`Gate ready ${workflow.activeAuthorizations}`} tone={workflow.activeAuthorizations > 0 ? "warning" : "default"} />
              <Badge label={`Exited ${workflow.dispatchedUnits}`} tone={workflow.dispatchedUnits > 0 ? "success" : "default"} />
            </View>

            <View style={{ gap: 10 }}>
              {workflow.lines.map((line) => (
                <View
                  key={line.itemId}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.md,
                    padding: 12,
                    backgroundColor: theme.colors.surface2,
                    gap: 6,
                  }}
                >
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{line.name}</Text>
                  <MutedText>SKU: {line.sku}</MutedText>
                  <MutedText>
                    Need {line.requestedQuantity} | Reserved {line.reservedUnits} | Tagged {line.taggedReservedUnits} | Barcode fallback {line.barcodeFallbackUnits}
                  </MutedText>
                </View>
              ))}
            </View>

            <View style={{ height: 12 }} />
            <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Gate</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {GATE_PRESETS.map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => setGateLocation(preset)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: gateLocation === preset ? theme.colors.warning : theme.colors.border,
                    backgroundColor: gateLocation === preset ? theme.colors.warning : theme.colors.surface,
                  }}
                >
                  <Text style={{ color: gateLocation === preset ? "#fff" : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{preset}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ height: 12 }} />
            <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Authorization window</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {WINDOW_PRESETS.map((minutes) => (
                <Pressable
                  key={minutes}
                  onPress={() => setWindowMinutes(minutes)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: windowMinutes === minutes ? theme.colors.primary : theme.colors.border,
                    backgroundColor: windowMinutes === minutes ? theme.colors.primary : theme.colors.surface,
                  }}
                >
                  <Text style={{ color: windowMinutes === minutes ? "#0B0F17" : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{minutes} min</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ height: 12 }} />
            <View style={{ gap: 10 }}>
              {selectedOrder.status === "created" ? (
                <AppButton title="Reserve units for this order" onPress={() => void startPicking()} variant="secondary" disabled={saving} loading={saving} />
              ) : null}
              <AppButton title={selectedOrder.status === "authorized" ? "Refresh gate authorization" : "Authorize gate exit"} onPress={() => void authorizeExit()} disabled={saving} loading={saving} />
              {selectedOrder.status === "authorized" ? (
                <AppButton title="Go to Exit verification" onPress={() => onSwitchMode("exit")} variant="secondary" />
              ) : null}
            </View>
          </Card>
        </>
      ) : null}
    </View>
  );
}

function ExitMode({ token }: { token: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [gateLocation, setGateLocation] = useState("EXIT_MAIN");
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
    if (selectedOrderId && orders.some((order) => order._id === selectedOrderId)) return;
    if (!orders[0]) {
      setSelectedOrderId("");
      setSession(null);
      return;
    }
    setSelectedOrderId(orders[0]._id);
    setGateLocation(orders[0].authorizationLocation || "EXIT_MAIN");
  }, [orders, selectedOrderId]);

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
            minutes: 5,
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
    [gateLocation, loading, selectedOrderId, token]
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
        label: resolvedMode === "barcode" ? "Barcode fallback" : "RFID tag",
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

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Badge label={`Authorized ${orders.length}`} tone={orders.length > 0 ? "warning" : "default"} />
        <Badge label={`Gate ${gateLocation}`} tone="default" />
        <Badge label={session ? `Lane ${countdown}` : "Lane re-arming"} tone={session ? "success" : "default"} />
      </View>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Exit queue</Text>
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
                backgroundColor: selectedOrderId === order._id ? theme.colors.primarySoft : theme.colors.surface,
                borderRadius: theme.radius.md,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>Order #{order._id.slice(-6)}</Text>
                <Badge label={order.status} tone={toneForStatus(order.status)} />
              </View>
                <MutedText style={{ marginTop: 6 }}>
                  Gate {order.authorizationLocation || "-"} | Window {order.authorizationExpiresAt ? formatCountdown(order.authorizationExpiresAt) : "-"}
                </MutedText>
              </Pressable>
            ))}
          {orders.length === 0 ? <MutedText>No authorized orders are waiting for exit.</MutedText> : null}
        </View>

        <View style={{ height: 12 }} />
        <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Lane</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {GATE_PRESETS.map((preset) => (
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
                borderColor: gateLocation === preset ? theme.colors.warning : theme.colors.border,
                backgroundColor: gateLocation === preset ? theme.colors.warning : theme.colors.surface,
              }}
            >
              <Text style={{ color: gateLocation === preset ? "#fff" : theme.colors.textMuted, fontWeight: "700", fontSize: 12 }}>{preset}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ height: 12 }} />
        <AppButton title="Re-arm lane" onPress={() => void requestSession()} loading={loading} variant="secondary" />
      </Card>

      {session ? (
        <PassiveScanDock
          title="Exit lane armed"
          subtitle={`RFID and barcode scans are being verified automatically for ${session.location}.`}
          accentColor={theme.colors.warning}
          enabled
          busy={verifying || loading}
          lastCapture={lastCapture}
          statusLabel={`Valid ${countdown}`}
          onScan={(value) => void verifyScan(value)}
        />
      ) : null}

      {scanLog.length > 0 ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Exit log</Text>
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
                  backgroundColor: entry.authorized ? theme.colors.success + "11" : theme.colors.danger + "11",
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{entry.value}</Text>
                  <Badge label={entry.authorized ? "Allowed" : "Denied"} tone={entry.authorized ? "success" : "danger"} />
                </View>
                <MutedText>{entry.itemName ?? entry.decision}</MutedText>
                <MutedText>
                  {entry.mode === "tagId" ? "RFID" : "Barcode fallback"} | {entry.when.toLocaleTimeString()}
                </MutedText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <ResultFlash visible={flashVisible} success={flashSuccess} title={flashTitle} subtitle={flashSubtitle} />
    </View>
  );
}

function TagsMode({ token }: { token: string }) {
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
      {message ? <Badge label={message} tone="success" /> : null}

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Registry overview</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Badge label={`Total ${tags.length}`} tone="default" />
          <Badge label={`Active ${activeCount}`} tone={activeCount > 0 ? "success" : "default"} />
          <Badge label={`Inactive ${inactiveCount}`} tone={inactiveCount > 0 ? "warning" : "default"} />
          <Badge label={`Queued exits ${queuedExitCount}`} tone={queuedExitCount > 0 ? "warning" : "default"} />
        </View>
        <View style={{ height: 12 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["all", "active", "inactive"] as const).map((status) => (
            <Pressable
              key={status}
              onPress={() => setStatusFilter(status)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: statusFilter === status ? theme.colors.primary : theme.colors.border,
                backgroundColor: statusFilter === status ? theme.colors.primary : theme.colors.surface,
              }}
            >
              <Text style={{ color: statusFilter === status ? "#0B0F17" : theme.colors.textMuted, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>
                {status}
              </Text>
            </Pressable>
          ))}
          <AppButton title="Refresh" onPress={() => void loadTags()} variant="secondary" />
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tag registry</Text>
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
                  backgroundColor: selectedTagId === item.tagId ? theme.colors.primarySoft : theme.colors.surface,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  marginBottom: 8,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.tagId}</Text>
                  <Badge label={item.status} tone={toneForStatus(item.status)} />
                </View>
                <MutedText>{item.itemName || "Unassigned"}</MutedText>
                <MutedText>Pending exits: {item.activeExitAuthorizations ?? 0}</MutedText>
              </Pressable>
            )}
          />
        )}
      </Card>

      {selectedTag ? (
        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tag details</Text>
          <View style={{ gap: 8 }}>
            <Badge label={selectedTag.tagId} tone="primary" />
            <ListRow title="Assigned product" subtitle={selectedTag.itemName || "Unassigned"} />
            <ListRow title="SKU" subtitle={selectedTag.itemSku || "-"} />
            <ListRow title="Barcode" subtitle={selectedTag.itemBarcode || "-"} />
            <ListRow title="Active exit authorizations" subtitle={String(selectedTag.activeExitAuthorizations ?? 0)} />
            <ListRow title="Assigned at" subtitle={selectedTag.assignedAt ? new Date(selectedTag.assignedAt).toLocaleString() : "-"} />
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
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 8 }]}>Reassign tag</Text>
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
                  <MutedText>SKU: {item.sku}</MutedText>
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

export function RfidHubScreen() {
  const { token } = useContext(AuthContext);
  const [mode, setMode] = useState<Mode>("assign");

  if (!token) {
    return (
      <Screen title="RFID Hub" center>
        <MutedText>Sign in to use RFID operations.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen title="RFID Hub" scroll>
      <View style={{ gap: theme.spacing.md, paddingBottom: 40 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>RFID Control Center</Text>
              <MutedText>Autonomous station online</MutedText>
            </View>
            <Badge label="Live" tone="success" />
          </View>
          <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Badge label="Hands-free receive" tone="primary" />
            <Badge label="Auto exit verification" tone="warning" />
            <Badge label="Registry controls" tone="default" />
          </View>
        </Card>

        <ModeTabs mode={mode} onChange={setMode} />

        {mode === "assign" ? <ReceiveMode token={token} /> : null}
        {mode === "authorize" ? <AuthorizationMode token={token} onSwitchMode={setMode} /> : null}
        {mode === "exit" ? <ExitMode token={token} /> : null}
        {mode === "tags" ? <TagsMode token={token} /> : null}
      </View>
    </Screen>
  );
}
