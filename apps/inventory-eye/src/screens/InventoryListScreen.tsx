import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  location?: string;
  quantity: number;
  reorderLevel: number;
  status?: string;
};

type ItemsResponse = {
  ok: true;
  items: InventoryItem[];
};

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryList">;

export function InventoryListScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const { height } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<InventoryItem>>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFloatingSearch] = useState(true);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const overlaySearchRef = useRef<TextInput>(null);
  const overlaySpace = theme.spacing.md + insets.top + 160;

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

  const queryUrl = useMemo(() => {
    const t = q.trim();
    return t ? `/inventory/items?q=${encodeURIComponent(t)}` : "/inventory/items";
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

  const lowStockCount = useMemo(() => items.filter((it) => it.quantity <= it.reorderLevel).length, [items]);

  return (
    <Screen
      title="Inventory"
      tabBarPadding={isDesktopWeb}
      right={<AppButton title="New" onPress={() => navigation.navigate("InventoryCreate")} variant="secondary" iconName="add" iconOnly />}
    >
      <BarcodeScanModal
        visible={scanOpen}
        title="Scan barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setQ(value);
          setScanOpen(false);
          setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />
      {isDesktopWeb ? (
        <View style={{ flex: 1, gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  ref={searchRef}
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search: name, SKU, barcode, location, RFID tag"
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={() => setQ((prev) => prev.trim())}
                />
              </View>

              <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" />

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
                <Badge label={`Total: ${items.length}`} tone="default" size="header" />
                <Badge label={`Low stock: ${lowStockCount}`} tone={lowStockCount > 0 ? "warning" : "default"} size="header" />
              </View>
            </View>

            {error ? (
              <View style={{ marginTop: 10 }}>
                <ErrorText>{error}</ErrorText>
              </View>
            ) : null}

            <MutedText style={{ marginTop: 10 }}>Tip: click a row to open the item detail page.</MutedText>
          </Card>

          <View style={{ flex: 1, minWidth: 0 }}>
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
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 4 }]} numberOfLines={1}>
                  Item
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                  SKU
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                  Location
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, width: 90, textAlign: "right" }]} numberOfLines={1}>
                  Qty
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, width: 110, textAlign: "right" }]} numberOfLines={1}>
                  Reorder
                </Text>
              </View>

              {isWeb ? (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.md, gap: 8 }} keyboardShouldPersistTaps="handled">
                  {items.length ? (
                    items.map((item) => (
                      <Pressable
                        key={item._id}
                        onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
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
                        <View style={{ flex: 4, minWidth: 0 }}>
                          <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                            ID: {item._id.slice(-6)}
                          </Text>
                        </View>

                        <Text style={[theme.typography.body, { color: theme.colors.text, flex: 2 }]} numberOfLines={1}>
                          {item.sku}
                        </Text>

                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                          {item.location ?? "-"}
                        </Text>

                        <Text
                          style={{
                            color: item.quantity <= item.reorderLevel ? theme.colors.warning : theme.colors.text,
                            fontWeight: "800",
                            width: 90,
                            textAlign: "right",
                          }}
                          numberOfLines={1}
                        >
                          {item.quantity}
                        </Text>

                        <Text style={{ color: theme.colors.textMuted, width: 110, textAlign: "right" }} numberOfLines={1}>
                          {item.reorderLevel}
                        </Text>
                      </Pressable>
                    ))
                  ) : (
                    <MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>
                  )}
                </ScrollView>
              ) : (
                <FlatList
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: theme.spacing.md, gap: 8 }}
                  data={items}
                  keyExtractor={(it) => it._id}
                  ListEmptyComponent={<MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
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
                      <View style={{ flex: 4, minWidth: 0 }}>
                        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
                          ID: {item._id.slice(-6)}
                        </Text>
                      </View>

                      <Text style={[theme.typography.body, { color: theme.colors.text, flex: 2 }]} numberOfLines={1}>
                        {item.sku}
                      </Text>

                      <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                        {item.location ?? "-"}
                      </Text>

                      <Text
                        style={{
                          color: item.quantity <= item.reorderLevel ? theme.colors.warning : theme.colors.text,
                          fontWeight: "800",
                          width: 90,
                          textAlign: "right",
                        }}
                        numberOfLines={1}
                      >
                        {item.quantity}
                      </Text>

                      <Text style={{ color: theme.colors.textMuted, width: 110, textAlign: "right" }} numberOfLines={1}>
                        {item.reorderLevel}
                      </Text>
                    </Pressable>
                  )}
                />
              )}
            </Card>
          </View>
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
                  <Badge label={`Total: ${items.length}`} tone="default" size="header" responsive={false} fullWidth />
                </View>
                <View style={{ flex: 1 }}>
                  <Badge
                    label={`Low stock: ${lowStockCount}`}
                    tone={lowStockCount > 0 ? "warning" : "default"}
                    size="header"
                    responsive={false}
                    fullWidth
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" style={{ width: "100%" }} />
                </View>
              </View>
              {error ? (
                <View style={{ marginTop: 10 }}>
                  <ErrorText>{error}</ErrorText>
                </View>
              ) : null}
            </Card>

            {items.length ? (
              items.map((item) => (
                <ListRow
                  key={item._id}
                  title={item.name}
                  subtitle={`SKU: ${item.sku}\nLocation: ${item.location ?? "-"}`}
                  meta={`Qty: ${item.quantity} (reorder ${item.reorderLevel})`}
                  topRight={
                    item.quantity <= item.reorderLevel ? (
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          backgroundColor: theme.colors.warning,
                          borderWidth: 2,
                          borderColor: theme.colors.surface,
                        }}
                      />
                    ) : null
                  }
                  onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
                />
              ))
            ) : (
              <MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>
            )}
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: theme.spacing.lg + insets.bottom + 156, paddingTop: searchOverlayOpen ? overlaySpace : 0 }}
            data={items}
            keyExtractor={(it) => it._id}
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
                    <Badge label={`Total: ${items.length}`} tone="default" size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Badge label={`Low stock: ${lowStockCount}`} tone={lowStockCount > 0 ? "warning" : "default"} size="header" responsive={false} fullWidth />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" style={{ width: "100%" }} />
                  </View>
                </View>
                {error ? (
                  <View style={{ marginTop: 10 }}>
                    <ErrorText>{error}</ErrorText>
                  </View>
                ) : null}
              </Card>
            }
            ListHeaderComponentStyle={{ marginBottom: 12 }}
            ListEmptyComponent={<MutedText>{q.trim() ? "No matching items" : "No inventory items"}</MutedText>}
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={`SKU: ${item.sku}\nLocation: ${item.location ?? "-"}`}
                meta={`Qty: ${item.quantity} (reorder ${item.reorderLevel})`}
                topRight={
                  item.quantity <= item.reorderLevel ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: theme.colors.warning,
                        borderWidth: 2,
                        borderColor: theme.colors.surface,
                      }}
                    />
                  ) : null
                }
                onPress={() => navigation.navigate("InventoryDetail", { id: item._id })}
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
                    placeholder="Search inventory"
                    autoCapitalize="none"
                    returnKeyType="search"
                    onSubmitEditing={() => setQ((prev) => prev.trim())}
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
