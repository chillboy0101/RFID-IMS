import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type Order = {
  _id: string;
  status: string;
  createdAt: string;
};

type OrdersResponse = {
  ok: true;
  orders: Order[];
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrdersList">;

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
    floatingPos.setValue({ x: maxX, y: 0 });
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
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flex: 1, gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField value={q} onChangeText={setQ} placeholder="Search: order ID or status" autoCapitalize="none" />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, justifyContent: "flex-end", alignItems: "center", flexShrink: 0 }}>
                <Badge label={`Total: ${filtered.length}`} size="header" />
                <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" />
              </View>
            </View>
            <MutedText style={{ marginTop: 8 }}>Tip: click a row to open the order detail page.</MutedText>
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
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                Created
              </Text>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, width: 130, textAlign: "right" }]} numberOfLines={1}>
                Status
              </Text>
            </View>

            {isWeb ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.md, gap: 8 }} keyboardShouldPersistTaps="handled">
                {filtered.length ? (
                  filtered.map((item) => {
                    const tone = item.status === "fulfilled" ? "success" : item.status === "cancelled" ? "danger" : "primary";
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
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                          {new Date(item.createdAt).toLocaleString()}
                        </Text>
                        <View style={{ width: 130, alignItems: "flex-end" }}>
                          <Badge label={item.status} tone={tone} />
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
                  const tone = item.status === "fulfilled" ? "success" : item.status === "cancelled" ? "danger" : "primary";
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
                      <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                      <View style={{ width: 130, alignItems: "flex-end" }}>
                        <Badge label={item.status} tone={tone} />
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Badge label={`Total: ${filtered.length}`} size="header" responsive={false} fullWidth />
                </View>
                <View style={{ flex: 1 }}>
                  <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" responsive={false} fullWidth />
                </View>
              </View>
            </Card>

            {filtered.length ? (
              filtered.map((item) => (
                <ListRow
                  key={item._id}
                  title={`Order #${item._id.slice(-6)}`}
                  subtitle={`Created: ${new Date(item.createdAt).toLocaleString()}`}
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Badge label={`Total: ${filtered.length}`} size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} size="header" responsive={false} fullWidth />
                  </View>
                </View>
              </Card>
            }
            ListHeaderComponentStyle={{ marginBottom: 12 }}
            ListEmptyComponent={<MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>}
            renderItem={({ item }) => (
              <ListRow
                title={`Order #${item._id.slice(-6)}`}
                subtitle={`Created: ${new Date(item.createdAt).toLocaleString()}`}
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
          <View style={{ position: "relative" }}>
            <AppButton title="Search" iconName="search" iconOnly iconSize={28} variant="secondary" onPress={openSearchOverlay} />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
              }}
            >
              <View style={{ position: "absolute", left: 6, top: 6, width: 3, height: 3, borderRadius: 999, backgroundColor: theme.colors.textMuted, opacity: 0.8 }} />
              <View style={{ position: "absolute", right: 6, top: 6, width: 3, height: 3, borderRadius: 999, backgroundColor: theme.colors.textMuted, opacity: 0.8 }} />
              <View style={{ position: "absolute", left: 6, bottom: 6, width: 3, height: 3, borderRadius: 999, backgroundColor: theme.colors.textMuted, opacity: 0.8 }} />
              <View style={{ position: "absolute", right: 6, bottom: 6, width: 3, height: 3, borderRadius: 999, backgroundColor: theme.colors.textMuted, opacity: 0.8 }} />
            </View>
          </View>
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
