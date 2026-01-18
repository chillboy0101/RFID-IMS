import React, { useCallback, useContext, useRef, useState } from "react";
import { Alert, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

declare const require: undefined | ((id: string) => any);

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  description?: string;
  location?: string;
  quantity: number;
  reorderLevel: number;
  expiryDate?: string | null;
  rfidTagId?: string;
  vendorId?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
};

type Response = { ok: true; item: InventoryItem };

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryDetail">;

export function InventoryDetailScreen({ navigation, route }: Props) {
  const { token, user } = useContext(AuthContext);
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    if (isDesktopWeb) {
      navigation.navigate("InventoryList");
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("InventoryList");
  }, [isDesktopWeb, navigation]);

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<Response>(`/inventory/items/${id}`, { method: "GET", token });
    setItem(res.item);
  }, [id, token]);

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
        loadSafe(true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [loadSafe])
  );

  const canDelete = user?.role === "manager" || user?.role === "admin";

  const isLowStock = typeof item?.quantity === "number" && typeof item?.reorderLevel === "number" && item.quantity <= item.reorderLevel;
  const expiryLabel = item?.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : "-";

  const itemIdValue = item?._id ?? "";
  const rfidValue = item?.rfidTagId ?? "";
  const vendorValue = item?.vendorId ?? "";

  const [copiedKey, setCopiedKey] = useState<"" | "item" | "rfid" | "vendor">("");
  const copiedTimerRef = useRef<any>(null);

  async function copyText(value: string) {
    if (!value || value === "-") return;
    try {
      if (Platform.OS === "web") {
        const navAny = (globalThis as any)?.navigator;
        if (navAny?.clipboard?.writeText) {
          await navAny.clipboard.writeText(value);
          return;
        }
      }

      const expoClipboard = (() => {
        try {
          if (typeof require !== "function") return null;
          return require("expo-clipboard") as { setStringAsync: (t: string) => Promise<void> };
        } catch {
          return null;
        }
      })();

      if (expoClipboard?.setStringAsync) {
        await expoClipboard.setStringAsync(value);
      }
    } catch {
      // ignore
    }
  }

  function copyWithFeedback(key: "item" | "rfid" | "vendor", value: string) {
    void copyText(value);
    setCopiedKey(key);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedKey(""), 900);
  }

  async function onDelete() {
    if (!token || !canDelete) return;

    Alert.alert("Delete item", "Are you sure you want to delete this item?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiRequest<{ ok: true }>(`/inventory/items/${id}`, { method: "DELETE", token });
            navigation.goBack();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed");
          }
        },
      },
    ]);
  }

  return (
    <Screen
      title="Item"
      busy={loading || updating}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
      scroll
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={2}>
                    {item?.name ?? "-"}
                  </Text>
                  <MutedText style={{ marginTop: 6 }}>SKU: {item?.sku ?? "-"}</MutedText>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "nowrap" }}>
                  <Badge label={item?.status ?? "active"} tone={(item?.status ?? "active") === "inactive" ? "warning" : "success"} size="header" />
                  <Badge label={isLowStock ? "Low stock" : "In stock"} tone={isLowStock ? "warning" : "success"} size="header" />
                </View>
              </View>

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <View
                  style={{
                    flexGrow: 1,
                    minWidth: 180,
                    padding: 12,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Quantity</Text>
                  <Text style={{ color: isLowStock ? theme.colors.warning : theme.colors.text, fontSize: 28, fontWeight: "900", marginTop: 6 }}>
                    {typeof item?.quantity === "number" ? item.quantity : "-"}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, marginTop: 6, fontWeight: "700" }}>
                    Reorder at {typeof item?.reorderLevel === "number" ? item.reorderLevel : "-"}
                  </Text>
                </View>

                <View
                  style={{
                    flexGrow: 1,
                    minWidth: 180,
                    padding: 12,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Location</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "900", marginTop: 8 }} numberOfLines={2}>
                    {item?.location ?? "-"}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, marginTop: 10, fontWeight: "700" }}>
                    Expiry {expiryLabel}
                  </Text>
                </View>
              </View>

              {item?.description ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Description</Text>
                  <Text style={{ color: theme.colors.textMuted, marginTop: 6 }}>{item.description}</Text>
                </View>
              ) : null}
            </Card>

            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Details</Text>
              <View style={{ gap: 10 }}>
                <ListRow
                  title="Item ID"
                  subtitle={item?._id ?? "-"}
                  right={
                    itemIdValue ? (
                      <Ionicons
                        name={copiedKey === "item" ? "checkmark-circle" : "copy-outline"}
                        size={18}
                        color={copiedKey === "item" ? theme.colors.success : theme.colors.textMuted}
                      />
                    ) : null
                  }
                  onPress={itemIdValue ? () => copyWithFeedback("item", itemIdValue) : undefined}
                />
                <ListRow
                  title="RFID tag"
                  subtitle={item?.rfidTagId ?? "-"}
                  right={
                    rfidValue ? (
                      <Ionicons
                        name={copiedKey === "rfid" ? "checkmark-circle" : "copy-outline"}
                        size={18}
                        color={copiedKey === "rfid" ? theme.colors.success : theme.colors.textMuted}
                      />
                    ) : null
                  }
                  onPress={rfidValue ? () => copyWithFeedback("rfid", rfidValue) : undefined}
                />
                <ListRow
                  title="Vendor ID"
                  subtitle={item?.vendorId ?? "-"}
                  right={
                    vendorValue ? (
                      <Ionicons
                        name={copiedKey === "vendor" ? "checkmark-circle" : "copy-outline"}
                        size={18}
                        color={copiedKey === "vendor" ? theme.colors.success : theme.colors.textMuted}
                      />
                    ) : null
                  }
                  onPress={vendorValue ? () => copyWithFeedback("vendor", vendorValue) : undefined}
                />
                <ListRow title="Expiry" subtitle={expiryLabel} />
                <ListRow title="Last updated" subtitle={item?.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"} />
                <ListRow title="Created" subtitle={item?.createdAt ? new Date(item.createdAt).toLocaleString() : "-"} />
              </View>
            </Card>
          </View>

          <View style={{ width: 380, gap: theme.spacing.md }}>
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>

              <View style={{ gap: 10 }}>
                <ListRow title="Edit" subtitle="Update item details" onPress={() => navigation.navigate("InventoryEdit", { id })} />
                <ListRow title="Adjust quantity" subtitle="Add or remove units" onPress={() => navigation.navigate("InventoryAdjust", { id })} />
                <ListRow title="View logs" subtitle="Audit trail for this item" onPress={() => navigation.navigate("InventoryLogs", { id })} />
              </View>

              <View style={{ height: 12 }} />
              <AppButton title="Delete" onPress={onDelete} variant="danger" disabled={!canDelete} />
              {!canDelete ? <MutedText style={{ marginTop: 8 }}>Delete requires manager/admin</MutedText> : null}
            </Card>
          </View>
        </View>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={2}>
                  {item?.name ?? "-"}
                </Text>
                <MutedText style={{ marginTop: 6 }}>SKU: {item?.sku ?? "-"}</MutedText>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "nowrap" }}>
                <Badge label={item?.status ?? "active"} tone={(item?.status ?? "active") === "inactive" ? "warning" : "success"} size="header" />
                <Badge label={isLowStock ? "Low stock" : "In stock"} tone={isLowStock ? "warning" : "success"} size="header" />
              </View>
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
              <View
                style={{
                  flexGrow: 1,
                  minWidth: 180,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Quantity</Text>
                <Text style={{ color: isLowStock ? theme.colors.warning : theme.colors.text, fontSize: 28, fontWeight: "900", marginTop: 6 }}>
                  {typeof item?.quantity === "number" ? item.quantity : "-"}
                </Text>
                <Text style={{ color: theme.colors.textMuted, marginTop: 6, fontWeight: "700" }}>
                  Reorder at {typeof item?.reorderLevel === "number" ? item.reorderLevel : "-"}
                </Text>
              </View>

              <View
                style={{
                  flexGrow: 1,
                  minWidth: 180,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Location</Text>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "900", marginTop: 8 }} numberOfLines={2}>
                  {item?.location ?? "-"}
                </Text>
                <Text style={{ color: theme.colors.textMuted, marginTop: 10, fontWeight: "700" }}>
                  Expiry {expiryLabel}
                </Text>
              </View>
            </View>

            <View style={{ height: 12 }} />

            {item?.description ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Description</Text>
                <Text style={{ color: theme.colors.textMuted, marginTop: 6 }}>{item.description}</Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Details</Text>
            <View style={{ gap: 10 }}>
              <ListRow
                title="Item ID"
                subtitle={item?._id ?? "-"}
                right={
                  itemIdValue ? (
                    <Ionicons
                      name={copiedKey === "item" ? "checkmark-circle" : "copy-outline"}
                      size={18}
                      color={copiedKey === "item" ? theme.colors.success : theme.colors.textMuted}
                    />
                  ) : null
                }
                onPress={itemIdValue ? () => copyWithFeedback("item", itemIdValue) : undefined}
              />
              <ListRow
                title="RFID tag"
                subtitle={item?.rfidTagId ?? "-"}
                right={
                  rfidValue ? (
                    <Ionicons
                      name={copiedKey === "rfid" ? "checkmark-circle" : "copy-outline"}
                      size={18}
                      color={copiedKey === "rfid" ? theme.colors.success : theme.colors.textMuted}
                    />
                  ) : null
                }
                onPress={rfidValue ? () => copyWithFeedback("rfid", rfidValue) : undefined}
              />
              <ListRow
                title="Vendor ID"
                subtitle={item?.vendorId ?? "-"}
                right={
                  vendorValue ? (
                    <Ionicons
                      name={copiedKey === "vendor" ? "checkmark-circle" : "copy-outline"}
                      size={18}
                      color={copiedKey === "vendor" ? theme.colors.success : theme.colors.textMuted}
                    />
                  ) : null
                }
                onPress={vendorValue ? () => copyWithFeedback("vendor", vendorValue) : undefined}
              />
              <ListRow title="Expiry" subtitle={expiryLabel} />
            </View>
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Actions</Text>

            <View style={{ gap: 10 }}>
              <ListRow title="Edit" subtitle="Update item details" onPress={() => navigation.navigate("InventoryEdit", { id })} />
              <ListRow title="Adjust quantity" subtitle="Add or remove units" onPress={() => navigation.navigate("InventoryAdjust", { id })} />
              <ListRow title="View logs" subtitle="Audit trail for this item" onPress={() => navigation.navigate("InventoryLogs", { id })} />
            </View>

            <View style={{ height: 12 }} />
            <AppButton title="Delete" onPress={onDelete} variant="danger" disabled={!canDelete} />
            {!canDelete ? <MutedText style={{ marginTop: 8 }}>Delete requires manager/admin</MutedText> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}
