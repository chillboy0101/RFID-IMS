import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AUTO_REFRESH_PAUSE_MS, GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type AlertsResponse = {
  ok: true;
  alerts: {
    lowStock: { count: number; items: Array<{ _id: string; name: string; sku: string; quantity: number; reorderLevel: number }> };
    expiringSoon: {
      count: number;
      expiryDays: number;
      items: Array<{ _id: string; name: string; sku: string; expiryDate?: string | null }>;
    };
    unusualMovements: {
      count: number;
      movementHours: number;
      movementDelta: number;
      logs: Array<{ _id: string; action?: string; delta?: number; reason?: string; createdAt?: string }>;
    };
  };
};

type Props = NativeStackScreenProps<MoreStackParamList, "Alerts">;

export function AlertsScreen({ navigation }: Props) {
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

  const [expiryDays, setExpiryDays] = useState("30");
  const [movementHours, setMovementHours] = useState("24");
  const [movementDelta, setMovementDelta] = useState("50");
  const [q, setQ] = useState("");
  const lastTypingAtRef = useRef(0);

  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);

  const url = useMemo(() => {
    const e = Number(expiryDays) || 30;
    const h = Number(movementHours) || 24;
    const d = Number(movementDelta) || 50;
    return `/alerts/list?expiryDays=${encodeURIComponent(String(e))}&movementHours=${encodeURIComponent(String(h))}&movementDelta=${encodeURIComponent(String(d))}`;
  }, [expiryDays, movementHours, movementDelta]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<AlertsResponse>(url, { method: "GET", token });
    setData(res);
  }, [token, url]);

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

  useEffect(() => {
    const id = setTimeout(() => {
      loadSafe(true).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    }, 600);

    return () => clearTimeout(id);
  }, [loadSafe, url]);

  const lowStockFiltered = useMemo(() => {
    const items = data?.alerts.lowStock.items ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => `${it._id} ${it.name} ${it.sku}`.toLowerCase().includes(t));
  }, [data, q]);

  const expiringFiltered = useMemo(() => {
    const items = data?.alerts.expiringSoon.items ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => `${it._id} ${it.name} ${it.sku}`.toLowerCase().includes(t));
  }, [data, q]);

  const movementFiltered = useMemo(() => {
    const logs = data?.alerts.unusualMovements.logs ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return logs;
    return logs.filter((l) => `${l._id} ${l.action ?? ""} ${l.reason ?? ""} ${String(l.delta ?? "")}`.toLowerCase().includes(t));
  }, [data, q]);

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
      title="Alerts"
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
                  placeholder="Search: item name, SKU, log reason"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
                <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                  <Badge
                    label={`Low: ${String(data?.alerts.lowStock.count ?? "-")}`}
                    tone={typeof data?.alerts.lowStock.count === "number" && data.alerts.lowStock.count > 0 ? "warning" : "default"}
                    size="header"
                  />
                  <Badge
                    label={`Exp: ${String(data?.alerts.expiringSoon.count ?? "-")}`}
                    tone={typeof data?.alerts.expiringSoon.count === "number" && data.alerts.expiringSoon.count > 0 ? "warning" : "default"}
                    size="header"
                  />
                  <Badge
                    label={`Move: ${String(data?.alerts.unusualMovements.count ?? "-")}`}
                    tone={typeof data?.alerts.unusualMovements.count === "number" && data.alerts.unusualMovements.count > 0 ? "warning" : "default"}
                    size="header"
                  />
                </View>
              </View>
            </View>

            <MutedText style={{ marginTop: 8 }}>Tip: thresholds apply automatically. Updates in the background.</MutedText>

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <TextField label="Expiry (days)" value={expiryDays} onChangeText={setExpiryDays} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1, minWidth: 220 }}>
                <TextField label="Movement (hours)" value={movementHours} onChangeText={setMovementHours} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1, minWidth: 220 }}>
                <TextField label="Movement delta" value={movementDelta} onChangeText={setMovementDelta} keyboardType="numeric" />
              </View>
            </View>
          </Card>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md }}>
            <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 320 }}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Low stock</Text>
                  <Badge
                    label={String(data?.alerts.lowStock.count ?? "-")}
                    tone={typeof data?.alerts.lowStock.count === "number" && data.alerts.lowStock.count > 0 ? "warning" : "default"}
                  />
                </View>
                <MutedText style={{ marginTop: 8 }}>Items below reorder level</MutedText>

                <View style={{ height: 12 }} />
                {lowStockFiltered.length ? (
                  <View style={{ gap: 10 }}>
                    {lowStockFiltered.slice(0, 8).map((it) => (
                      <ListRow key={it._id} title={it.name} subtitle={`SKU: ${it.sku}`} meta={`Qty: ${it.quantity} / Reorder: ${it.reorderLevel}`} />
                    ))}
                  </View>
                ) : (
                  <MutedText>{q.trim() ? "No matching low stock items" : "No low stock items"}</MutedText>
                )}
              </Card>
            </View>

            <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 320 }}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Expiring soon</Text>
                  <Badge
                    label={String(data?.alerts.expiringSoon.count ?? "-")}
                    tone={typeof data?.alerts.expiringSoon.count === "number" && data.alerts.expiringSoon.count > 0 ? "warning" : "default"}
                  />
                </View>
                <MutedText style={{ marginTop: 8 }}>Within {data?.alerts.expiringSoon.expiryDays ?? "-"} days</MutedText>

                <View style={{ height: 12 }} />
                {expiringFiltered.length ? (
                  <View style={{ gap: 10 }}>
                    {expiringFiltered.slice(0, 8).map((it) => (
                      <ListRow key={it._id} title={it.name} subtitle={`SKU: ${it.sku}`} meta={it.expiryDate ? new Date(it.expiryDate).toLocaleDateString() : "-"} />
                    ))}
                  </View>
                ) : (
                  <MutedText>{q.trim() ? "No matching expiring items" : "No expiring items"}</MutedText>
                )}
              </Card>
            </View>

            <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 320 }}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Unusual movements</Text>
                  <Badge
                    label={String(data?.alerts.unusualMovements.count ?? "-")}
                    tone={typeof data?.alerts.unusualMovements.count === "number" && data.alerts.unusualMovements.count > 0 ? "warning" : "default"}
                  />
                </View>
                <MutedText style={{ marginTop: 8 }}>
                  Last {data?.alerts.unusualMovements.movementHours ?? "-"}h, delta ≥ {data?.alerts.unusualMovements.movementDelta ?? "-"}
                </MutedText>

                <View style={{ height: 12 }} />
                {movementFiltered.length ? (
                  <View style={{ gap: 10 }}>
                    {movementFiltered.slice(0, 8).map((l) => (
                      <ListRow
                        key={l._id}
                        title={`Delta: ${typeof l.delta === "number" ? l.delta : "-"}`}
                        subtitle={`Action: ${l.action ?? "-"}${l.reason ? `\nReason: ${l.reason}` : ""}`}
                        meta={l.createdAt ? new Date(l.createdAt).toLocaleString() : "-"}
                      />
                    ))}
                  </View>
                ) : (
                  <MutedText>{q.trim() ? "No matching movement logs" : "No unusual movements"}</MutedText>
                )}
              </Card>
            </View>
          </View>
        </View>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Settings</Text>
            </View>
            <MutedText style={{ marginTop: 8 }}>Updates run automatically in the background.</MutedText>
            <View style={{ height: 12 }} />

            <TextField
              label="Search results"
              value={q}
              onChangeText={(t) => {
                lastTypingAtRef.current = Date.now();
                setQ(t);
              }}
              placeholder="Item name, SKU, log reason"
              autoCapitalize="none"
            />
            <View style={{ height: 12 }} />

            <TextField
              label="Expiry days"
              value={expiryDays}
              onChangeText={(t) => {
                lastTypingAtRef.current = Date.now();
                setExpiryDays(t);
              }}
              keyboardType="numeric"
            />
            <View style={{ height: 12 }} />
            <TextField
              label="Movement hours"
              value={movementHours}
              onChangeText={(t) => {
                lastTypingAtRef.current = Date.now();
                setMovementHours(t);
              }}
              keyboardType="numeric"
            />
            <View style={{ height: 12 }} />
            <TextField
              label="Movement delta"
              value={movementDelta}
              onChangeText={(t) => {
                lastTypingAtRef.current = Date.now();
                setMovementDelta(t);
              }}
              keyboardType="numeric"
            />
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Low stock</Text>
              <Badge
                label={String(data?.alerts.lowStock.count ?? "-")}
                tone={typeof data?.alerts.lowStock.count === "number" && data.alerts.lowStock.count > 0 ? "warning" : "default"}
              />
            </View>
            <MutedText style={{ marginTop: 8 }}>Items below reorder level</MutedText>

            <View style={{ height: 12 }} />
            {lowStockFiltered.length ? (
              <View style={{ gap: 10 }}>
                {lowStockFiltered.slice(0, 10).map((it) => (
                  <ListRow key={it._id} title={it.name} subtitle={`SKU: ${it.sku}`} meta={`Qty: ${it.quantity} / Reorder: ${it.reorderLevel}`} />
                ))}
              </View>
            ) : (
              <MutedText>{q.trim() ? "No matching low stock items" : "No low stock items"}</MutedText>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Expiring soon</Text>
              <Badge
                label={String(data?.alerts.expiringSoon.count ?? "-")}
                tone={typeof data?.alerts.expiringSoon.count === "number" && data.alerts.expiringSoon.count > 0 ? "warning" : "default"}
              />
            </View>
            <MutedText style={{ marginTop: 8 }}>Within {data?.alerts.expiringSoon.expiryDays ?? "-"} days</MutedText>

            <View style={{ height: 12 }} />
            {expiringFiltered.length ? (
              <View style={{ gap: 10 }}>
                {expiringFiltered.slice(0, 10).map((it) => (
                  <ListRow
                    key={it._id}
                    title={it.name}
                    subtitle={`SKU: ${it.sku}`}
                    meta={it.expiryDate ? new Date(it.expiryDate).toLocaleDateString() : "-"}
                  />
                ))}
              </View>
            ) : (
              <MutedText>{q.trim() ? "No matching expiring items" : "No expiring items"}</MutedText>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Unusual movements</Text>
              <Badge
                label={String(data?.alerts.unusualMovements.count ?? "-")}
                tone={typeof data?.alerts.unusualMovements.count === "number" && data.alerts.unusualMovements.count > 0 ? "warning" : "default"}
              />
            </View>
            <MutedText style={{ marginTop: 8 }}>
              Last {data?.alerts.unusualMovements.movementHours ?? "-"}h, delta ≥ {data?.alerts.unusualMovements.movementDelta ?? "-"}
            </MutedText>

            <View style={{ height: 12 }} />
            {movementFiltered.length ? (
              <View style={{ gap: 10 }}>
                {movementFiltered.slice(0, 10).map((l) => (
                  <ListRow
                    key={l._id}
                    title={`Delta: ${typeof l.delta === "number" ? l.delta : "-"}`}
                    subtitle={`Action: ${l.action ?? "-"}${l.reason ? `\nReason: ${l.reason}` : ""}`}
                    meta={l.createdAt ? new Date(l.createdAt).toLocaleString() : "-"}
                  />
                ))}
              </View>
            ) : (
              <MutedText>{q.trim() ? "No matching movement logs" : "No unusual movements"}</MutedText>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
