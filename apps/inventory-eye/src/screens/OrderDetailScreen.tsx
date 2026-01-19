import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

type OrderStatus = "created" | "picking" | "fulfilled" | "cancelled";

type Order = {
  _id: string;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  fulfilledAt?: string | null;
  items: Array<{
    itemId: string;
    quantity: number;
    skuSnapshot?: string;
    nameSnapshot?: string;
  }>;
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrderDetail">;

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const canUpdateStatus = effectiveRole === "manager" || effectiveRole === "admin";
  const isClosed = order?.status === "fulfilled" || order?.status === "cancelled";

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<{ ok: true; order: Order }>(`/orders/${id}`, { method: "GET", token });
    setOrder(res.order);
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  const statusButtons = useMemo(() => {
    const s = order?.status;
    if (!s) return [] as Array<{ title: string; status: OrderStatus; variant?: "primary" | "secondary" | "danger" }>;
    if (s === "fulfilled" || s === "cancelled") return [] as Array<{ title: string; status: OrderStatus; variant?: "primary" | "secondary" | "danger" }>;

    const all: Array<{ title: string; status: OrderStatus; variant?: "primary" | "secondary" | "danger" }> = [
      { title: "Mark picking", status: "picking", variant: "secondary" },
      { title: "Mark fulfilled", status: "fulfilled", variant: "primary" },
      { title: "Cancel order", status: "cancelled", variant: "danger" },
    ];

    return all.filter((b) => b.status !== s);
  }, [order?.status]);

  async function updateStatus(status: OrderStatus) {
    if (!token || !canUpdateStatus || !order) return;
    if (savingStatus) return;

    setSavingStatus(true);
    setError(null);

    try {
      const res = await apiRequest<{ ok: true; order: Order }>(`/orders/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
      setOrder(res.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  }

  return (
    <Screen title="Order" scroll right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Order #{id.slice(-6)}</Text>
                  <MutedText style={{ marginTop: 6 }}>{order?._id ? `ID: ${order._id}` : "ID: -"}</MutedText>
                </View>
                <Badge
                  label={order?.status ?? "-"}
                  tone={order?.status === "fulfilled" ? "success" : order?.status === "cancelled" ? "danger" : "primary"}
                />
              </View>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <Badge label={`Created: ${order?.createdAt ? new Date(order.createdAt).toLocaleString() : "-"}`} />
                <Badge label={`Fulfilled: ${order?.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : "-"}`} />
              </View>
              {order?.notes ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Notes</Text>
                  <Text style={{ color: theme.colors.textMuted, marginTop: 6 }}>{order.notes}</Text>
                </View>
              ) : null}
            </Card>

            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Items</Text>
              {order?.items?.length ? (
                <View style={{ gap: 10 }}>
                  {order.items.map((it, idx) => (
                    <ListRow
                      key={`${it.itemId}-${idx}`}
                      title={it.nameSnapshot ?? it.skuSnapshot ?? it.itemId}
                      subtitle={`SKU: ${it.skuSnapshot ?? "-"}`}
                      right={<Badge label={`x${it.quantity}`} tone="default" />}
                    />
                  ))}
                </View>
              ) : (
                <MutedText>No items</MutedText>
              )}
            </Card>
          </View>

          <View style={{ width: 380, gap: theme.spacing.md }}>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <Badge label={canUpdateStatus ? "Manager/Admin" : "View-only"} tone={canUpdateStatus ? "primary" : "default"} />
              </View>

              {canUpdateStatus ? (
                <View style={{ marginTop: 12, gap: 10 }}>
                  {isClosed ? <MutedText>Order is closed.</MutedText> : null}
                  {!isClosed
                    ? statusButtons.map((b) => (
                        <AppButton
                          key={b.status}
                          title={b.title}
                          onPress={() => updateStatus(b.status)}
                          variant={b.variant}
                          disabled={savingStatus}
                          loading={savingStatus && b.status !== order?.status}
                        />
                      ))
                    : null}
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <MutedText>Status updates require manager/admin</MutedText>
                </View>
              )}
            </Card>
          </View>
        </View>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Order #{id.slice(-6)}</Text>
                <MutedText style={{ marginTop: 6 }}>{order?._id ? `ID: ${order._id}` : "ID: -"}</MutedText>
              </View>
              <Badge
                label={order?.status ?? "-"}
                tone={order?.status === "fulfilled" ? "success" : order?.status === "cancelled" ? "danger" : "primary"}
              />
            </View>

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Badge label={`Created: ${order?.createdAt ? new Date(order.createdAt).toLocaleString() : "-"}`} />
              <Badge label={`Fulfilled: ${order?.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : "-"}`} />
            </View>
            {order?.notes ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Notes</Text>
                <Text style={{ color: theme.colors.textMuted, marginTop: 6 }}>{order.notes}</Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Items</Text>
            {order?.items?.length ? (
              <View style={{ gap: 10 }}>
                {order.items.map((it, idx) => (
                  <ListRow
                    key={`${it.itemId}-${idx}`}
                    title={it.nameSnapshot ?? it.skuSnapshot ?? it.itemId}
                    subtitle={`SKU: ${it.skuSnapshot ?? "-"}`}
                    right={<Badge label={`x${it.quantity}`} tone="default" />}
                  />
                ))}
              </View>
            ) : (
              <MutedText>No items</MutedText>
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Badge label={canUpdateStatus ? "Manager/Admin" : "View-only"} tone={canUpdateStatus ? "primary" : "default"} />
            </View>

            {canUpdateStatus ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                {isClosed ? <MutedText>Order is closed.</MutedText> : null}
                {!isClosed
                  ? statusButtons.map((b) => (
                      <AppButton
                        key={b.status}
                        title={b.title}
                        onPress={() => updateStatus(b.status)}
                        variant={b.variant}
                        disabled={savingStatus}
                        loading={savingStatus && b.status !== order?.status}
                      />
                    ))
                  : null}
              </View>
            ) : (
              <View style={{ marginTop: 10 }}>
                <MutedText>Status updates require manager/admin</MutedText>
              </View>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
