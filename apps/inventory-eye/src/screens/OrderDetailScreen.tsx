import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

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

const GATE_PRESETS = ["EXIT_MAIN", "EXIT_LOADING_BAY", "EXIT_REAR"];
const WINDOW_PRESETS = [5, 10, 15];

function toneForStatus(status?: OrderStatus) {
  if (status === "fulfilled") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "authorized") return "warning" as const;
  if (status === "picking") return "primary" as const;
  return "default" as const;
}

export function OrderDetailScreen({ navigation, route }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

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

  const [order, setOrder] = useState<Order | null>(null);
  const [workflow, setWorkflow] = useState<OrderWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gateLocation, setGateLocation] = useState("EXIT_MAIN");
  const [windowMinutes, setWindowMinutes] = useState(10);

  const canUpdateStatus = effectiveRole === "manager" || effectiveRole === "admin";
  const isClosed = order?.status === "fulfilled" || order?.status === "cancelled";

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<OrderDetailResponse>(`/orders/${id}`, { method: "GET", token });
    setOrder(res.order);
    setWorkflow(res.workflow);
    setGateLocation(res.order.authorizationLocation || "EXIT_MAIN");
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  const actionSummary = useMemo(() => {
    if (!workflow) return [];
    return [
      { label: "Requested", value: workflow.requestedUnits, tone: "default" as const },
      { label: "Reserved", value: workflow.reservedUnits, tone: workflow.reservedUnits >= workflow.requestedUnits ? "primary" as const : "warning" as const },
      { label: "Gate Ready", value: workflow.activeAuthorizations, tone: workflow.activeAuthorizations > 0 ? "warning" as const : "default" as const },
      { label: "Exited", value: workflow.dispatchedUnits, tone: workflow.dispatchedUnits > 0 ? "success" as const : "default" as const },
    ];
  }, [workflow]);

  const stageSummary = useMemo(() => {
    if (!workflow) return [];
    return [
      {
        label: "1. Reserve units",
        value: `${workflow.reservedUnits}/${workflow.requestedUnits}`,
        tone: workflow.reservedUnits >= workflow.requestedUnits ? ("success" as const) : ("default" as const),
      },
      {
        label: "2. Gate authorization",
        value: String(workflow.activeAuthorizations),
        tone: workflow.activeAuthorizations > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: "3. Verified exit",
        value: `${workflow.dispatchedUnits}/${workflow.requestedUnits}`,
        tone: workflow.dispatchedUnits >= workflow.requestedUnits ? ("success" as const) : ("default" as const),
      },
    ];
  }, [workflow]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to authorize gate exit");
    } finally {
      setSaving(false);
    }
  }

  const actions = useMemo(() => {
    if (!order || isClosed) return [] as Array<{ title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" }>;

    const next: Array<{ title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" }> = [];

    if (order.status === "created") {
      next.push({ title: "Start picking", onPress: () => void updateStatus("picking"), variant: "secondary" });
    }

    if (order.status === "created" || order.status === "picking" || order.status === "authorized") {
      next.push({ title: order.status === "authorized" ? "Refresh gate authorization" : "Authorize gate exit", onPress: () => void authorizeExit(), variant: "primary" });
    }

    next.push({ title: "Cancel order", onPress: () => void updateStatus("cancelled"), variant: "danger" });
    return next;
  }, [authorizeExit, isClosed, order, updateStatus]);

  const content = (
    <>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Order #{id.slice(-6)}</Text>
            <MutedText style={{ marginTop: 6 }}>{order?._id ? `ID: ${order._id}` : "Loading..."}</MutedText>
          </View>
          <Badge label={order?.status ?? "-"} tone={toneForStatus(order?.status)} />
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {actionSummary.map((summary) => (
            <Badge key={summary.label} label={`${summary.label}: ${summary.value}`} tone={summary.tone} />
          ))}
        </View>

        <View style={{ height: 12 }} />
        <View style={{ gap: 8 }}>
          <ListRow title="Created" subtitle={order?.createdAt ? new Date(order.createdAt).toLocaleString() : "-"} />
          <ListRow title="Picking started" subtitle={order?.pickedAt ? new Date(order.pickedAt).toLocaleString() : "-"} />
          <ListRow title="Gate authorization" subtitle={order?.authorizedAt ? new Date(order.authorizedAt).toLocaleString() : "-"} />
          <ListRow title="Last verified exit scan" subtitle={order?.lastExitScanAt ? new Date(order.lastExitScanAt).toLocaleString() : "-"} />
          <ListRow title="Fulfilled" subtitle={order?.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : "-"} />
        </View>

        {order?.notes ? (
          <View style={{ marginTop: 12 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Notes</Text>
            <Text style={{ color: theme.colors.textMuted, marginTop: 6 }}>{order.notes}</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>RFID fulfillment stages</Text>
        <MutedText>This order should move through reserve, gate authorization, and verified exit in that order.</MutedText>
        <View style={{ marginTop: 12, gap: 10 }}>
          {stageSummary.map((stage) => (
            <ListRow key={stage.label} title={stage.label} subtitle={stage.value} right={<Badge label={stage.value} tone={stage.tone} />} />
          ))}
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Fulfillment lines</Text>
        {workflow?.lines?.length ? (
          <View style={{ gap: 10 }}>
            {workflow.lines.map((line) => (
              <View
                key={line.itemId}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  gap: 8,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <MutedText>SKU: {line.sku}</MutedText>
                  </View>
                  <Badge label={`x${line.requestedQuantity}`} />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Badge label={`Reserved ${line.reservedUnits}`} tone={line.reservedUnits >= line.requestedQuantity ? "primary" : "warning"} />
                  <Badge label={`Tagged ${line.taggedReservedUnits}`} tone={line.taggedReservedUnits > 0 ? "success" : "default"} />
                  <Badge label={`Barcode fallback ${line.barcodeFallbackUnits}`} tone={line.barcodeFallbackUnits > 0 ? "warning" : "default"} />
                  <Badge label={`Gate ready ${line.activeAuthorizations}`} tone={line.activeAuthorizations > 0 ? "warning" : "default"} />
                  <Badge label={`Exited ${line.dispatchedUnits}`} tone={line.dispatchedUnits > 0 ? "success" : "default"} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <MutedText>No line data available yet.</MutedText>
        )}
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Gate plan</Text>
        <MutedText>
          This is the handoff from order fulfillment to RFID exit control. Reserve the units first, then authorize the gate for a short window, and let verified scans close the order automatically.
        </MutedText>

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

        {order?.authorizationLocation || order?.authorizationExpiresAt ? (
          <View style={{ marginTop: 12, gap: 6 }}>
            <Badge label={`Active gate: ${order.authorizationLocation ?? "-"}`} tone="warning" />
            <MutedText>
              {order.authorizationExpiresAt ? `Current gate window ends ${new Date(order.authorizationExpiresAt).toLocaleString()}` : "No active gate window"}
            </MutedText>
          </View>
        ) : null}

        {order?.status === "authorized" ? (
          <View style={{ marginTop: 12 }}>
            <MutedText>Use the RFID Hub exit step to verify each tag or barcode as it leaves the gate. Those verified scans will move stock out and finish the order.</MutedText>
          </View>
        ) : null}
      </Card>
    </>
  );

  return (
    <Screen title="Order" scroll right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />} busy={loading}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>{content}</View>
          <View style={{ width: 380, gap: theme.spacing.md }}>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>
              <Badge label={canUpdateStatus ? "Manager/Admin" : "View-only"} tone={canUpdateStatus ? "primary" : "default"} />

              {canUpdateStatus ? (
                <View style={{ marginTop: 12, gap: 10 }}>
                  {isClosed ? <MutedText>Order is closed.</MutedText> : null}
                  {!isClosed
                    ? actions.map((action) => (
                        <AppButton
                          key={action.title}
                          title={action.title}
                          onPress={action.onPress}
                          variant={action.variant}
                          disabled={saving}
                          loading={saving}
                        />
                      ))
                    : null}
                  <AppButton
                    title="Open RFID Hub"
                    onPress={() => {
                      const parent = navigation.getParent();
                      (parent as any)?.navigate?.("More", { screen: "RfidHub" });
                    }}
                    variant="secondary"
                  />
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <MutedText>Status updates require manager/admin.</MutedText>
                </View>
              )}
            </Card>
          </View>
        </View>
      ) : (
        <>
          {content}

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>
            <Badge label={canUpdateStatus ? "Manager/Admin" : "View-only"} tone={canUpdateStatus ? "primary" : "default"} />

            {canUpdateStatus ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                {isClosed ? <MutedText>Order is closed.</MutedText> : null}
                {!isClosed
                  ? actions.map((action) => (
                      <AppButton
                        key={action.title}
                        title={action.title}
                        onPress={action.onPress}
                        variant={action.variant}
                        disabled={saving}
                        loading={saving}
                      />
                    ))
                  : null}
                <AppButton
                  title="Open RFID Hub"
                  onPress={() => {
                    const parent = navigation.getParent();
                    (parent as any)?.navigate?.("More", { screen: "RfidHub" });
                  }}
                  variant="secondary"
                />
              </View>
            ) : (
              <View style={{ marginTop: 10 }}>
                <MutedText>Status updates require manager/admin.</MutedText>
              </View>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
