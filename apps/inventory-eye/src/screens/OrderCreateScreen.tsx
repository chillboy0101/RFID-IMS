import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

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
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";

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

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    <Screen title="New order" scroll right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
            <Card>
              <TextField
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search: name, SKU, location, RFID tag"
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => {
                  const trimmed = query.trim();
                  setQuery(trimmed);
                  loadItems(trimmed).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
                }}
              />
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <AppButton title="Scan RFID" onPress={() => searchRef.current?.focus()} variant="secondary" />
                <AppButton
                  title={loading ? "Searching..." : "Search"}
                  onPress={() => loadItems().catch((e) => setError(e instanceof Error ? e.message : "Failed"))}
                  variant="secondary"
                  disabled={loading}
                />
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
              <AppButton title={submitting ? "Creating..." : "Create order"} onPress={submit} disabled={submitting} loading={submitting} />
            </Card>
          </View>
        </View>
      ) : (
        <>
          <Card>
            <TextField
              ref={searchRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Name, SKU, location, RFID tag"
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => {
                const trimmed = query.trim();
                setQuery(trimmed);
                loadItems(trimmed).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
              }}
            />
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <AppButton title="Scan RFID" onPress={() => searchRef.current?.focus()} variant="secondary" />
              <AppButton
                title={loading ? "Searching..." : "Search"}
                onPress={() => loadItems().catch((e) => setError(e instanceof Error ? e.message : "Failed"))}
                variant="secondary"
                disabled={loading}
              />
              <Badge label={`Selected: ${cart.length}`} tone={cart.length ? "primary" : "default"} size="header" responsive={false} />
              <Badge label={`Total units: ${cartTotal}`} tone={cartTotal ? "primary" : "default"} size="header" responsive={false} />
            </View>
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
            <AppButton title={submitting ? "Creating..." : "Create order"} onPress={submit} disabled={submitting} loading={submitting} />
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
        </>
      )}
    </Screen>
  );
}
