import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

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
};

type GetResponse = { ok: true; item: InventoryItem };

type Vendor = {
  _id: string;
  name: string;
};

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryEdit" | "InventoryCreate">;

export function InventoryEditScreen({ navigation, route }: Props) {
  const { token } = useContext(AuthContext);
  const routeId = route.params?.id;
  const id = routeId && routeId !== "undefined" ? routeId : undefined;
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    if (isDesktopWeb) {
      if (id) {
        navigation.navigate("InventoryDetail", { id });
        return;
      }
      navigation.navigate("InventoryList");
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (id) {
      navigation.navigate("InventoryDetail", { id });
      return;
    }
    navigation.navigate("InventoryList");
  }, [id, isDesktopWeb, navigation]);

  const rfidRef = useRef<TextInput>(null);

  const DateTimePicker = useMemo(() => {
    if (Platform.OS === "web") return null as any;
    try {
      if (typeof require !== "function") return null as any;
      const mod = require("@react-native-community/datetimepicker");
      return (mod?.default ?? mod) as any;
    } catch {
      return null as any;
    }
  }, []);

  function formatDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseDate(value: string) {
    const t = value.trim();
    if (!t) return null;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [expiryDate, setExpiryDate] = useState("");
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);
  const [rfidTagId, setRfidTagId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [status, setStatus] = useState("active");
  const [showValidation, setShowValidation] = useState(false);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const initialRef = useRef<InventoryItem | null>(null);

  const title = id ? "Edit item" : "New item";

  const nameError = showValidation && !name.trim() ? "Name is required" : undefined;
  const skuError = showValidation && !sku.trim() ? "SKU is required" : undefined;

  const quantityError = useMemo(() => {
    if (!showValidation) return undefined;
    const q = Number(quantity);
    if (!Number.isFinite(q)) return "Quantity must be a number";
    if (q < 0) return "Quantity cannot be negative";
    return undefined;
  }, [quantity, showValidation]);

  const reorderError = useMemo(() => {
    if (!showValidation) return undefined;
    if (!reorderLevel.trim()) return undefined;
    const r = Number(reorderLevel);
    if (!Number.isFinite(r)) return "Reorder level must be a number";
    if (r < 0) return "Reorder level cannot be negative";
    return undefined;
  }, [reorderLevel, showValidation]);

  const expiryError = useMemo(() => {
    if (!showValidation) return undefined;
    const t = expiryDate.trim();
    if (!t) return undefined;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "Expiry date is invalid";
    return undefined;
  }, [expiryDate, showValidation]);

  const canSubmit = useMemo(() => {
    if (!name.trim() || !sku.trim()) return false;
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) return false;
    const r = reorderLevel.trim() ? Number(reorderLevel) : 0;
    if (!Number.isFinite(r) || r < 0) return false;
    if (expiryDate.trim()) {
      const d = new Date(expiryDate.trim());
      if (Number.isNaN(d.getTime())) return false;
    }
    return true;
  }, [name, sku, quantity, reorderLevel, expiryDate]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    const res = await apiRequest<GetResponse>(`/inventory/items/${id}`, { method: "GET", token });
    const it = res.item;
    initialRef.current = it;
    setName(it.name ?? "");
    setSku(it.sku ?? "");
    setDescription(it.description ?? "");
    setLocation(it.location ?? "");
    setQuantity(String(it.quantity ?? 0));
    setReorderLevel(String(it.reorderLevel ?? 0));
    setExpiryDate(it.expiryDate ? new Date(it.expiryDate).toISOString().slice(0, 10) : "");
    setRfidTagId(it.rfidTagId ?? "");
    setVendorId(it.vendorId ?? "");
    setStatus(it.status ?? "active");
  }, [id, token]);

  const hasChanges = useMemo(() => {
    if (!id) return true;
    const it = initialRef.current;
    if (!it) return false;

    const nowExpiry = expiryDate.trim();
    const itExpiry = it.expiryDate ? new Date(it.expiryDate).toISOString().slice(0, 10) : "";

    const nowReorder = reorderLevel.trim() ? Number(reorderLevel) : 0;
    const itReorder = typeof it.reorderLevel === "number" ? it.reorderLevel : 0;

    const nowQty = Number(quantity);
    const itQty = typeof it.quantity === "number" ? it.quantity : 0;

    const nowStatus = (status.trim() || "active").toLowerCase();
    const itStatus = (it.status ?? "active").toLowerCase();

    return (
      name.trim() !== (it.name ?? "").trim() ||
      sku.trim() !== (it.sku ?? "").trim() ||
      description.trim() !== (it.description ?? "").trim() ||
      location.trim() !== (it.location ?? "").trim() ||
      nowQty !== itQty ||
      nowReorder !== itReorder ||
      nowExpiry !== itExpiry ||
      rfidTagId.trim() !== (it.rfidTagId ?? "").trim() ||
      vendorId.trim() !== (it.vendorId ?? "").trim() ||
      nowStatus !== itStatus
    );
  }, [description, expiryDate, id, location, name, quantity, reorderLevel, rfidTagId, sku, status, vendorId]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [id, load])
  );

  const loadVendors = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<{ ok: true; vendors: Vendor[] }>("/vendors", { method: "GET", token });
      setVendors(res.vendors.map((v) => ({ _id: v._id, name: v.name })));
    } catch {
      // ignore
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVendors().catch(() => undefined);
    }, [loadVendors])
  );

  const filteredVendors = useMemo(() => {
    const t = vendorSearch.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) => `${v._id} ${v.name}`.toLowerCase().includes(t));
  }, [vendorSearch, vendors]);

  const selectedVendor = useMemo(() => {
    if (!vendorId.trim()) return null;
    return vendors.find((v) => v._id === vendorId.trim()) ?? null;
  }, [vendorId, vendors]);

  async function onSave() {
    if (!token || loading) return;
    if (id && !hasChanges) return;
    if (!canSubmit) {
      setShowValidation(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        sku: sku.trim(),
        description: description.trim() ? description.trim() : undefined,
        location: location.trim() ? location.trim() : undefined,
        quantity: Number(quantity),
        reorderLevel: reorderLevel.trim() ? Number(reorderLevel) : undefined,
        expiryDate: expiryDate.trim() ? new Date(expiryDate.trim()).toISOString() : undefined,
        rfidTagId: rfidTagId.trim() ? rfidTagId.trim() : undefined,
        vendorId: vendorId.trim() ? vendorId.trim() : undefined,
        status: status.trim() ? status.trim() : undefined,
      };

      if (id) {
        const res = await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${id}`, {
          method: "PATCH",
          token,
          body: JSON.stringify(body),
        });
        navigation.navigate("InventoryDetail", { id: res.item._id });
      } else {
        const res = await apiRequest<{ ok: true; item: InventoryItem }>("/inventory/items", {
          method: "POST",
          token,
          body: JSON.stringify(body),
        });
        navigation.replace("InventoryDetail", { id: res.item._id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen
      title={title}
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <>
          <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Details</Text>
                <TextField label="Name *" value={name} onChangeText={setName} placeholder="Item name" errorText={nameError} />
                <View style={{ height: 12 }} />
                <TextField label="SKU *" value={sku} onChangeText={setSku} placeholder="Unique SKU" autoCapitalize="characters" errorText={skuError} />
                <View style={{ height: 12 }} />
                <TextField
                  label="Description"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Optional"
                  multiline
                  numberOfLines={3}
                />
                <View style={{ height: 12 }} />
                <TextField label="Location" value={location} onChangeText={setLocation} placeholder="Aisle, bin, shelf..." />
              </Card>

              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tracking</Text>
                <Text style={[theme.typography.label, { color: theme.colors.text, marginBottom: 8 }]}>Status</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {(["active", "inactive"] as const).map((s) => {
                    const selected = status.trim().toLowerCase() === s;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setStatus(s)}
                        style={({ pressed }) => [
                          {
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: selected ? theme.colors.primarySoft : pressed ? theme.colors.surface2 : theme.colors.surface,
                            borderRadius: 999,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                          },
                        ]}
                      >
                        <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: "800" }}>{s}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ height: 12 }} />
                <TextField label="Custom status" value={status} onChangeText={setStatus} placeholder="active" autoCapitalize="none" />
                <View style={{ height: 12 }} />
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      ref={rfidRef}
                      label="RFID tag ID"
                      value={rfidTagId}
                      onChangeText={setRfidTagId}
                      placeholder="Scan or type"
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={() => setRfidTagId((prev) => prev.trim())}
                    />
                  </View>
                  <AppButton title="Scan RFID" onPress={() => rfidRef.current?.focus()} variant="secondary" />
                </View>
                <View style={{ height: 12 }} />
                <TextField
                  label="Vendor ID"
                  value={vendorId}
                  onChangeText={setVendorId}
                  placeholder="Paste or type"
                  autoCapitalize="none"
                />
                <View style={{ height: 10 }} />
                {selectedVendor ? <MutedText>Selected vendor: {selectedVendor.name}</MutedText> : null}
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      label="Select vendor"
                      value={vendorSearch}
                      onChangeText={(t) => {
                        setVendorSearch(t);
                        setVendorPickerOpen(true);
                      }}
                      placeholder="Search vendor name"
                      autoCapitalize="none"
                    />
                  </View>
                  <AppButton
                    title={vendorPickerOpen ? "Hide" : "Pick"}
                    onPress={() => setVendorPickerOpen((p) => !p)}
                    variant="secondary"
                    disabled={!vendors.length}
                  />
                </View>
                {vendorPickerOpen && filteredVendors.length ? (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {filteredVendors.slice(0, 6).map((v) => (
                      <Pressable
                        key={v._id}
                        onPress={() => {
                          setVendorId(v._id);
                          setVendorSearch(v.name);
                          setVendorPickerOpen(false);
                        }}
                        style={(state) => {
                          const pressed = state.pressed;
                          const hovered = !!(state as any).hovered;
                          return [
                            {
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                              backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
                              borderRadius: theme.radius.md,
                              padding: theme.spacing.md,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: theme.spacing.md,
                              ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                            },
                            hovered && !pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
                            pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
                          ];
                        }}
                      >
                        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                          {v.name}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{v._id.slice(-6)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Card>
            </View>

            <View style={{ width: 380, gap: theme.spacing.md }}>
              <Card>
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Stock</Text>
                <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" errorText={quantityError} />
                <View style={{ height: 12 }} />
                <TextField label="Reorder level" value={reorderLevel} onChangeText={setReorderLevel} keyboardType="numeric" errorText={reorderError} />
                <View style={{ height: 12 }} />
                {DateTimePicker ? (
                  <>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Expiry date</Text>
                    <Pressable
                      onPress={() => setShowExpiryPicker(true)}
                      style={({ pressed }) => [
                        {
                          borderWidth: 1,
                          borderColor: expiryError ? theme.colors.danger : theme.colors.border,
                          backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                          borderRadius: theme.radius.sm,
                          paddingHorizontal: 12,
                          paddingVertical: 12,
                        },
                      ]}
                    >
                      <Text style={{ color: expiryDate ? theme.colors.text : theme.colors.textMuted, fontWeight: "600" }}>
                        {expiryDate ? expiryDate : "Select date"}
                      </Text>
                    </Pressable>

                    {expiryError ? (
                      <View style={{ marginTop: 8 }}>
                        <ErrorText>{expiryError}</ErrorText>
                      </View>
                    ) : null}

                    {showExpiryPicker ? (
                      <View style={{ marginTop: 10 }}>
                        <DateTimePicker
                          value={parseDate(expiryDate) ?? new Date()}
                          mode="date"
                          display={Platform.OS === "ios" ? "compact" : "default"}
                          onChange={(event: any, selected?: Date) => {
                            if (Platform.OS !== "ios") setShowExpiryPicker(false);
                            if (event?.type === "dismissed") return;
                            const d = selected ?? parseDate(expiryDate) ?? new Date();
                            setExpiryDate(formatDate(d));
                          }}
                        />
                        {Platform.OS === "ios" ? (
                          <View style={{ marginTop: 10 }}>
                            <AppButton title="Done" onPress={() => setShowExpiryPicker(false)} variant="secondary" />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <TextField
                    label="Expiry date"
                    value={expiryDate}
                    onChangeText={setExpiryDate}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                  />
                )}
              </Card>

              <Card>
                <AppButton
                  title={loading ? "Saving..." : "Save"}
                  onPress={onSave}
                  disabled={!canSubmit || loading || !hasChanges}
                  loading={loading}
                />
                {!canSubmit ? <MutedText style={{ marginTop: 8 }}>Fill required fields and use valid numbers.</MutedText> : null}
                {canSubmit && !loading && !hasChanges ? <MutedText style={{ marginTop: 8 }}>No changes to save.</MutedText> : null}
              </Card>
            </View>
          </View>
        </>
      ) : (
        <>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Details</Text>
            <TextField label="Name *" value={name} onChangeText={setName} placeholder="Item name" errorText={nameError} />
            <View style={{ height: 12 }} />
            <TextField label="SKU *" value={sku} onChangeText={setSku} placeholder="Unique SKU" autoCapitalize="characters" errorText={skuError} />
            <View style={{ height: 12 }} />
            <TextField
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="Optional"
              multiline
              numberOfLines={3}
            />
            <View style={{ height: 12 }} />
            <TextField label="Location" value={location} onChangeText={setLocation} placeholder="Aisle, bin, shelf..." />
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Stock</Text>
            <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" errorText={quantityError} />
            <View style={{ height: 12 }} />
            <TextField label="Reorder level" value={reorderLevel} onChangeText={setReorderLevel} keyboardType="numeric" errorText={reorderError} />
            <View style={{ height: 12 }} />
            {DateTimePicker ? (
              <>
                <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Expiry date</Text>
                <Pressable
                  onPress={() => setShowExpiryPicker(true)}
                  style={({ pressed }) => [
                    {
                      borderWidth: 1,
                      borderColor: expiryError ? theme.colors.danger : theme.colors.border,
                      backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                      borderRadius: theme.radius.sm,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                    },
                  ]}
                >
                  <Text style={{ color: expiryDate ? theme.colors.text : theme.colors.textMuted, fontWeight: "600" }}>
                    {expiryDate ? expiryDate : "Select date"}
                  </Text>
                </Pressable>

                {expiryError ? (
                  <View style={{ marginTop: 8 }}>
                    <ErrorText>{expiryError}</ErrorText>
                  </View>
                ) : null}

                {showExpiryPicker ? (
                  <View style={{ marginTop: 10 }}>
                    <DateTimePicker
                      value={parseDate(expiryDate) ?? new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "compact" : "default"}
                      onChange={(event: any, selected?: Date) => {
                        if (Platform.OS !== "ios") setShowExpiryPicker(false);
                        if (event?.type === "dismissed") return;
                        const d = selected ?? parseDate(expiryDate) ?? new Date();
                        setExpiryDate(formatDate(d));
                      }}
                    />
                    {Platform.OS === "ios" ? (
                      <View style={{ marginTop: 10 }}>
                        <AppButton title="Done" onPress={() => setShowExpiryPicker(false)} variant="secondary" />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <TextField
                label="Expiry date"
                value={expiryDate}
                onChangeText={setExpiryDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Tracking</Text>
            <Text style={[theme.typography.label, { color: theme.colors.text, marginBottom: 8 }]}>Status</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {(["active", "inactive"] as const).map((s) => {
                const selected = status.trim().toLowerCase() === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={({ pressed }) => [
                      {
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: selected ? theme.colors.primarySoft : pressed ? theme.colors.surface2 : theme.colors.surface,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      },
                    ]}
                  >
                    <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: "800" }}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ height: 12 }} />
            <TextField label="Custom status" value={status} onChangeText={setStatus} placeholder="active" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  ref={rfidRef}
                  label="RFID tag ID"
                  value={rfidTagId}
                  onChangeText={setRfidTagId}
                  placeholder="Scan or type"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={() => setRfidTagId((prev) => prev.trim())}
                />
              </View>
              <AppButton title="Scan RFID" onPress={() => rfidRef.current?.focus()} variant="secondary" />
            </View>
            <View style={{ height: 12 }} />
            <TextField
              label="Vendor ID"
              value={vendorId}
              onChangeText={setVendorId}
              placeholder="Paste or type"
              autoCapitalize="none"
            />
            <View style={{ height: 10 }} />
            {selectedVendor ? <MutedText>Selected vendor: {selectedVendor.name}</MutedText> : null}
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label="Select vendor"
                  value={vendorSearch}
                  onChangeText={(t) => {
                    setVendorSearch(t);
                    setVendorPickerOpen(true);
                  }}
                  placeholder="Search vendor name"
                  autoCapitalize="none"
                />
              </View>
              <AppButton
                title={vendorPickerOpen ? "Hide" : "Pick"}
                onPress={() => setVendorPickerOpen((p) => !p)}
                variant="secondary"
                disabled={!vendors.length}
              />
            </View>
            {vendorPickerOpen && filteredVendors.length ? (
              <View style={{ marginTop: 10, gap: 10 }}>
                {filteredVendors.slice(0, 6).map((v) => (
                  <Pressable
                    key={v._id}
                    onPress={() => {
                      setVendorId(v._id);
                      setVendorSearch(v.name);
                      setVendorPickerOpen(false);
                    }}
                    style={(state) => {
                      const pressed = state.pressed;
                      const hovered = !!(state as any).hovered;
                      return [
                        {
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface2 : theme.colors.surface,
                          borderRadius: theme.radius.md,
                          padding: theme.spacing.md,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: theme.spacing.md,
                          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                        },
                        hovered && !pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
                        pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
                      ];
                    }}
                  >
                    <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                      {v.name}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{v._id.slice(-6)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          <Card>
            <AppButton title={loading ? "Saving..." : "Save"} onPress={onSave} disabled={!canSubmit || loading || !hasChanges} loading={loading} />
            {!canSubmit ? <MutedText style={{ marginTop: 8 }}>Fill required fields and use valid numbers.</MutedText> : null}
            {canSubmit && !loading && !hasChanges ? <MutedText style={{ marginTop: 8 }}>No changes to save.</MutedText> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}
