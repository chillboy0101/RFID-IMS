import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  quantity: number;
};

type CartLine = {
  itemId: string;
  name: string;
  sku: string;
  quantity: number;
  quantityText: string;
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrderCreate">;

export function OrderCreateScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const { height } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();

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

  const searchRef = useRef<TextInput>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const autoSearchInitialSkipRef = useRef(true);
  const autoSearchReqIdRef = useRef(0);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showFloatingSearch] = useState(true);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const overlaySearchRef = useRef<TextInput>(null);

  const floatingPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const floatingDraggedRef = useRef(false);
  const floatingStartRef = useRef({ x: 0, y: 0 });

  const buttonSize = 52;
  const floatingMargin = theme.spacing.md;
  const floatingTop = theme.spacing.md + insets.top + 64;
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

  React.useEffect(() => {
    if (!showFloatingSearch) {
      floatingDraggedRef.current = false;
      return;
    }
    if (floatingDraggedRef.current) return;
    floatingPos.setValue({ x: maxX, y: 0 });
  }, [floatingPos, maxX, showFloatingSearch]);

  const openSearchOverlay = useCallback(() => {
    setSearchOverlayOpen(true);
    overlayAnim.setValue(0);
    Animated.timing(overlayAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    setTimeout(() => overlaySearchRef.current?.focus(), 50);
  }, [overlayAnim]);

  const closeSearchOverlay = useCallback(() => {
    Animated.timing(overlayAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setSearchOverlayOpen(false);
    });
  }, [overlayAnim]);

  const loadItems = useCallback(
    async (qOverride?: string) => {
    if (!token) return;
    const q = (qOverride ?? query).trim();
    const path = q ? `/inventory/items?q=${encodeURIComponent(q)}` : "/inventory/items";
    const res = await apiRequest<{ ok: true; items: InventoryItem[] }>(path, { method: "GET", token });
    setItems(res.items);
    },
    [query, token]
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadItems()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [loadItems])
  );

  React.useEffect(() => {
    if (!token) return;

    if (autoSearchInitialSkipRef.current) {
      autoSearchInitialSkipRef.current = false;
      return;
    }

    if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current);

    autoSearchTimerRef.current = setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed !== query) setQuery(trimmed);

      const reqId = ++autoSearchReqIdRef.current;
      setLoading(true);
      loadItems(trimmed)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => {
          if (autoSearchReqIdRef.current === reqId) setLoading(false);
        });
    }, 300);

    return () => {
      if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current);
    };
  }, [loadItems, query, token]);

  const cartTotal = useMemo(() => cart.reduce((sum, l) => sum + l.quantity, 0), [cart]);

  function addToCart(it: InventoryItem) {
    setCart((prev) => {
      const existing = prev.find((p) => p.itemId === it._id);
      if (!existing) return [...prev, { itemId: it._id, name: it.name, sku: it.sku, quantity: 1, quantityText: "1" }];
      return prev.map((p) => {
        if (p.itemId !== it._id) return p;
        const nextQty = (p.quantity || 0) + 1;
        return { ...p, quantity: nextQty, quantityText: String(nextQty) };
      });
    });
  }

  function setLineQty(itemId: string, qtyText: string) {
    const clean = qtyText.replace(/[^0-9]/g, "");
    const qty = clean ? Number(clean) : 0;
    if (!Number.isFinite(qty) || qty < 0) return;
    setCart((prev) => prev.map((p) => (p.itemId === itemId ? { ...p, quantity: qty, quantityText: clean } : p)));
  }

  function removeLine(itemId: string) {
    setCart((prev) => prev.filter((p) => p.itemId !== itemId));
  }

  async function submit() {
    if (!token || submitting) return;
    const validLines = cart.filter((l) => typeof l.quantity === "number" && l.quantity > 0);
    if (!validLines.length) {
      setError("Add at least one item");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body = {
        items: validLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        notes: notes.trim() ? notes.trim() : undefined,
      };

      const res = await apiRequest<{ ok: true; order: { _id: string } }>("/orders", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });

      navigation.replace("OrderDetail", { id: res.order._id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="New order" right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}>
      <BarcodeScanModal
        visible={scanOpen}
        title="Scan barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setQuery(value);
          setScanOpen(false);
          setTimeout(() => {
            if (searchOverlayOpen) overlaySearchRef.current?.focus();
            else searchRef.current?.focus();
          }, 50);
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
            <Card>
              <TextField
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search: name, SKU, barcode, location, RFID tag"
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => setQuery((prev) => prev.trim())}
              />
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" />
                <View style={{ flexGrow: 1 }} />
                <Badge label={`Selected: ${cart.length}`} tone={cart.length ? "primary" : "default"} size="header" />
                <Badge label={`Units: ${cartTotal}`} tone={cartTotal ? "primary" : "default"} size="header" />
              </View>
            </Card>

            <Card style={{ padding: 0 }}>
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
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 3 }]} numberOfLines={1}>
                  Item
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                  SKU
                </Text>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted, width: 120, textAlign: "right" }]} numberOfLines={1}>
                  Available
                </Text>
              </View>

              {isWeb ? (
                <View style={{ padding: theme.spacing.md, gap: 8 }}>
                  {items.length ? (
                    items.map((item) => (
                      <Pressable
                        key={item._id}
                        onPress={() => addToCart(item)}
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
                        <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 3 }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                          {item.sku}
                        </Text>
                        <Text style={{ color: theme.colors.text, width: 120, textAlign: "right", fontWeight: "800" }} numberOfLines={1}>
                          {item.quantity}
                        </Text>
                      </Pressable>
                    ))
                  ) : (
                    <MutedText>No items</MutedText>
                  )}
                </View>
              ) : (
                <FlatList
                  scrollEnabled={false}
                  contentContainerStyle={{ padding: theme.spacing.md, gap: 8 }}
                  data={items}
                  keyExtractor={(i) => i._id}
                  ListEmptyComponent={<MutedText>No items</MutedText>}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => addToCart(item)}
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
                      <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 3 }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[theme.typography.body, { color: theme.colors.textMuted, flex: 2 }]} numberOfLines={1}>
                        {item.sku}
                      </Text>
                      <Text style={{ color: theme.colors.text, width: 120, textAlign: "right", fontWeight: "800" }} numberOfLines={1}>
                        {item.quantity}
                      </Text>
                    </Pressable>
                  )}
                />
              )}
            </Card>
          </View>

          <View style={{ width: 420, gap: theme.spacing.md }}>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Selected items</Text>
              {cart.length ? (
                <View style={{ gap: 10 }}>
                  {cart.map((l) => (
                    <Card key={l.itemId}>
                      <ListRow title={l.name} subtitle={`SKU: ${l.sku}`} right={<Badge label={`x${l.quantity || 0}`} tone="primary" />} />
                      <View style={{ height: 10 }} />
                      <TextField
                        label="Quantity"
                        value={l.quantityText}
                        onChangeText={(t) => setLineQty(l.itemId, t)}
                        keyboardType="numeric"
                      />
                      <View style={{ height: 10 }} />
                      <AppButton title="Remove item" onPress={() => removeLine(l.itemId)} variant="secondary" />
                    </Card>
                  ))}
                </View>
              ) : (
                <MutedText>No items selected yet</MutedText>
              )}
            </Card>

            <Card>
              <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline numberOfLines={3} />
              <View style={{ height: 16 }} />
              <AppButton title="Create order" onPress={submit} disabled={submitting} loading={submitting} />
            </Card>
          </View>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg + insets.bottom + 156 }}
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <Badge label={`Selected: ${cart.length}`} tone={cart.length ? "primary" : "default"} size="header" responsive={false} />
              <Badge label={`Total units: ${cartTotal}`} tone={cartTotal ? "primary" : "default"} size="header" responsive={false} />
            </View>
            <MutedText style={{ marginTop: 8 }}>Use the search button to add inventory items.</MutedText>
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Selected items</Text>
            {cart.length ? (
              <View style={{ gap: 10 }}>
                {cart.map((l) => (
                  <Card key={l.itemId}>
                    <ListRow title={l.name} subtitle={`SKU: ${l.sku}`} right={<Badge label={`x${l.quantity || 0}`} tone="primary" />} />
                    <View style={{ height: 10 }} />
                    <TextField
                      label="Quantity"
                      value={l.quantityText}
                      onChangeText={(t) => setLineQty(l.itemId, t)}
                      keyboardType="numeric"
                    />
                    <View style={{ height: 10 }} />
                    <AppButton title="Remove item" onPress={() => removeLine(l.itemId)} variant="secondary" />
                  </Card>
                ))}
              </View>
            ) : (
              <MutedText>No items selected yet</MutedText>
            )}
          </Card>

          <Card>
            <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline numberOfLines={3} />
            <View style={{ height: 16 }} />
            <AppButton title="Create order" onPress={submit} disabled={submitting} loading={submitting} />
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Inventory</Text>
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {items.map((item) => (
                  <ListRow
                    key={item._id}
                    title={item.name}
                    subtitle={`SKU: ${item.sku}`}
                    meta={`Available: ${item.quantity}`}
                    right={<Badge label="Add" tone="primary" />}
                    onPress={() => addToCart(item)}
                  />
                ))}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={items}
                keyExtractor={(i) => i._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                renderItem={({ item }) => (
                  <ListRow
                    title={item.name}
                    subtitle={`SKU: ${item.sku}`}
                    meta={`Available: ${item.quantity}`}
                    right={<Badge label="Add" tone="primary" />}
                    onPress={() => addToCart(item)}
                  />
                )}
              />
            )}
          </Card>
        </ScrollView>
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
                    outputRange: [-180, 0],
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
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search inventory"
                    autoCapitalize="none"
                    returnKeyType="search"
                    onSubmitEditing={() => setQuery((prev) => prev.trim())}
                  />
                </View>
                <AppButton title="Close" iconName="close" iconOnly variant="secondary" onPress={closeSearchOverlay} />
              </View>
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <AppButton title="Scan" onPress={() => setScanOpen(true)} variant="secondary" />
                {loading ? <MutedText>Searching…</MutedText> : null}
              </View>
            </Card>
          </Animated.View>
        </View>
      ) : null}
    </Screen>
  );
}
