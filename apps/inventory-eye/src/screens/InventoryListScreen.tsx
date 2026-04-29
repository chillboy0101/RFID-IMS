import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, MutedText, Screen, shadow, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  location?: string;
  quantity: number;
  reorderLevel: number;
  rfidTagId?: string;
};

type ItemsResponse = {
  ok: true;
  items: InventoryItem[];
};

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryList">;

type InventoryFilter = "all" | "low" | "out";

const INVENTORY_SKU_COLUMN_WIDTH = 176;
const INVENTORY_LOCATION_COLUMN_WIDTH = 148;
const INVENTORY_QTY_COLUMN_WIDTH = 72;
const INVENTORY_STATUS_COLUMN_WIDTH = 120;

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

function inventoryStatus(item: InventoryItem) {
  if (item.quantity <= 0) return { label: "Out of stock", tone: "danger" as const };
  if (item.quantity <= item.reorderLevel) return { label: "Low stock", tone: "warning" as const };
  return { label: "In stock", tone: "success" as const };
}

function inventoryMeta(item: InventoryItem) {
  const parts = [`ID: ${item._id.slice(-6)}`, item.barcode ? "Barcode ready" : "No barcode"];
  if (item.rfidTagId) parts.push("Legacy RFID tag");
  return parts.join(" | ");
}

function applyInventoryFilter(items: InventoryItem[], filter: InventoryFilter) {
  if (filter === "low") return items.filter((item) => item.quantity > 0 && item.quantity <= item.reorderLevel);
  if (filter === "out") return items.filter((item) => item.quantity <= 0);
  return items;
}

export function InventoryListScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const insets = useSafeAreaInsets();

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [scanOpen, setScanOpen] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);

  const headerSearchRef = useRef<TextInput>(null);
  const compactSearchRef = useRef<TextInput>(null);
  const webListRef = useRef<ScrollView>(null);
  const nativeListRef = useRef<FlatList<InventoryItem>>(null);
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

  const queryUrl = useMemo(() => {
    const trimmed = q.trim();
    return trimmed ? `/inventory/items?q=${encodeURIComponent(trimmed)}` : "/inventory/items";
  }, [q]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<ItemsResponse>(queryUrl, { method: "GET", token });
    setItems(res.items);
  }, [queryUrl, token]);

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

  const lowStockCount = useMemo(() => items.filter((item) => item.quantity > 0 && item.quantity <= item.reorderLevel).length, [items]);
  const outOfStockCount = useMemo(() => items.filter((item) => item.quantity <= 0).length, [items]);
  const visibleItems = useMemo(() => applyInventoryFilter(items, filter), [filter, items]);

  const filterTabs = useMemo(
    () => [
      { key: "all" as const, label: "All items", count: items.length },
      { key: "low" as const, label: "Low stock", count: lowStockCount },
      { key: "out" as const, label: "Out of stock", count: outOfStockCount },
    ],
    [items.length, lowStockCount, outOfStockCount]
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
        <SearchControl inputRef={headerSearchRef} value={q} onChangeText={setQ} placeholder="Search items, SKU, location" />
      </View>
      <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" iconName="barcode-outline" iconOnly />
      <AppButton title="New" onPress={() => navigation.navigate("InventoryCreate")} variant="secondary" iconName="add" iconOnly />
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
      <AppButton title="New" onPress={() => navigation.navigate("InventoryCreate")} variant="secondary" iconName="add" iconOnly />
    </View>
  );

  const renderDesktopRows = () => {
    if (visibleItems.length === 0) {
      return (
        <View style={{ padding: theme.spacing.md }}>
          <MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>
        </View>
      );
    }

    return (
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {visibleItems.map((item, index) => {
          const status = inventoryStatus(item);
          return (
            <Pressable
              key={item._id}
              onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
              style={(state) => {
                const pressed = state.pressed;
                const hovered = !!(state as any).hovered;
                return [
                  {
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 14,
                    borderBottomWidth: index === visibleItems.length - 1 ? 0 : 1,
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
                  {item.name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                  {inventoryMeta(item)}
                </Text>
              </View>
              <View style={{ width: INVENTORY_SKU_COLUMN_WIDTH, flexShrink: 0 }}>
                <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
                  {item.sku}
                </Text>
              </View>
              <View style={{ width: INVENTORY_LOCATION_COLUMN_WIDTH, flexShrink: 0 }}>
                <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
                  {item.location ?? "-"}
                </Text>
              </View>
              <View style={{ width: INVENTORY_QTY_COLUMN_WIDTH, flexShrink: 0 }}>
                <Text
                  style={{
                    textAlign: "right",
                    color: item.quantity <= item.reorderLevel ? theme.colors.warning : theme.colors.text,
                    fontWeight: "800",
                  }}
                >
                  {item.quantity}
                </Text>
              </View>
              <View style={{ width: INVENTORY_STATUS_COLUMN_WIDTH, flexShrink: 0, alignItems: "flex-start" }}>
                <Badge label={status.label} tone={status.tone} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  const renderCompactInventoryCard = (item: InventoryItem) => {
    const status = inventoryStatus(item);

    return (
      <Pressable
        key={item._id}
        onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
        style={(state) => {
          const pressed = state.pressed;
          const hovered = !!(state as any).hovered;
          return [
            {
              backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.md,
              opacity: pressed ? 0.95 : 1,
              ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
            },
            shadow(1),
          ];
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <View style={{ flexShrink: 0, alignItems: "flex-end" }}>
            <Badge label={status.label} tone={status.tone} />
          </View>
        </View>

        <View style={{ marginTop: 10, gap: 4 }}>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {`SKU: ${item.sku}`}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {`Location: ${item.location ?? "-"}`}
          </Text>
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: item.quantity <= item.reorderLevel ? theme.colors.warning : theme.colors.textMuted,
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              {`Qty ${item.quantity}`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
        </View>
      </Pressable>
    );
  };

  const compactHeader = (
    <Card style={{ paddingBottom: 10 }}>
      <View style={{ gap: 8 }}>
        <FilterTabs tabs={filterTabs} activeValue={filter} onChange={setFilter} />
        {q.trim() ? <MutedText>{`Searching "${q.trim()}"`}</MutedText> : null}
        {error ? (
          <View>
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}
      </View>
    </Card>
  );

  return (
    <Screen title="Inventory" tabBarPadding={isDesktopWeb} right={right}>
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
            <MutedText>{q.trim() ? `Showing ${visibleItems.length} results` : "Live inventory"}</MutedText>
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
                Item
              </Text>
            </View>
            <View style={{ width: INVENTORY_SKU_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                SKU
              </Text>
            </View>
            <View style={{ width: INVENTORY_LOCATION_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
                Location
              </Text>
            </View>
            <View style={{ width: INVENTORY_QTY_COLUMN_WIDTH, flexShrink: 0 }}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted, textAlign: "right" }]} numberOfLines={1}>
                Qty
              </Text>
            </View>
            <View style={{ width: INVENTORY_STATUS_COLUMN_WIDTH, flexShrink: 0 }}>
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

          {visibleItems.length ? (
            visibleItems.map((item) => renderCompactInventoryCard(item))
          ) : (
            <MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={nativeListRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.lg + insets.bottom + 156 }}
          data={visibleItems}
          keyExtractor={(item) => item._id}
          onScroll={(event) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListHeaderComponent={compactHeader}
          ListHeaderComponentStyle={{ marginBottom: 12 }}
          ListEmptyComponent={<MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>}
          renderItem={({ item }) => renderCompactInventoryCard(item)}
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
                  <SearchControl inputRef={compactSearchRef} value={q} onChangeText={setQ} placeholder="Search inventory" />
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
