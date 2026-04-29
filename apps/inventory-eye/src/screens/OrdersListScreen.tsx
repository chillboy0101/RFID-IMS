import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type Order = {
  _id: string;
  status: string;
  createdAt: string;
  authorizationLocation?: string | null;
  authorizationExpiresAt?: string | null;
  workflow?: {
    requestedUnits: number;
    reservedUnits: number;
    taggedReservedUnits: number;
    barcodeFallbackUnits: number;
    activeAuthorizations: number;
    dispatchedUnits: number;
  };
};

type OrdersResponse = {
  ok: true;
  orders: Order[];
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrdersList">;

function toneForStatus(status: string) {
  if (status === "fulfilled") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "authorized") return "warning" as const;
  if (status === "picking") return "primary" as const;
  return "default" as const;
}

function nextStepForOrder(order: Order) {
  if (order.status === "created") return "Start picking";
  if (order.status === "picking") return "Authorize gate";
  if (order.status === "authorized") return "Verify exit scans";
  if (order.status === "fulfilled") return "Completed";
  if (order.status === "cancelled") return "Cancelled";
  return order.status;
}

function formatOrderProgress(order: Order) {
  const workflow = order.workflow;
  if (!workflow) return "Workflow summary unavailable";
  return `Reserved ${workflow.reservedUnits}/${workflow.requestedUnits} • Gate ${workflow.activeAuthorizations} • Exited ${workflow.dispatchedUnits}`;
}

export function OrdersListScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const { height } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Order>>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFloatingSearch] = useState(true);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const overlaySearchRef = useRef<TextInput>(null);
  const overlaySpace = theme.spacing.md + insets.top + 104;

  const scrollOffsetRef = useRef(0);
  const restoreRef = useRef<{ q: string; offset: number } | null>(null);

  const floatingPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const floatingDraggedRef = useRef(false);
  const floatingStartRef = useRef({ x: 0, y: 0 });

  const buttonSize = 52;
  const floatingMargin = theme.spacing.md;
  const floatingTop = theme.spacing.md + insets.top + 16;
  const floatingBottomLimit = theme.spacing.md + insets.bottom + 168;
  const maxX = Math.max(0, width - buttonSize - floatingMargin * 2);
  const maxY = Math.max(0, height - buttonSize - floatingTop - floatingBottomLimit);
  const floatingPan = useMemo(
    () => {
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          floatingStartRef.current = {
            x: (floatingPos.x as any).__getValue?.() ?? 0,
            y: (floatingPos.y as any).__getValue?.() ?? 0,
          };
          floatingPos.extractOffset();
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2) floatingDraggedRef.current = true;

          const start = floatingStartRef.current;
          const nextX = clamp(start.x + g.dx, 0, maxX);
          const nextY = clamp(start.y + g.dy, 0, maxY);
          floatingPos.setValue({ x: nextX - start.x, y: nextY - start.y });
        },
        onPanResponderRelease: () => {
          floatingPos.flattenOffset();
          const x = clamp((floatingPos.x as any).__getValue?.() ?? 0, 0, maxX);
          const y = clamp((floatingPos.y as any).__getValue?.() ?? 0, 0, maxY);
          const snapX = x < maxX / 2 ? 0 : maxX;
          Animated.spring(floatingPos, { toValue: { x: snapX, y }, useNativeDriver: false, friction: 7, tension: 90 }).start();
        },
      });
    },
    [floatingPos, maxX, maxY]
  );

  useEffect(() => {
    if (!showFloatingSearch) {
      floatingDraggedRef.current = false;
      return;
    }
    if (floatingDraggedRef.current) return;
    floatingPos.setValue({ x: maxX, y: maxY / 2 });
  }, [floatingPos, maxX, showFloatingSearch]);

  const openSearchOverlay = useCallback(() => {
    restoreRef.current = { q, offset: scrollOffsetRef.current };
    setSearchOverlayOpen(true);
    overlayAnim.setValue(0);
    Animated.timing(overlayAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    setTimeout(() => overlaySearchRef.current?.focus(), 50);
  }, [overlayAnim, q]);

  const closeSearchOverlay = useCallback(() => {
    Animated.timing(overlayAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setSearchOverlayOpen(false);
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (!restore) return;
      setQ(restore.q);
      setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: restore.offset, animated: false });
      }, 50);
    });
  }, [overlayAnim]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return orders;
    return orders.filter((o) => {
      const id = o._id.toLowerCase();
      const status = o.status.toLowerCase();
      const created = new Date(o.createdAt).toLocaleString().toLowerCase();
      return id.includes(t) || id.slice(-6).includes(t) || status.includes(t) || created.includes(t);
    });
  }, [orders, q]);

  const openCount = useMemo(() => filtered.filter((o) => o.status !== "fulfilled" && o.status !== "cancelled").length, [filtered]);
  const pickingCount = useMemo(() => filtered.filter((o) => o.status === "picking").length, [filtered]);
  const gateReadyCount = useMemo(() => filtered.filter((o) => o.status === "authorized").length, [filtered]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<OrdersResponse>("/orders", { method: "GET", token });
    setOrders(res.orders);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await load();
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  return (
    <Screen
      title="Orders"
      tabBarPadding={isDesktopWeb}
      right={<AppButton title="New" onPress={() => navigation.navigate("OrderCreate")} variant="secondary" iconName="add" iconOnly />}
    >
      <BarcodeScanModal
        visible={scanOpen}
        title="Scan barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setQ(value);
          setScanOpen(false);
          setTimeout(() => {
            if (searchOverlayOpen) overlaySearchRef.current?.focus();
            else searchRef.current?.focus();
          }, 50);
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flex: 1, gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField ref={searchRef} value={q} onChangeText={setQ} placeholder="Search: order ID or status" autoCapitalize="none" />
              </View>
              <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" />
              <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, justifyContent: "flex-end", alignItems: "center", flexShrink: 0 }}>
                <Badge label={`Total: ${filtered.length}`} size="header" />
                <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" />
                <Badge label={`Picking: ${pickingCount}`} tone={pickingCount > 0 ? "warning" : "default"} size="header" />
                <Badge label={`Gate ready: ${gateReadyCount}`} tone={gateReadyCount > 0 ? "warning" : "default"} size="header" />
              </View>
            </View>
          </Card>

          <Card style={{ padding: 0, flex: 1 }}>
            <View
              style={{
                paddingHorizontal: theme.spacing.md,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                Order
              </Text>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                Created
              </Text>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                Progress
              </Text>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, width: 150, textAlign: "right" }]} numberOfLines={1}>
                Next Step
              </Text>
            </View>

            {isWeb ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.md, gap: 8 }} keyboardShouldPersistTaps="handled">
                {filtered.length ? (
                  filtered.map((item) => {
                    const tone = toneForStatus(item.status);
                    return (
                      <Pressable
                        key={item._id}
                        onPress={() => navigation.navigate("OrderDetail", { id: item._id })}
                        style={(state) => {
                          const pressed = state.pressed;
                          const hovered = !!(state as any).hovered;
                          return [
                            {
                              paddingVertical: 12,
                              paddingHorizontal: theme.spacing.md,
                              borderRadius: theme.radius.md,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                              backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 12,
                              ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                            },
                            hovered && !pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
                            pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
                          ];
                        }}
                      >
                        <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 2 }]} numberOfLines={1}>
                          #{item._id.slice(-6)}
                        </Text>
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                          {new Date(item.createdAt).toLocaleString()}
                        </Text>
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                          {formatOrderProgress(item)}
                        </Text>
                        <View style={{ width: 150, alignItems: "flex-end", gap: 6 }}>
                          <Badge label={item.status} tone={tone} />
                          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]} numberOfLines={1}>
                            {nextStepForOrder(item)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>
                )}
              </ScrollView>
            ) : (
              <FlatList
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: theme.spacing.md, gap: 8, paddingBottom: theme.spacing.lg + insets.bottom + 112 }}
                data={filtered}
                keyExtractor={(o) => o._id}
                ListEmptyComponent={<MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>}
                renderItem={({ item }) => {
                  const tone = toneForStatus(item.status);
                  return (
                    <Pressable
                      onPress={() => navigation.navigate("OrderDetail", { id: item._id })}
                      style={(state) => {
                        const pressed = state.pressed;
                        const hovered = !!(state as any).hovered;
                        return [
                          {
                            paddingVertical: 12,
                            paddingHorizontal: theme.spacing.md,
                            borderRadius: theme.radius.md,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                          },
                          hovered && !pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
                          pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
                        ];
                      }}
                    >
                      <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 2 }]} numberOfLines={1}>
                        #{item._id.slice(-6)}
                      </Text>
                      <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                      <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                        {formatOrderProgress(item)}
                      </Text>
                      <View style={{ width: 150, alignItems: "flex-end", gap: 6 }}>
                        <Badge label={item.status} tone={tone} />
                        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]} numberOfLines={1}>
                          {nextStepForOrder(item)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }}
              />
            )}
          </Card>
        </View>
      ) : (
        Platform.OS === "web" ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 12, paddingBottom: theme.spacing.lg + insets.bottom + 156, paddingTop: searchOverlayOpen ? overlaySpace : 0 }}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => {
              const y = (e as any)?.nativeEvent?.contentOffset?.y ?? 0;
              scrollOffsetRef.current = y;
            }}
            scrollEventThrottle={32}
          >
            <Card>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <View style={{ width: "48%" }}>
                  <Badge label={`Total: ${filtered.length}`} size="header" responsive={false} fullWidth />
                </View>
                <View style={{ width: "48%" }}>
                  <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" responsive={false} fullWidth />
                </View>
                <View style={{ width: "48%" }}>
                  <Badge label={`Picking: ${pickingCount}`} tone={pickingCount > 0 ? "warning" : "default"} size="header" responsive={false} fullWidth />
                </View>
                <View style={{ width: "48%" }}>
                  <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" style={{ width: "100%" }} />
                </View>
              </View>
            </Card>

            {filtered.length ? (
              filtered.map((item) => (
                <ListRow
                  key={item._id}
                  title={`Order #${item._id.slice(-6)}`}
                  subtitle={`Created: ${new Date(item.createdAt).toLocaleString()}\n${formatOrderProgress(item)}`}
                  right={<Badge label={item.status} tone={item.status === "fulfilled" ? "success" : item.status === "cancelled" ? "danger" : "primary"} />}
                  onPress={() => navigation.navigate("OrderDetail", { id: item._id })}
                />
              ))
            ) : (
              <MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>
            )}
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: theme.spacing.lg + insets.bottom + 156, paddingTop: searchOverlayOpen ? overlaySpace : 0 }}
            data={filtered}
            keyExtractor={(o) => o._id}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              scrollOffsetRef.current = y;
            }}
            scrollEventThrottle={32}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            ListHeaderComponent={
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ width: "48%" }}>
                    <Badge label={`Total: ${filtered.length}`} size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ width: "48%" }}>
                    <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ width: "48%" }}>
                    <Badge label={`Picking: ${pickingCount}`} tone={pickingCount > 0 ? "warning" : "default"} size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ width: "48%" }}>
                    <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" style={{ width: "100%" }} />
                  </View>
                </View>
              </Card>
            }
            ListHeaderComponentStyle={{ marginBottom: 12 }}
            ListEmptyComponent={<MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>}
            renderItem={({ item }) => (
              <ListRow
                title={`Order #${item._id.slice(-6)}`}
                subtitle={`Created: ${new Date(item.createdAt).toLocaleString()}\n${formatOrderProgress(item)}`}
                right={<Badge label={item.status} tone={item.status === "fulfilled" ? "success" : item.status === "cancelled" ? "danger" : "primary"} />}
                onPress={() => navigation.navigate("OrderDetail", { id: item._id })}
              />
            )}
          />
        )
      )}

      {!isDesktopWeb && showFloatingSearch && !searchOverlayOpen ? (
        <Animated.View
          style={{
            position: "absolute",
            left: floatingMargin,
            top: floatingTop,
            zIndex: 50,
            elevation: 50,
            transform: floatingPos.getTranslateTransform(),
          }}
          pointerEvents="box-none"
          {...floatingPan.panHandlers}
        >
          <AppButton title="Search" iconName="search" iconOnly iconSize={28} variant="secondary" onPress={openSearchOverlay} />
        </Animated.View>
      ) : null}

      {searchOverlayOpen ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 60, elevation: 60 }} pointerEvents="box-none">
          <Animated.View
            style={{
              padding: theme.spacing.md,
              paddingTop: theme.spacing.md + insets.top,
              transform: [
                {
                  translateY: overlayAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-160, 0],
                  }),
                },
              ],
              opacity: overlayAnim,
            }}
          >
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <TextField
                    ref={overlaySearchRef}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search orders"
                    autoCapitalize="none"
                  />
                </View>
                <AppButton title="Close" iconName="close" iconOnly variant="secondary" onPress={closeSearchOverlay} />
              </View>
            </Card>
          </Animated.View>
        </View>
      ) : null}
    </Screen>
  );
}
