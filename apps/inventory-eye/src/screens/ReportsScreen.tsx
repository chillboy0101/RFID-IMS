import React, { useCallback, useContext, useRef, useState } from "react";
import { Platform, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AUTO_REFRESH_PAUSE_MS, GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type StockLevelsReport = {
  ok: true;
  report: {
    totalItems: number;
    lowStockCount: number;
    expiringItemsCount: number;
    lowStockItems: Array<{ _id: string; name: string; sku: string; quantity: number; reorderLevel: number }>;
  };
};

type OrderFulfillmentReport = {
  ok: true;
  report: {
    totalOrders: number;
    fulfilledOrders: number;
    openOrders: number;
    avgFulfillmentSeconds: number | null;
    sampleSize: number;
  };
};

type Props = NativeStackScreenProps<MoreStackParamList, "Reports">;

export function ReportsScreen({ navigation }: Props) {
  const { token, user } = useContext(AuthContext);

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

  const [q, setQ] = useState("");
  const lastTypingAtRef = useRef(0);

  const [stock, setStock] = useState<StockLevelsReport | null>(null);
  const [fulfillment, setFulfillment] = useState<OrderFulfillmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);

  const canSeeFulfillment = user?.role === "manager" || user?.role === "admin";

  const lowStockFiltered = React.useMemo(() => {
    const items = stock?.report.lowStockItems ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => `${it._id} ${it.name} ${it.sku}`.toLowerCase().includes(t));
  }, [q, stock]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);

    const stockRes = await apiRequest<StockLevelsReport>("/reports/stock-levels", { method: "GET", token });
    setStock(stockRes);

    if (canSeeFulfillment) {
      const fulfRes = await apiRequest<OrderFulfillmentReport>("/reports/order-fulfillment", { method: "GET", token });
      setFulfillment(fulfRes);
    } else {
      setFulfillment(null);
    }
  }, [canSeeFulfillment, token]);

  const loadSafe = useCallback(
    async (showUpdating: boolean) => {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      if (showUpdating) setUpdating(true);
      try {
        await load();
      } finally {
        loadInFlightRef.current = false;
        if (showUpdating) setUpdating(false);
      }
    },
    [load]
  );

  useFocusEffect(
    useCallback(() => {
      loadSafe(true).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
      const id = setInterval(() => {
        if (Date.now() - lastTypingAtRef.current < AUTO_REFRESH_PAUSE_MS) return;
        loadSafe(true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [loadSafe])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadSafe(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      title="Reports"
      scroll
      busy={refreshing || updating}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  value={q}
                  onChangeText={(t) => {
                    lastTypingAtRef.current = Date.now();
                    setQ(t);
                  }}
                  placeholder="Search: item name or SKU"
                  autoCapitalize="none"
                />
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
                <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, alignItems: "center" }}>
                  <Badge label={`Total: ${stock?.report.totalItems ?? "-"}`} size="header" />
                  <Badge
                    label={`Low stock: ${stock?.report.lowStockCount ?? "-"}`}
                    tone={typeof stock?.report.lowStockCount === "number" && stock.report.lowStockCount > 0 ? "warning" : "default"}
                    size="header"
                  />
                  <Badge label={`With expiry: ${stock?.report.expiringItemsCount ?? "-"}`} size="header" />
                </View>
              </View>
            </View>

            {canSeeFulfillment ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Order fulfillment</Text>
                {fulfillment ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <Badge
                      label={`Open: ${fulfillment.report.openOrders}`}
                      tone={fulfillment.report.openOrders > 0 ? "warning" : "default"}
                      size="header"
                    />
                    <Badge label={`Fulfilled: ${fulfillment.report.fulfilledOrders}`} tone="success" size="header" />
                    <Badge label={`Avg(s): ${fulfillment.report.avgFulfillmentSeconds ?? "-"}`} size="header" />
                  </View>
                ) : (
                  <MutedText>Order fulfillment stats will appear once loaded.</MutedText>
                )}
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Low stock items</Text>
            {lowStockFiltered.length ? (
              <View style={{ gap: 10 }}>
                {lowStockFiltered.slice(0, 30).map((it) => (
                  <ListRow
                    key={it._id}
                    title={it.name}
                    subtitle={`SKU: ${it.sku}`}
                    meta={`Qty: ${it.quantity} / Reorder: ${it.reorderLevel}`}
                  />
                ))}
              </View>
            ) : (
              <MutedText>{q.trim() ? "No matching items" : "No low stock items"}</MutedText>
            )}
          </Card>

        </View>
      ) : (
        <>
          <Card>
            <TextField
              value={q}
              onChangeText={(t) => {
                lastTypingAtRef.current = Date.now();
                setQ(t);
              }}
              placeholder="Search: item name or SKU"
              autoCapitalize="none"
            />

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Badge label={`Total: ${stock?.report.totalItems ?? "-"}`} />
              <Badge
                label={`Low stock: ${stock?.report.lowStockCount ?? "-"}`}
                tone={typeof stock?.report.lowStockCount === "number" && stock.report.lowStockCount > 0 ? "warning" : "default"}
              />
              <Badge label={`With expiry: ${stock?.report.expiringItemsCount ?? "-"}`} />
            </View>

            <View style={{ height: 12 }} />

            <Text style={[theme.typography.label, { color: theme.colors.textMuted, marginBottom: 8 }]}>Order fulfillment</Text>
            {canSeeFulfillment ? (
              fulfillment ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <Badge label={`Open: ${fulfillment.report.openOrders}`} tone={fulfillment.report.openOrders > 0 ? "warning" : "default"} />
                  <Badge label={`Fulfilled: ${fulfillment.report.fulfilledOrders}`} tone="success" />
                  <Badge label={`Avg(s): ${fulfillment.report.avgFulfillmentSeconds ?? "-"}`} />
                </View>
              ) : (
                <MutedText>Loading...</MutedText>
              )
            ) : (
              <MutedText>Requires manager/admin</MutedText>
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Low stock items</Text>
            {lowStockFiltered.length ? (
              <View style={{ gap: 10 }}>
                {lowStockFiltered.slice(0, 20).map((it) => (
                  <ListRow
                    key={it._id}
                    title={it.name}
                    subtitle={`SKU: ${it.sku}`}
                    meta={`Qty: ${it.quantity} / Reorder: ${it.reorderLevel}`}
                  />
                ))}
              </View>
            ) : (
              <MutedText>{q.trim() ? "No matching items" : "No low stock items"}</MutedText>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
