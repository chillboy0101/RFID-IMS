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
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Order>>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFloatingSearch, setShowFloatingSearch] = useState(false);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const overlaySearchRef = useRef<TextInput>(null);

  const floatingPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const floatingPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          floatingPos.extractOffset();
        },
        onPanResponderMove: Animated.event([null, { dx: floatingPos.x, dy: floatingPos.y }], { useNativeDriver: false }),
        onPanResponderRelease: () => {
          floatingPos.flattenOffset();
        },
      }),
    [floatingPos]
  );

  const openSearchOverlay = useCallback(() => {
    setSearchOverlayOpen(true);
    overlayAnim.setValue(0);
    Animated.timing(overlayAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    setTimeout(() => overlaySearchRef.current?.focus(), 50);
  }, [overlayAnim]);

  const closeSearchOverlay = useCallback(() => {
    Animated.timing(overlayAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSearchOverlayOpen(false);
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
            contentContainerStyle={{ gap: 12 }}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => {
              const y = (e as any)?.nativeEvent?.contentOffset?.y ?? 0;
              const next = y > 80;
              setShowFloatingSearch((prev) => (prev === next ? prev : next));
            }}
            scrollEventThrottle={32}
          >
            <Card>
              <TextField
                value={q}
                onChangeText={setQ}
                placeholder="Search: order ID or status"
                autoCapitalize="none"
              />
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <Badge label={`Total: ${filtered.length}`} />
                <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} />
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
            contentContainerStyle={{ paddingBottom: theme.spacing.lg + insets.bottom + 112 }}
            data={filtered}
            keyExtractor={(o) => o._id}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              const next = y > 80;
              setShowFloatingSearch((prev) => (prev === next ? prev : next));
            }}
            scrollEventThrottle={32}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            ListHeaderComponent={
              <Card>
                <TextField
                  ref={searchRef}
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search: order ID or status"
                  autoCapitalize="none"
                />
                <View style={{ height: 12 }} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <Badge label={`Total: ${filtered.length}`} />
                  <Badge label={`Open: ${openCount}`} tone={openCount > 0 ? "primary" : "default"} />
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

      {!isDesktopWeb && showFloatingSearch ? (
        <Animated.View
          style={{
            position: "absolute",
            right: theme.spacing.md,
            bottom: theme.spacing.md + insets.bottom + 112,
            zIndex: 50,
            elevation: 50,
            transform: floatingPos.getTranslateTransform(),
          }}
          pointerEvents="box-none"
          {...floatingPan.panHandlers}
        >
          <AppButton title="Search" iconName="search" iconOnly variant="secondary" onPress={openSearchOverlay} />
        </Animated.View>
      ) : null}

      {searchOverlayOpen ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 }}>
          <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={closeSearchOverlay} />
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
