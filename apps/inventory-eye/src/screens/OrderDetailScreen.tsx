import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, shadow, theme } from "../ui";

type OrderStatus = "created" | "picking" | "authorized" | "fulfilled" | "cancelled";

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
  pickedAt?: string | null;
  authorizedAt?: string | null;
  authorizationLocation?: string | null;
  authorizationExpiresAt?: string | null;
  lastExitScanAt?: string | null;
  fulfilledAt?: string | null;
  items: Array<{
    itemId: string;
    quantity: number;
    skuSnapshot?: string;
    nameSnapshot?: string;
  }>;
};

type OrderDetailResponse = {
  ok: true;
  order: Order;
  workflow: OrderWorkflow;
};

type AuthorizeResponse = {
  ok: true;
  order: Order;
  workflow: OrderWorkflow;
  authorization: {
    location: string;
    expiresAt: string;
  };
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrderDetail">;

const GATE_PRESETS = ["EXIT_MAIN", "EXIT_LOADING_BAY", "EXIT_REAR"] as const;
const WINDOW_PRESETS = [5, 10, 15] as const;
const DESKTOP_LINE_QTY_WIDTH = 60;
const DESKTOP_LINE_PROGRESS_WIDTH = 184;
const DESKTOP_LINE_STATE_WIDTH = 170;

function toneForStatus(status?: OrderStatus) {
  if (status === "fulfilled") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "authorized") return "warning" as const;
  if (status === "picking") return "primary" as const;
  return "default" as const;
}

function formatStatusLabel(status?: OrderStatus) {
  if (!status) return "-";
  if (status === "picking") return "In progress";
  if (status === "authorized") return "Authorized";
  if (status === "fulfilled") return "Exited";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatGateLabel(value?: string | null) {
  if (!value) return "-";
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function PulseDot({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      {active ? (
        <Animated.View
          style={{
            position: "absolute",
            width: 12,
            height: 12,
            borderRadius: 999,
            backgroundColor: "rgba(34, 197, 94, 0.22)",
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.9],
                }),
              },
            ],
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.45, 0],
            }),
          }}
        />
      ) : null}
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: active ? theme.colors.success : theme.colors.border,
        }}
      />
    </View>
  );
}

function SectionLabel({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: 13,
          fontWeight: "800",
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {right}
    </View>
  );
}

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  getLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (value: T) => string;
}) {
  return (
    <View
      style={{
        minHeight: 46,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 14,
        backgroundColor: theme.colors.surface2,
        overflow: "hidden",
        flexDirection: "row",
      }}
    >
      {options.map((option, index) => {
        const active = option === value;
        return (
          <Pressable
            key={String(option)}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 46,
              alignItems: "center",
              justifyContent: "center",
              borderLeftWidth: index === 0 ? 0 : 1,
              borderLeftColor: theme.colors.border,
              backgroundColor: active ? theme.colors.surface : pressed ? theme.colors.surface : theme.colors.surface2,
            })}
          >
            <Text
              style={{
                color: active ? theme.colors.text : theme.colors.textMuted,
                fontWeight: active ? "800" : "700",
              }}
              numberOfLines={1}
            >
              {getLabel(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MetaRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        style={[
          theme.typography.body,
          {
            color: accent ? theme.colors.success : theme.colors.text,
            fontWeight: accent ? "800" : "600",
            textAlign: "right",
            flexShrink: 1,
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function MenuAction({
  label,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 42,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: pressed && !disabled ? theme.colors.surface2 : theme.colors.surface,
        opacity: disabled ? 0.45 : 1,
        ...(Platform.OS === "web" && !disabled ? ({ cursor: "pointer" } as any) : null),
      })}
    >
      <Text style={{ color: danger ? theme.colors.danger : theme.colors.text, fontWeight: "800" }}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={danger ? theme.colors.danger : theme.colors.textMuted} />
    </Pressable>
  );
}

function buildTagDots(line: OrderWorkflowLine) {
  const readyUnits = Math.min(line.requestedQuantity, line.taggedReservedUnits + line.barcodeFallbackUnits + line.dispatchedUnits);
  const dotCount = Math.max(1, Math.min(line.requestedQuantity, 8));
  const filledDots = Math.round((readyUnits / Math.max(1, line.requestedQuantity)) * dotCount);

  return Array.from({ length: dotCount }).map((_, index) => {
    const filled = index < filledDots;
    return (
      <View
        key={`${line.itemId}-${index}`}
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: filled ? theme.colors.success : theme.colors.surface2,
          borderWidth: 1,
          borderColor: filled ? "rgba(34, 197, 94, 0.22)" : theme.colors.border,
        }}
      />
    );
  });
}

export function OrderDetailScreen({ navigation, route }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 1100;

  const [order, setOrder] = useState<Order | null>(null);
  const [workflow, setWorkflow] = useState<OrderWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gateLocation, setGateLocation] = useState<(typeof GATE_PRESETS)[number]>("EXIT_MAIN");
  const [windowMinutes, setWindowMinutes] = useState<(typeof WINDOW_PRESETS)[number]>(10);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  const canUpdateStatus = effectiveRole === "manager" || effectiveRole === "admin";
  const isClosed = order?.status === "fulfilled" || order?.status === "cancelled";

  const openRfidHub = useCallback(() => {
    const parent = navigation.getParent();
    (parent as any)?.navigate?.("More", { screen: "RfidHub" });
  }, [navigation]);

  const onBack = useCallback(() => {
    if (isDesktopWeb) {
      navigation.navigate("OrdersList");
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("OrdersList");
  }, [isDesktopWeb, navigation]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<OrderDetailResponse>(`/orders/${id}`, { method: "GET", token });
    setOrder(res.order);
    setWorkflow(res.workflow);
    setGateLocation((res.order.authorizationLocation as (typeof GATE_PRESETS)[number]) || "EXIT_MAIN");
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  async function refreshAfterAction(loader: Promise<OrderDetailResponse | AuthorizeResponse>) {
    const res = await loader;
    setOrder(res.order);
    setWorkflow(res.workflow);
  }

  async function updateStatus(status: Exclude<OrderStatus, "authorized">) {
    if (!token || !canUpdateStatus || !order || saving) return;
    setSaving(true);
    setError(null);
    try {
      await refreshAfterAction(
        apiRequest<OrderDetailResponse>(`/orders/${id}/status`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ status }),
        })
      );
      setActionMenuOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update order");
    } finally {
      setSaving(false);
    }
  }

  async function authorizeExit() {
    if (!token || !canUpdateStatus || !order || saving) return;
    setSaving(true);
    setError(null);
    try {
      await refreshAfterAction(
        apiRequest<AuthorizeResponse>(`/orders/${id}/authorize-exit`, {
          method: "POST",
          token,
          body: JSON.stringify({ location: gateLocation, minutes: windowMinutes }),
        })
      );
      setActionMenuOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to authorize gate exit");
    } finally {
      setSaving(false);
    }
  }

  const taggedProgressUnits = useMemo(
    () => (workflow ? workflow.taggedReservedUnits + workflow.dispatchedUnits : 0),
    [workflow]
  );

  const gateReadyUnits = useMemo(
    () => (workflow ? Math.min(workflow.requestedUnits, workflow.taggedReservedUnits + workflow.barcodeFallbackUnits + workflow.dispatchedUnits) : 0),
    [workflow]
  );

  const currentStepIndex = useMemo(() => {
    if (!order) return 0;
    if (order.status === "fulfilled") return 3;
    if (order.status === "authorized" || !!order.authorizedAt || (workflow?.dispatchedUnits ?? 0) > 0) return 2;
    if (order.status === "picking" || !!order.pickedAt) return 1;
    return 0;
  }, [order, workflow?.dispatchedUnits]);

  const actions = order && !isClosed
    ? [
        ...(order.status === "created"
          ? [{ title: "Start picking", onPress: () => void updateStatus("picking"), variant: "secondary" as const }]
          : []),
        ...(order.status === "created" || order.status === "picking" || order.status === "authorized"
          ? [
              {
                title: order.status === "authorized" ? "Refresh gate authorization" : "Authorize gate exit",
                onPress: () => void authorizeExit(),
                variant: "primary" as const,
              },
            ]
          : []),
        { title: "Cancel order", onPress: () => void updateStatus("cancelled"), variant: "danger" as const },
      ]
    : [];

  const runMenuAction = (action: () => void) => {
    setActionMenuOpen(false);
    action();
  };

  const actionMenu = actionMenuOpen ? (
    <>
      <Pressable
        accessible={false}
        onPress={() => setActionMenuOpen(false)}
        style={{
          position: "absolute",
          top: 0,
          left: -4000,
          right: -4000,
          bottom: -4000,
          zIndex: 9999,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: isDesktopWeb ? 66 : 128,
          right: theme.spacing.md,
          left: isDesktopWeb ? undefined : theme.spacing.md,
          width: isDesktopWeb ? 240 : undefined,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          overflow: "hidden",
          zIndex: 10000,
          elevation: 40,
          ...shadow(2),
        }}
      >
        {canUpdateStatus ? (
          isClosed ? (
            <MenuAction label="Order is closed" disabled onPress={() => undefined} />
          ) : (
            actions.map((action) => (
              <MenuAction
                key={action.title}
                label={action.title}
                danger={action.variant === "danger"}
                disabled={saving}
                onPress={() => runMenuAction(action.onPress)}
              />
            ))
          )
        ) : (
          <MenuAction label="View only" disabled onPress={() => undefined} />
        )}
      </View>
    </>
  ) : null;

  const overviewHeader = (
    <Card style={{ padding: 0, overflow: "visible", zIndex: actionMenuOpen ? 20 : 1 }}>
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Text style={[theme.typography.title, { color: theme.colors.text }]} numberOfLines={1}>
              {`Order #${id.slice(-6)}`}
            </Text>
            <Badge label={formatStatusLabel(order?.status)} tone={toneForStatus(order?.status)} size="header" responsive={false} />
            {workflow ? (
              <Badge
                label={`${taggedProgressUnits}/${workflow.requestedUnits} tagged`}
                tone={taggedProgressUnits > 0 ? "success" : "default"}
                size="header"
                responsive={false}
              />
            ) : null}
          </View>
          <MutedText style={{ marginTop: 8 }}>
            {order ? `${order._id} | Created ${formatDateTime(order.createdAt)}` : "Loading order details..."}
          </MutedText>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <AppButton
            title="Open RFID Hub"
            onPress={() => {
              setActionMenuOpen(false);
              openRfidHub();
            }}
            variant="secondary"
            iconName="radio-outline"
          />
          <AppButton
            title="More"
            onPress={() => setActionMenuOpen((current) => !current)}
            variant="secondary"
            iconName="ellipsis-horizontal"
            iconOnly
          />
        </View>
      </View>

      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingBottom: theme.spacing.md,
          flexDirection: "row",
          alignItems: "center",
          gap: 0,
        }}
      >
        {["Created", "Picking", "Authorized", "Exited"].map((label, index, arr) => {
          const active = order?.status !== "cancelled" && index === currentStepIndex;
          const complete = index < currentStepIndex || (index === 3 && order?.status === "fulfilled");
          const bg = complete ? "rgba(34, 197, 94, 0.16)" : active ? theme.colors.primarySoft : theme.colors.surface2;
          const fg = complete ? theme.colors.success : active ? theme.colors.text : theme.colors.textMuted;

          return (
            <React.Fragment key={label}>
              <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: bg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {complete ? (
                    <Ionicons name="checkmark" size={18} color={fg} />
                  ) : active ? (
                    <Ionicons name="arrow-forward" size={18} color={fg} />
                  ) : (
                    <Text style={{ color: fg, fontWeight: "800" }}>{index + 1}</Text>
                  )}
                </View>
                <Text
                  style={{
                    marginTop: 8,
                    color: active || complete ? theme.colors.text : theme.colors.textMuted,
                    fontWeight: active ? "800" : "700",
                    fontSize: 13,
                  }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </View>
              {index < arr.length - 1 ? (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    marginHorizontal: 10,
                    marginBottom: 24,
                    backgroundColor: index < currentStepIndex ? theme.colors.success : theme.colors.border,
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      {order?.status === "cancelled" ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 12,
            backgroundColor: "rgba(239, 68, 68, 0.06)",
          }}
        >
          <ErrorText>This order is cancelled. Exit verification is no longer active.</ErrorText>
        </View>
      ) : null}

      {actionMenu}
    </Card>
  );

  const linesSection = (
    <>
      <SectionLabel
        label="Fulfillment lines"
        right={
          workflow ? (
            <Text style={[theme.typography.label, { color: gateReadyUnits >= workflow.requestedUnits ? theme.colors.success : theme.colors.textMuted }]}>
              {`${gateReadyUnits}/${workflow.requestedUnits} gate-ready`}
            </Text>
          ) : null
        }
      />

      {workflow?.lines?.length ? (
        <>
          {isDesktopWeb ? (
            <>
              <View
                style={{
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                    Item
                  </Text>
                </View>
                <View style={{ width: DESKTOP_LINE_QTY_WIDTH, flexShrink: 0 }}>
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted, textAlign: "right" }]}>Qty</Text>
                </View>
                <View style={{ width: DESKTOP_LINE_PROGRESS_WIDTH, flexShrink: 0 }}>
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Progress</Text>
                </View>
                <View style={{ width: DESKTOP_LINE_STATE_WIDTH, flexShrink: 0 }}>
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Tag status</Text>
                </View>
              </View>

              <View style={{ paddingBottom: 8 }}>
                {workflow.lines.map((line, index) => {
                  const taggedUnits = Math.min(line.requestedQuantity, line.taggedReservedUnits + line.dispatchedUnits);
                  const readyUnits = Math.min(line.requestedQuantity, line.taggedReservedUnits + line.barcodeFallbackUnits + line.dispatchedUnits);
                  const progressRatio = taggedUnits / Math.max(1, line.requestedQuantity);
                  const lineReady = readyUnits >= line.requestedQuantity;
                  const gateLive = line.activeAuthorizations > 0;
                  const exited = line.dispatchedUnits >= line.requestedQuantity;
                  const stateLabel = exited
                    ? "Exited"
                    : gateLive
                      ? `${line.activeAuthorizations} gate live`
                      : lineReady
                        ? "Ready to authorize"
                        : `${Math.max(0, line.requestedQuantity - readyUnits)} pending`;

                  return (
                    <View
                      key={line.itemId}
                      style={{
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: 14,
                        borderBottomWidth: index === workflow.lines.length - 1 ? 0 : 1,
                        borderBottomColor: theme.colors.border,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={2}>
                          {line.name}
                        </Text>
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                          {line.sku}
                        </Text>
                      </View>

                      <View style={{ width: DESKTOP_LINE_QTY_WIDTH, flexShrink: 0 }}>
                        <Text style={{ color: theme.colors.text, textAlign: "right", fontWeight: "800", fontSize: 20 }}>
                          {line.requestedQuantity}
                        </Text>
                      </View>

                      <View style={{ width: DESKTOP_LINE_PROGRESS_WIDTH, flexShrink: 0, gap: 8 }}>
                        <View
                          style={{
                            height: 8,
                            borderRadius: 999,
                            backgroundColor: theme.colors.surface2,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              width: `${Math.max(6, progressRatio * 100)}%`,
                              height: "100%",
                              borderRadius: 999,
                              backgroundColor: theme.colors.success,
                            }}
                          />
                        </View>
                        <Text style={[theme.typography.body, { color: theme.colors.text }]}>{`${taggedUnits}/${line.requestedQuantity} tagged`}</Text>
                        {line.barcodeFallbackUnits > 0 ? (
                          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{`+${line.barcodeFallbackUnits} barcode fallback`}</Text>
                        ) : null}
                      </View>

                      <View style={{ width: DESKTOP_LINE_STATE_WIDTH, flexShrink: 0, gap: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{buildTagDots(line)}</View>
                          <PulseDot active={lineReady && !exited} />
                        </View>
                        <Text
                          style={[
                            theme.typography.caption,
                            { color: lineReady || gateLive || exited ? theme.colors.text : theme.colors.textMuted },
                          ]}
                        >
                          {stateLabel}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={{ padding: theme.spacing.md, gap: 12 }}>
              {workflow.lines.map((line) => {
                const taggedUnits = Math.min(line.requestedQuantity, line.taggedReservedUnits + line.dispatchedUnits);
                const readyUnits = Math.min(line.requestedQuantity, line.taggedReservedUnits + line.barcodeFallbackUnits + line.dispatchedUnits);
                const progressRatio = taggedUnits / Math.max(1, line.requestedQuantity);
                const lineReady = readyUnits >= line.requestedQuantity;
                const exited = line.dispatchedUnits >= line.requestedQuantity;

                return (
                  <View
                    key={line.itemId}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.sm,
                      padding: 12,
                      gap: 12,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={2}>
                          {line.name}
                        </Text>
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                          {line.sku}
                        </Text>
                      </View>
                      <Badge label={`Qty ${line.requestedQuantity}`} tone="default" />
                    </View>

                    <View
                      style={{
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: theme.colors.surface2,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.max(6, progressRatio * 100)}%`,
                          height: "100%",
                          borderRadius: 999,
                          backgroundColor: theme.colors.success,
                        }}
                      />
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <View>
                        <Text style={[theme.typography.body, { color: theme.colors.text }]}>{`${taggedUnits}/${line.requestedQuantity} tagged`}</Text>
                        <MutedText>
                          {exited
                            ? "Exited"
                            : line.activeAuthorizations > 0
                              ? `${line.activeAuthorizations} gate live`
                              : lineReady
                                ? "Ready to authorize"
                                : `${Math.max(0, line.requestedQuantity - readyUnits)} pending`}
                        </MutedText>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{buildTagDots(line)}</View>
                        <PulseDot active={lineReady && !exited} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <View style={{ padding: theme.spacing.md }}>
          <MutedText>No line data available yet.</MutedText>
        </View>
      )}
    </>
  );

  const sidebarContent = (
    <Card style={{ padding: 0, minHeight: 0 }}>
      <SectionLabel label="Gate plan" />
      <View style={{ padding: theme.spacing.md, gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Gate</Text>
          <SegmentedControl
            options={GATE_PRESETS}
            value={gateLocation}
            onChange={setGateLocation}
            getLabel={(value) => formatGateLabel(value)}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Time window</Text>
          <SegmentedControl
            options={WINDOW_PRESETS}
            value={windowMinutes}
            onChange={setWindowMinutes}
            getLabel={(value) => `${value} min`}
          />
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surface2,
            padding: 12,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.textMuted} />
          <MutedText style={{ flex: 1 }}>
            Reserve first, authorize the gate for a short window, then let RFID verification close the order.
          </MutedText>
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingTop: 18,
            gap: 14,
          }}
        >
          <Text
            style={{
              color: theme.colors.textMuted,
              fontSize: 13,
              fontWeight: "800",
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            Order meta
          </Text>

          <MetaRow label="Created" value={formatDateTime(order?.createdAt)} />
          <MetaRow
            label="Gate"
            value={order?.authorizationLocation ? formatGateLabel(order.authorizationLocation) : formatGateLabel(gateLocation)}
          />
          <MetaRow
            label="Window"
            value={order?.authorizationExpiresAt ? `Ends ${formatDateTime(order.authorizationExpiresAt)}` : `${windowMinutes} min preset`}
          />
          <MetaRow label="Items" value={`${order?.items.length ?? 0} lines`} />
          <MetaRow label="Units" value={`${workflow?.requestedUnits ?? 0} total`} />
          <MetaRow
            label="Tagged"
            value={workflow ? `${taggedProgressUnits}/${workflow.requestedUnits}` : "-"}
            accent={!!workflow && taggedProgressUnits > 0}
          />
          {workflow?.barcodeFallbackUnits ? (
            <MetaRow label="Fallback" value={`${workflow.barcodeFallbackUnits} barcode-ready`} />
          ) : null}
        </View>

        {order?.notes ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              paddingTop: 18,
              gap: 8,
            }}
          >
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: 13,
                fontWeight: "800",
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              Notes
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.text }]}>{order.notes}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );

  const desktopBody = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      {overviewHeader}
      <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
        <Card style={{ flex: 1, padding: 0, minHeight: 0 }}>
          {linesSection}
        </Card>
        <View style={{ width: 326, minHeight: 0 }}>{sidebarContent}</View>
      </View>
    </ScrollView>
  );

  const mobileBody = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        gap: theme.spacing.md,
        paddingBottom: theme.spacing.xl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {overviewHeader}

      <Card style={{ padding: 0 }}>
        {linesSection}
      </Card>

      {sidebarContent}
    </ScrollView>
  );

  return (
    <Screen
      title="Order detail"
      scroll={false}
      busy={loading}
      tabBarPadding={isDesktopWeb}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}
      {isDesktopWeb ? desktopBody : mobileBody}
    </Screen>
  );
}
