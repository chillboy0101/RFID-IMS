import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Animated, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { OrdersStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, Card, ErrorText, MutedText, Screen, shadow, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  location?: string;
  quantity: number;
  flow?: {
    trackedUnits: number;
    untrackedUnits: number;
    awaitingTagUnits: number;
    taggedUnits: number;
    reservedUnits: number;
    pickedUnits: number;
    dispatchedUnits: number;
    activeExitAuthorizations: number;
    barcodeReady: boolean;
    exitReadyUnits: number;
    missingExitTrackingUnits: number;
    nextStep: string;
  };
};

type CartLine = {
  itemId: string;
  name: string;
  sku: string;
  location?: string;
  quantity: number;
  available: number;
};

type Props = NativeStackScreenProps<OrdersStackParamList, "OrderCreate">;

const DESKTOP_SKU_WIDTH = 154;
const DESKTOP_LOCATION_WIDTH = 122;
const DESKTOP_AVAILABLE_WIDTH = 72;

function buildCartLine(item: InventoryItem, quantity: number): CartLine {
  return {
    itemId: item._id,
    name: item.name,
    sku: item.sku,
    location: item.location,
    quantity,
    available: item.quantity,
  };
}

function ribbonMetric(value: number, label: string) {
  return `${value} ${label}`;
}

function SearchDock({
  inputRef,
  value,
  onChangeText,
  onScan,
  loading,
  placeholder,
}: {
  inputRef?: React.RefObject<TextInput | null>;
  value: string;
  onChangeText: (value: string) => void;
  onScan: () => void;
  loading?: boolean;
  placeholder: string;
}) {
  return (
    <View
      style={{
        minHeight: 54,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        borderRadius: theme.radius.sm,
        paddingLeft: 12,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
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
          minHeight: 48,
          color: theme.colors.text,
          fontSize: 15,
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
        }}
      />
      {loading ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : null}
      <Pressable
        onPress={onScan}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surface : theme.colors.surface,
          alignItems: "center",
          justifyContent: "center",
        })}
      >
        <Ionicons name="barcode-outline" size={18} color={theme.colors.textMuted} />
      </Pressable>
    </View>
  );
}

function QuantityStepper({
  value,
  onIncrease,
  onDecrease,
  canIncrease,
  compact,
}: {
  value: number;
  onIncrease: () => void;
  onDecrease: () => void;
  canIncrease: boolean;
  compact?: boolean;
}) {
  const height = compact ? 40 : 44;
  const buttonWidth = compact ? 40 : 42;
  const countWidth = compact ? 34 : 38;

  return (
    <View
      style={{
        height,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        borderRadius: 14,
        overflow: "hidden",
        flexDirection: "row",
        alignItems: "stretch",
      }}
    >
      <Pressable
        onPress={onDecrease}
        disabled={value <= 0}
        style={({ pressed }) => ({
          width: buttonWidth,
          alignItems: "center",
          justifyContent: "center",
          borderRightWidth: 1,
          borderRightColor: theme.colors.border,
          opacity: value <= 0 ? 0.35 : 1,
          backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
        })}
      >
        <Ionicons name="remove" size={16} color={theme.colors.text} />
      </Pressable>
      <View style={{ width: countWidth, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: compact ? 13 : 14 }}>{value}</Text>
      </View>
      <Pressable
        onPress={onIncrease}
        disabled={!canIncrease}
        style={({ pressed }) => ({
          width: buttonWidth,
          alignItems: "center",
          justifyContent: "center",
          borderLeftWidth: 1,
          borderLeftColor: theme.colors.border,
          opacity: canIncrease ? 1 : 0.35,
          backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
        })}
      >
        <Ionicons name="add" size={16} color={theme.colors.text} />
      </Pressable>
    </View>
  );
}

function GhostNotesField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>Order notes</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={{
          minHeight: 110,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 14,
          paddingVertical: 14,
          color: theme.colors.text,
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
        }}
      />
    </View>
  );
}


export function OrderCreateScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 1100;
  const insets = useSafeAreaInsets();
  const mobileOverlayBottom = Platform.OS === "web" ? 92 : Math.max(28, 68 - insets.bottom);

  const searchRef = useRef<TextInput>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const autoSearchInitialSkipRef = useRef(true);
  const autoSearchReqIdRef = useRef(0);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

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

  const openRfidHub = useCallback(() => {
    const parent = navigation.getParent();
    (parent as any)?.navigate?.("More", { screen: "RfidHub" });
  }, [navigation]);

  const loadItems = useCallback(
    async (queryValue?: string) => {
      if (!token) return;
      const trimmed = (queryValue ?? query).trim();
      const path = trimmed ? `/inventory/items?q=${encodeURIComponent(trimmed)}` : "/inventory/items";
      const res = await apiRequest<{ ok: true; items: InventoryItem[] }>(path, { method: "GET", token });
      setItems(res.items);
    },
    [query, token]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      loadItems()
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [loadItems])
  );

  useEffect(() => {
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
    }, 260);

    return () => {
      if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current);
    };
  }, [loadItems, query, token]);

  useEffect(() => {
    if (!items.length) return;
    setCart((prev) =>
      prev.map((line) => {
        const match = items.find((item) => item._id === line.itemId);
        return match ? buildCartLine(match, line.quantity) : line;
      })
    );
  }, [items]);

  useEffect(() => {
    if (cart.length === 0 && summaryOpen) {
      sheetAnim.setValue(0);
      setSummaryOpen(false);
    }
  }, [cart.length, summaryOpen, sheetAnim]);

  const selectedQtyMap = useMemo(() => new Map(cart.map((line) => [line.itemId, line.quantity])), [cart]);
  const selectedItemCount = cart.length;
  const totalUnits = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  const updateLine = useCallback((item: InventoryItem, nextQuantity: number) => {
    const cappedQuantity = Math.max(0, Math.min(item.quantity, nextQuantity));

    setCart((prev) => {
      const existing = prev.find((line) => line.itemId === item._id);

      if (cappedQuantity <= 0) {
        return prev.filter((line) => line.itemId !== item._id);
      }

      if (!existing) {
        return [...prev, buildCartLine(item, cappedQuantity)];
      }

      return prev.map((line) => (line.itemId === item._id ? buildCartLine(item, cappedQuantity) : line));
    });
  }, []);

  const incrementLine = useCallback(
    (item: InventoryItem) => {
      const currentQty = selectedQtyMap.get(item._id) ?? 0;
      updateLine(item, currentQty + 1);
    },
    [selectedQtyMap, updateLine]
  );

  const decrementLine = useCallback(
    (item: InventoryItem) => {
      const currentQty = selectedQtyMap.get(item._id) ?? 0;
      updateLine(item, currentQty - 1);
    },
    [selectedQtyMap, updateLine]
  );

  const openSummarySheet = useCallback(() => {
    setSummaryOpen(true);
    sheetAnim.setValue(0);
    Animated.timing(sheetAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [sheetAnim]);

  const closeSummarySheet = useCallback(() => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSummaryOpen(false);
    });
  }, [sheetAnim]);

  const selectFromList = useCallback(
    (item: InventoryItem) => {
      const currentQty = selectedQtyMap.get(item._id) ?? 0;
      if (currentQty > 0) {
        if (!isDesktopWeb) openSummarySheet();
        return;
      }
      updateLine(item, 1);
    },
    [isDesktopWeb, openSummarySheet, selectedQtyMap, updateLine]
  );

  async function submit() {
    if (!token || submitting) return;

    const validLines = cart.filter((line) => line.quantity > 0);
    if (!validLines.length) {
      setError("Add at least one item");
      return;
    }
    if (validLines.some((line) => line.quantity > line.available)) {
      setError("One or more selected items exceed available stock.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body = {
        items: validLines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
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

  const renderDesktopRow = (item: InventoryItem) => {
    const selectedQty = selectedQtyMap.get(item._id) ?? 0;
    const selected = selectedQty > 0;
    return (
      <Pressable
        key={item._id}
        onPress={() => selectFromList(item)}
        style={({ pressed }) => ({
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: selected
            ? "rgba(34, 197, 94, 0.08)"
            : pressed
              ? theme.colors.surface2
              : theme.colors.surface,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text, lineHeight: 20 }]} numberOfLines={3}>
            {item.name}
          </Text>
          {selected ? (
            <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "rgba(34, 197, 94, 0.14)",
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: "800" }}>{`Added${selectedQty > 1 ? ` · ${selectedQty}` : ""}`}</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ width: DESKTOP_SKU_WIDTH, flexShrink: 0 }}>
          <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
            {item.sku}
          </Text>
        </View>

        <View style={{ width: DESKTOP_LOCATION_WIDTH, flexShrink: 0 }}>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {item.location ?? "-"}
          </Text>
        </View>

        <View style={{ width: DESKTOP_AVAILABLE_WIDTH, flexShrink: 0 }}>
          <Text style={{ color: theme.colors.text, textAlign: "right", fontWeight: "800" }}>{item.quantity}</Text>
        </View>
      </Pressable>
    );
  };

  const renderMobileCard = (item: InventoryItem) => {
    const selectedQty = selectedQtyMap.get(item._id) ?? 0;
    const selected = selectedQty > 0;

    return (
      <Pressable
        key={item._id}
        onPress={() => selectFromList(item)}
        style={({ pressed }) => ({
          borderColor: selected ? "rgba(34, 197, 94, 0.28)" : theme.colors.border,
          backgroundColor: selected
            ? "rgba(34, 197, 94, 0.05)"
            : pressed
              ? theme.colors.surface2
              : theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          padding: theme.spacing.md,
        })}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text, lineHeight: 20 }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 6 }]} numberOfLines={1}>
                {`SKU: ${item.sku}`}
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
                {`Location: ${item.location ?? "-"}`}
              </Text>
            </View>
            <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>{item.quantity}</Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: "800" }}>{`Available ${item.quantity}`}</Text>
              </View>
              {selected ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: "rgba(34, 197, 94, 0.14)",
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: "800" }}>{`Added${selectedQty > 1 ? ` · ${selectedQty}` : ""}`}</Text>
                </View>
              ) : null}
            </View>
            {!selected ? <MutedText>Tap to add</MutedText> : <MutedText>Open summary to edit qty</MutedText>}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderSummaryLine = (line: CartLine, compact?: boolean) => {
    const sourceItem = items.find((item) => item._id === line.itemId);
    const displayItem: InventoryItem =
      sourceItem ??
      ({
        _id: line.itemId,
        name: line.name,
        sku: line.sku,
        location: line.location,
        quantity: line.available,
      } as InventoryItem);

    return (
      <View
        key={line.itemId}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.sm,
          padding: 12,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text, lineHeight: 20 }]} numberOfLines={2}>
              {line.name}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
              {`${line.sku} | ${line.location || "-"}`}
            </Text>
          </View>
          <QuantityStepper
            compact={compact}
            value={line.quantity}
            onIncrease={() => incrementLine(displayItem)}
            onDecrease={() => decrementLine(displayItem)}
            canIncrease={line.quantity < line.available}
          />
        </View>
      </View>
    );
  };

  const desktopSummary = (
    <Card style={{ flex: 1, padding: 0, minHeight: 0 }}>
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>Order summary</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.md, gap: 12 }}>
        {cart.length ? (
          <View style={{ gap: 10 }}>
            {cart.map((line) => renderSummaryLine(line))}
          </View>
        ) : (
          <View
            style={{
              minHeight: 180,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderStyle: "dashed",
              borderRadius: theme.radius.md,
              alignItems: "center",
              justifyContent: "center",
              padding: theme.spacing.lg,
            }}
          >
            <Text style={[theme.typography.h2, { color: theme.colors.textMuted }]}>No items added yet</Text>
            <MutedText style={{ marginTop: 8, textAlign: "center" }}>Add products from the list and the cart will build here live.</MutedText>
          </View>
        )}

        <GhostNotesField value={notes} onChangeText={setNotes} placeholder="Order notes (optional)..." />
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          padding: theme.spacing.md,
        }}
      >
        <AppButton title="Create order" onPress={submit} disabled={!totalUnits || submitting} loading={submitting} />
      </View>
    </Card>
  );

  const mobileFab = cart.length ? (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: theme.spacing.md,
        right: theme.spacing.md,
        bottom: mobileOverlayBottom,
      }}
    >
      <Pressable
        onPress={openSummarySheet}
        style={({ pressed }) => [
          {
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceGlass,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.95 : 1,
          },
          shadow(2),
        ]}
      >
        <View>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{`View order (${selectedItemCount})`}</Text>
          <MutedText>{`${totalUnits} units selected`}</MutedText>
        </View>
        <Ionicons name="chevron-up" size={18} color={theme.colors.textMuted} />
      </Pressable>
    </View>
  ) : null;

  const desktopContent = (
    <View style={{ flex: 1, flexDirection: "row", gap: theme.spacing.md, minHeight: 0 }}>
      <Card style={{ flex: 1, padding: 0, minHeight: 0 }}>
        <View
          style={{
            padding: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <SearchDock
                inputRef={searchRef}
                value={query}
                onChangeText={setQuery}
                onScan={() => setScanOpen(true)}
                loading={loading}
                placeholder="Search by name, SKU, barcode, location"
              />
            </View>
          </View>
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
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
              {ribbonMetric(selectedItemCount, "items selected")}
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {ribbonMetric(totalUnits, "units total")}
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]} numberOfLines={1}>
              Tap a line to add it
            </Text>
            {loading ? <MutedText>Updating inventory...</MutedText> : null}
          </View>
          <AppButton title="RFID Hub" onPress={openRfidHub} variant="secondary" iconName="radio-outline" />
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
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
          <View style={{ width: DESKTOP_SKU_WIDTH, flexShrink: 0 }}>
            <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
              SKU
            </Text>
          </View>
          <View style={{ width: DESKTOP_LOCATION_WIDTH, flexShrink: 0 }}>
            <Text style={[theme.typography.label, { color: theme.colors.textMuted }]} numberOfLines={1}>
              Location
            </Text>
          </View>
          <View style={{ width: DESKTOP_AVAILABLE_WIDTH, flexShrink: 0 }}>
            <Text style={[theme.typography.label, { color: theme.colors.textMuted, textAlign: "right" }]} numberOfLines={1}>
              Available
            </Text>
          </View>
        </View>

        {error ? (
          <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }}>
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {items.length ? (
            items.map((item) => renderDesktopRow(item))
          ) : (
            <View style={{ padding: theme.spacing.lg }}>
              <MutedText>{query.trim() ? "No matching inventory items" : "No inventory items available"}</MutedText>
            </View>
          )}
        </ScrollView>
      </Card>

      <View style={{ width: width >= 1320 ? 320 : 288, minHeight: 0 }}>{desktopSummary}</View>
    </View>
  );

  const mobileContent = (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: theme.spacing.md,
          paddingBottom: cart.length ? 172 + insets.bottom : 112 + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ErrorText>{error}</ErrorText> : null}

        <Card>
          <View style={{ gap: 12 }}>
            <SearchDock
              inputRef={searchRef}
              value={query}
              onChangeText={setQuery}
              onScan={() => setScanOpen(true)}
              loading={loading}
              placeholder="Search by name, SKU, barcode"
            />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <MutedText>{loading ? "Updating inventory..." : "Tap an item to add it"}</MutedText>
              {selectedItemCount ? <Badge label={`${selectedItemCount} added`} tone="success" /> : null}
            </View>
          </View>
        </Card>

        {items.length ? (
          items.map((item) => renderMobileCard(item))
        ) : (
          <Card>
            <MutedText>{query.trim() ? "No matching inventory items" : "No inventory items available"}</MutedText>
          </Card>
        )}
      </ScrollView>

      {mobileFab}

      <Modal transparent visible={summaryOpen} animationType="none" onRequestClose={closeSummarySheet}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            onPress={closeSummarySheet}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.28)",
            }}
          />

          <Animated.View
            style={{
              maxHeight: "78%",
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: theme.colors.border,
              transform: [
                {
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [420, 0],
                  }),
                },
              ],
            }}
          >
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 48, height: 5, borderRadius: 999, backgroundColor: theme.colors.border }} />
            </View>

            <View
              style={{
                paddingHorizontal: theme.spacing.md,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View>
                <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Order summary</Text>
              </View>
              <AppButton title="RFID Hub" onPress={openRfidHub} variant="secondary" iconName="radio-outline" />
            </View>

            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: theme.spacing.md, gap: 12 }}>
              <View style={{ gap: 10 }}>{cart.map((line) => renderSummaryLine(line, true))}</View>
              <GhostNotesField value={notes} onChangeText={setNotes} placeholder="Order notes (optional)..." />
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                paddingHorizontal: theme.spacing.md,
                paddingTop: 12,
                paddingBottom: insets.bottom + 12,
              }}
            >
              <AppButton title="Create order" onPress={submit} disabled={!totalUnits || submitting} loading={submitting} />
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );

  return (
    <Screen
      title="New order"
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
      scroll={false}
      tabBarPadding={isDesktopWeb}
    >
      <BarcodeScanModal
        visible={scanOpen}
        title="Scan barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setQuery(value);
          setScanOpen(false);
          setTimeout(() => searchRef.current?.focus(), 40);
        }}
      />
      {isDesktopWeb ? desktopContent : mobileContent}
    </Screen>
  );
}
