import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, ListRow, LivePulse, MutedText, Screen, theme } from "../ui";

type Order = {
  _id: string;
  status: string;
  createdAt: string;
  authorizationLocation?: string | null;
  authorizationExpiresAt?: string | null;
};

type OrdersResponse = {
  ok: true;
  orders: Order[];
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrdersList">;

type OrderFilter = "all" | "open" | "picking" | "closed";

const ORDER_CREATED_COLUMN_WIDTH = 214;
const ORDER_GATE_COLUMN_WIDTH = 150;
const ORDER_STATUS_COLUMN_WIDTH = 120;

function SearchControl({
  inputRef,
  value,
  onChangeText,
  placeholder,
}: {
  inputRef?: React.RefObject<TextInput | null>;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View
      style={{
        minHeight: 46,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        borderRadius: theme.radius.sm,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Ionicons name="search" size={16} color={theme.colors.textMuted} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          minHeight: 44,
          color: theme.colors.text,
          fontSize: 15,
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
        }}
      />
    </View>
  );
}

function FilterTabs<T extends string>({
  tabs,
  activeValue,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count: number }>;
  activeValue: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
      {tabs.map((tab) => {
        const active = tab.key === activeValue;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={{
              paddingTop: 4,
              paddingBottom: 10,
              borderBottomWidth: 2,
              borderBottomColor: active ? theme.colors.primary : "transparent",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                style={{
                  color: active ? theme.colors.text : theme.colors.textMuted,
                  fontWeight: active ? "800" : "700",
                  fontSize: 14,
                }}
              >
                {tab.label}
              </Text>
              <View
                style={{
                  minWidth: 28,
                  height: 26,
                  paddingHorizontal: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: active ? theme.colors.text : theme.colors.textMuted, fontWeight: "800", fontSize: 12 }}>{tab.count}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function toneForStatus(status: string) {
  if (status === "fulfilled") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "authorized") return "warning" as const;
  if (status === "picking") return "primary" as const;
  return "default" as const;
}

function formatStatus(status: string) {
  if (!status) return "-";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isOpenStatus(status: string) {
  return status !== "fulfilled" && status !== "cancelled";
}

function applyOrderFilter(orders: Order[], filter: OrderFilter) {
  if (filter === "open") return orders.filter((order) => isOpenStatus(order.status));
  if (filter === "picking") return orders.filter((order) => order.status === "picking");
  if (filter === "closed") return orders.filter((order) => order.status === "fulfilled" || order.status === "cancelled");
  return orders;
}

export function OrdersListScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const insets = useSafeAreaInsets();

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [scanOpen, setScanOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);

  const headerSearchRef = useRef<TextInput>(null);
  const compactSearchRef = useRef<TextInput>(null);
  const webListRef = useRef<ScrollView>(null);
  const nativeListRef = useRef<FlatList<Order>>(null);
  const scrollOffsetRef = useRef(0);
  const compactSearchAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isDesktopWeb) {
      setCompactSearchOpen(false);
      compactSearchAnim.setValue(0);
      return;
    }

    Animated.timing(compactSearchAnim, {
      toValue: compactSearchOpen ? 1 : 0,
      duration: compactSearchOpen ? 190 : 150,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && compactSearchOpen) {
        setTimeout(() => compactSearchRef.current?.focus(), 40);
      }
    });
  }, [compactSearchAnim, compactSearchOpen, isDesktopWeb]);

  const searchResults = useMemo(() => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) return orders;
    return orders.filter((order) => {
      const id = order._id.toLowerCase();
      const status = order.status.toLowerCase();
      const created = new Date(order.createdAt).toLocaleString().toLowerCase();
      return id.includes(trimmed) || id.slice(-6).includes(trimmed) || status.includes(trimmed) || created.includes(trimmed);
    });
  }, [orders, q]);

  const openCount = useMemo(() => searchResults.filter((order) => isOpenStatus(order.status)).length, [searchResults]);
  const pickingCount = useMemo(() => searchResults.filter((order) => order.status === "picking").length, [searchResults]);
  const closedCount = useMemo(() => searchResults.filter((order) => order.status === "fulfilled" || order.status === "cancelled").length, [searchResults]);
  const visibleOrders = useMemo(() => applyOrderFilter(searchResults, filter), [filter, searchResults]);

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

  const filterTabs = useMemo(
    () => [
      { key: "all" as const, label: "All orders", count: searchResults.length },
      { key: "open" as const, label: "Open", count: openCount },
      { key: "picking" as const, label: "Picking", count: pickingCount },
      { key: "closed" as const, label: "Closed", count: closedCount },
    ],
    [closedCount, openCount, pickingCount, searchResults.length]
  );

  const compactSearchHeight = compactSearchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 88],
  });

  const compactSearchTranslate = compactSearchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
  });

  const restoreCompactScroll = useCallback(() => {
    const offset = scrollOffsetRef.current;
    if (Platform.OS === "web") {
      webListRef.current?.scrollTo?.({ y: offset, animated: false });
      return;
    }
    nativeListRef.current?.scrollToOffset?.({ offset, animated: false });
  }, []);

  const closeCompactSearch = useCallback(() => {
    setCompactSearchOpen(false);
    setTimeout(restoreCompactScroll, 40);
  }, [restoreCompactScroll]);

  const right = isDesktopWeb ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: width >= 1260 ? 320 : 260 }}>
        <SearchControl inputRef={headerSearchRef} value={q} onChangeText={setQ} placeholder="Search order ID or status" />
      </View>
      <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" iconName="barcode-outline" iconOnly />
      <AppButton title="New" onPress={() => navigation.navigate("OrderCreate")} variant="secondary" iconName="add" iconOnly />
    </View>
  ) : (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <AppButton
        title={compactSearchOpen ? "Close search" : "Search"}
        onPress={() => {
          if (compactSearchOpen) closeCompactSearch();
          else setCompactSearchOpen(true);
        }}
        variant="secondary"
        iconName={compactSearchOpen ? "close" : "search"}
        iconOnly
      />
      <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" iconName="barcode-outline" iconOnly />
      <AppButton title="New" onPress={() => navigation.navigate("OrderCreate")} variant="secondary" iconName="add" iconOnly />
    </View>
  );

  const renderDesktopRows = () => {
    if (visibleOrders.length === 0) {
      return (
        <View style={{ padding: theme.spacing.md }}>
          <MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>
        </View>
      );
    }

    return (
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {visibleOrders.map((order, index) => {
          const tone = toneForStatus(order.status);
          return (
            <Pressable
              key={order._id}
              onPress={() => navigation.navigate("OrderDetail", { id: order._id })}
              style={(state) => {
                const pressed = state.pressed;
                const hovered = !!(state as any).hovered;
                return [
                  {
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 14,
                    borderBottomWidth: index === visibleOrders.length - 1 ? 0 : 1,
                    borderBottomColor: theme.colors.border,
                    backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                  },
                ];
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                  {`Order #${order._id.slice(-6)}`}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                  {`Created ${new Date(order.createdAt).toLocaleDateString()}`}
                </Text>
              </View>
              <View style={{ width: ORDER_CREATED_COLUMN_WIDTH, flexShrink: 0 }}>
                <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
                  {new Date(order.createdAt).toLocaleString()}
                </Text>
              </View>
              <View style={{ width: ORDER_GATE_COLUMN_WIDTH, flexShrink: 0 }}>
                <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
                  {order.authorizationLocation ?? "-"}
                </Text>
              </View>
              <View style={{ width: ORDER_STATUS_COLUMN_WIDTH, flexShrink: 0, alignItems: "flex-start" }}>
                <Badge label={formatStatus(order.status)} tone={tone} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  const compactHeader = (
    <Card style={{ paddingBottom: 10 }}>
      <FilterTabs tabs={filterTabs} activeValue={filter} onChange={setFilter} />
      {q.trim() ? <MutedText style={{ marginTop: 8 }}>{`Searching "${q.trim()}"`}</MutedText> : null}
      {error ? (
        <View style={{ marginTop: 10 }}>
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}
    </Card>
  );

  return (
    <Screen title="Orders" tabBarPadding={isDesktopWeb} right={right}>
      <BarcodeScanModal
        visible={scanOpen}
        title="Scan barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setQ(value);
          setScanOpen(false);
          if (isDesktopWeb) {
            setTimeout(() => headerSearchRef.current?.focus(), 40);
            return;
          }
          setCompactSearchOpen(true);
        }}
      />

      {isDesktopWeb ? (
        <Card style={{ padding: 0, flex: 1 }}>
          <View
            style={{
              paddingHorizontal: theme.spacing.md,
              paddingTop: 6,
              paddingBottom: 2,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <FilterTabs tabs={filterTabs} activeValue={filter} onChange={setFilter} />
            </View>
            <LivePulse />
          </View>

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
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                Order
              </Text>
            </View>
            <View style={{ width: ORDER_CREATED_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                Created
              </Text>
            </View>
            <View style={{ width: ORDER_GATE_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                Gate
              </Text>
            </View>
            <View style={{ width: ORDER_STATUS_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                Status
              </Text>
            </View>
          </View>

          {error ? (
            <View style={{ padding: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <ErrorText>{error}</ErrorText>
            </View>
          ) : null}

          {renderDesktopRows()}
        </Card>
      ) : Platform.OS === "web" ? (
        <ScrollView
          ref={webListRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: theme.spacing.lg + insets.bottom + 156 }}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          {compactHeader}

          {visibleOrders.length ? (
            visibleOrders.map((order) => (
              <ListRow
                key={order._id}
                title={`Order #${order._id.slice(-6)}`}
                subtitle={`Created: ${new Date(order.createdAt).toLocaleString()}\nGate: ${order.authorizationLocation ?? "-"}`}
                right={<Badge label={formatStatus(order.status)} tone={toneForStatus(order.status)} />}
                onPress={() => navigation.navigate("OrderDetail", { id: order._id })}
              />
            ))
          ) : (
            <MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={nativeListRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.lg + insets.bottom + 156 }}
          data={visibleOrders}
          keyExtractor={(order) => order._id}
          onScroll={(event) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListHeaderComponent={compactHeader}
          ListHeaderComponentStyle={{ marginBottom: 12 }}
          ListEmptyComponent={<MutedText>{q.trim() ? "No matching orders" : "No orders"}</MutedText>}
          renderItem={({ item }) => (
            <ListRow
              title={`Order #${item._id.slice(-6)}`}
              subtitle={`Created: ${new Date(item.createdAt).toLocaleString()}\nGate: ${item.authorizationLocation ?? "-"}`}
              right={<Badge label={formatStatus(item.status)} tone={toneForStatus(item.status)} />}
              onPress={() => navigation.navigate("OrderDetail", { id: item._id })}
            />
          )}
        />
      )}

      {!isDesktopWeb ? (
        <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <Animated.View
            pointerEvents={compactSearchOpen ? "auto" : "none"}
            style={{
              paddingHorizontal: theme.spacing.md,
              height: compactSearchHeight,
              opacity: compactSearchAnim,
              overflow: "hidden",
              transform: [{ translateY: compactSearchTranslate }],
            }}
          >
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <SearchControl inputRef={compactSearchRef} value={q} onChangeText={setQ} placeholder="Search orders" />
                </View>
                <AppButton title="Close" iconName="close" iconOnly variant="secondary" onPress={closeCompactSearch} />
              </View>
            </Card>
          </Animated.View>
        </View>
      ) : null}
    </Screen>
  );
}
