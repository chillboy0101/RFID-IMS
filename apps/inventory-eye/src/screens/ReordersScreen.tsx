import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AUTO_REFRESH_PAUSE_MS, GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type ReorderStatus = "requested" | "ordered" | "received" | "cancelled";

type Reorder = {
  _id: string;
  itemId: string;
  vendorId?: string;
  requestedQuantity: number;
  status: ReorderStatus;
  note?: string;
  createdAt?: string;
};

type Props = NativeStackScreenProps<MoreStackParamList, "Reorders">;

const statuses: Array<ReorderStatus | ""> = ["", "requested", "ordered", "received", "cancelled"];

export function ReordersScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") {
      navigation.popToTop();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const canManage = effectiveRole === "manager" || effectiveRole === "admin";

  const [status, setStatusFilter] = useState<ReorderStatus | "">("");
  const [q, setQ] = useState("");
  const lastTypingAtRef = useRef(0);
  const [reorders, setReorders] = useState<Reorder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const listUrl = useMemo(() => {
    const s = status.trim();
    return s ? `/reorders?status=${encodeURIComponent(s)}` : "/reorders";
  }, [status]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return reorders;
    return reorders.filter((r) => {
      const blob = `${r._id} ${r.itemId} ${r.vendorId ?? ""} ${r.status} ${r.note ?? ""}`.toLowerCase();
      return blob.includes(t) || r._id.slice(-6).toLowerCase().includes(t);
    });
  }, [q, reorders]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<{ ok: true; reorders: Reorder[] }>(listUrl, { method: "GET", token });
    setReorders(res.reorders);
  }, [listUrl, token]);

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
      setLoading(true);
      loadSafe(true)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));

      const id = setInterval(() => {
        if (Date.now() - lastTypingAtRef.current < AUTO_REFRESH_PAUSE_MS) return;
        loadSafe(true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [loadSafe])
  );

  useEffect(() => {
    loadSafe(true).catch(() => undefined);
  }, [listUrl, loadSafe]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadSafe(false);
    } finally {
      setRefreshing(false);
    }
  }

  async function updateReorderStatus(id: string, newStatus: ReorderStatus) {
    if (!token || !canManage) return;

    setError(null);
    try {
      await apiRequest<{ ok: true; reorder: Reorder }>(`/reorders/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status: newStatus }),
      });
      await loadSafe(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set status");
    }
  }

  return (
    <Screen
      title="Reorders"
      scroll
      busy={refreshing || updating}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      right={
        isDesktopWeb ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {canManage ? (
              <AppButton title="New" onPress={() => navigation.navigate("ReordersCreate")} variant="secondary" iconName="add" iconOnly />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
            {canManage ? (
              <AppButton title="New" onPress={() => navigation.navigate("ReordersCreate")} variant="secondary" iconName="add" iconOnly />
            ) : null}
          </View>
        )
      }
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
                  placeholder="Search: reorder ID, item/vendor, note"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
                <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, alignItems: "center" }}>
                  <Badge label={`Total: ${filtered.length}`} size="header" />
                </View>
              </View>
            </View>

            <MutedText style={{ marginTop: 8 }}>Tip: use Status chips to narrow results.</MutedText>

            {!canManage ? (
              <View style={{ marginTop: 12 }}>
                <MutedText>Reorder management requires manager/admin.</MutedText>
              </View>
            ) : null}

            <View style={{ height: 12 }} />
            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Status</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {statuses.map((s) => (
                <AppButton
                  key={s || "all"}
                  title={s || "all"}
                  onPress={() => setStatusFilter(s as any)}
                  variant={s === status ? "primary" : "secondary"}
                />
              ))}
            </View>
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>List</Text>
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filtered.length ? (
                  filtered.map((item) => (
                    <Card key={item._id}>
                      <ListRow
                        title={`Reorder #${item._id.slice(-6)}`}
                        subtitle={`Item: ${item.itemId}\nVendor: ${item.vendorId ?? "-"}${item.note ? `\nNote: ${item.note}` : ""}`}
                        meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                        right={
                          <Badge
                            label={item.status}
                            tone={item.status === "received" ? "success" : item.status === "cancelled" ? "danger" : "primary"}
                          />
                        }
                      />

                      <View style={{ marginTop: 10 }}>
                        <MutedText>Requested qty: {item.requestedQuantity}</MutedText>
                      </View>

                      {canManage ? (
                        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                          {(["requested", "ordered", "received", "cancelled"] as ReorderStatus[]).map((s) => (
                            <AppButton
                              key={s}
                              title={s}
                              onPress={() => updateReorderStatus(item._id, s)}
                              variant={s === item.status ? "primary" : "secondary"}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching reorders" : "No reorders"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filtered}
                keyExtractor={(r) => r._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={<MutedText>{q.trim() ? "No matching reorders" : "No reorders"}</MutedText>}
                renderItem={({ item }) => (
                  <Card>
                    <ListRow
                      title={`Reorder #${item._id.slice(-6)}`}
                      subtitle={`Item: ${item.itemId}\nVendor: ${item.vendorId ?? "-"}${item.note ? `\nNote: ${item.note}` : ""}`}
                      meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                      right={
                        <Badge
                          label={item.status}
                          tone={item.status === "received" ? "success" : item.status === "cancelled" ? "danger" : "primary"}
                        />
                      }
                    />

                    <View style={{ marginTop: 10 }}>
                      <MutedText>Requested qty: {item.requestedQuantity}</MutedText>
                    </View>

                    {canManage ? (
                      <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {(["requested", "ordered", "received", "cancelled"] as ReorderStatus[]).map((s) => (
                          <AppButton
                            key={s}
                            title={s}
                            onPress={() => updateReorderStatus(item._id, s)}
                            variant={s === item.status ? "primary" : "secondary"}
                          />
                        ))}
                      </View>
                    ) : null}
                  </Card>
                )}
              />
            )}
          </Card>
        </View>
      ) : (
        <>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Filter</Text>
            <TextField
              value={q}
              onChangeText={setQ}
              placeholder="Reorder ID, item/vendor, note"
              autoCapitalize="none"
            />
            <View style={{ height: 12 }} />
            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Status</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {statuses.map((s) => (
                <AppButton
                  key={s || "all"}
                  title={s || "all"}
                  onPress={() => setStatusFilter(s as any)}
                  variant={s === status ? "primary" : "secondary"}
                />
              ))}
            </View>

            <View style={{ height: 12 }} />

          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>List</Text>
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filtered.length ? (
                  filtered.map((item) => (
                    <Card key={item._id}>
                      <ListRow
                        title={`Reorder #${item._id.slice(-6)}`}
                        subtitle={`Item: ${item.itemId}\nVendor: ${item.vendorId ?? "-"}${item.note ? `\nNote: ${item.note}` : ""}`}
                        meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                        right={
                          <Badge
                            label={item.status}
                            tone={item.status === "received" ? "success" : item.status === "cancelled" ? "danger" : "primary"}
                          />
                        }
                      />

                      <View style={{ marginTop: 10 }}>
                        <MutedText>Requested qty: {item.requestedQuantity}</MutedText>
                      </View>

                      {canManage ? (
                        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                          {(["requested", "ordered", "received", "cancelled"] as ReorderStatus[]).map((s) => (
                            <AppButton
                              key={s}
                              title={s}
                              onPress={() => updateReorderStatus(item._id, s)}
                              variant={s === item.status ? "primary" : "secondary"}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching reorders" : "No reorders"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filtered}
                keyExtractor={(r) => r._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={<MutedText>{q.trim() ? "No matching reorders" : "No reorders"}</MutedText>}
                renderItem={({ item }) => (
                  <Card>
                    <ListRow
                      title={`Reorder #${item._id.slice(-6)}`}
                      subtitle={`Item: ${item.itemId}\nVendor: ${item.vendorId ?? "-"}${item.note ? `\nNote: ${item.note}` : ""}`}
                      meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                      right={
                        <Badge
                          label={item.status}
                          tone={item.status === "received" ? "success" : item.status === "cancelled" ? "danger" : "primary"}
                        />
                      }
                    />

                    <View style={{ marginTop: 10 }}>
                      <MutedText>Requested qty: {item.requestedQuantity}</MutedText>
                    </View>

                    {canManage ? (
                      <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {(["requested", "ordered", "received", "cancelled"] as ReorderStatus[]).map((s) => (
                          <AppButton
                            key={s}
                            title={s}
                            onPress={() => updateReorderStatus(item._id, s)}
                            variant={s === item.status ? "primary" : "secondary"}
                          />
                        ))}
                      </View>
                    ) : null}
                  </Card>
                )}
              />
            )}
          </Card>

          {!canManage ? (
            <Card>
              <MutedText>Reorder management requires manager/admin.</MutedText>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
