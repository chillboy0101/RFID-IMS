import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, BarcodeScanModal, ErrorText, MutedText, Screen, shadow, theme } from "../ui";

declare const require: undefined | ((id: string) => any);

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
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

function toneForStock(quantity: string, reorderLevel: string) {
  const qty = Number(quantity) || 0;
  const reorder = Number(reorderLevel) || 0;
  if (qty <= 0) return { label: "Out", tone: "danger" as const };
  if (qty <= reorder) return { label: "Low", tone: "warning" as const };
  return { label: "In stock", tone: "success" as const };
}

function sectionDivider() {
  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.lg }} />;
}

function FormSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>{title}</Text>
        {subtitle ? <MutedText>{subtitle}</MutedText> : null}
      </View>
      {children}
    </View>
  );
}

function SurfaceCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>{title}</Text>
      </View>
      <View style={{ padding: theme.spacing.md, gap: 12 }}>{children}</View>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  helperText,
  errorText,
  multiline,
  numberOfLines,
  inputRef,
  keyboardType,
  autoCapitalize,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  multiline?: boolean;
  numberOfLines?: number;
  inputRef?: React.RefObject<TextInput | null>;
  keyboardType?: "default" | "numeric";
  autoCapitalize?: "none" | "sentences" | "characters";
  editable?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const borderColor = errorText ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={{ gap: 8 }}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        multiline={multiline}
        numberOfLines={numberOfLines}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight: multiline ? 116 : 52,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 14 : 12,
          borderRadius: theme.radius.sm,
          borderWidth: focused || errorText ? 2 : 1,
          borderColor,
          backgroundColor: editable ? theme.colors.surface2 : theme.colors.surface,
          color: editable ? theme.colors.text : theme.colors.textMuted,
          textAlignVertical: multiline ? "top" : "center",
          ...(Platform.OS === "web"
            ? ({
                outlineStyle: "none",
                boxShadow: focused ? `0 0 0 4px ${theme.colors.primarySoft}` : "none",
              } as any)
            : null),
        }}
      />
      {errorText ? <ErrorText>{errorText}</ErrorText> : helperText ? <MutedText>{helperText}</MutedText> : null}
    </View>
  );
}

function IconField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  helperText,
  errorText,
  inputRef,
  autoCapitalize,
  onIconPress,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  icon: keyof typeof Ionicons.glyphMap;
  helperText?: string;
  errorText?: string;
  inputRef?: React.RefObject<TextInput | null>;
  autoCapitalize?: "none" | "characters";
  onIconPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const borderColor = errorText ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={{ gap: 8 }}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
      <View
        style={{
          minHeight: 52,
          borderRadius: theme.radius.sm,
          borderWidth: focused || errorText ? 2 : 1,
          borderColor,
          backgroundColor: theme.colors.surface2,
          flexDirection: "row",
          alignItems: "stretch",
          overflow: "hidden",
          ...(Platform.OS === "web"
            ? ({
                boxShadow: focused ? `0 0 0 4px ${theme.colors.primarySoft}` : "none",
              } as any)
            : null),
        }}
      >
        <Pressable
          onPress={onIconPress}
          disabled={!onIconPress}
          style={({ pressed }) => ({
            width: 54,
            alignItems: "center",
            justifyContent: "center",
            borderRightWidth: 1,
            borderRightColor: theme.colors.border,
            backgroundColor: pressed && onIconPress ? theme.colors.surface : theme.colors.surface,
            opacity: onIconPress ? 1 : 0.9,
          })}
        >
          <Ionicons name={icon} size={18} color={theme.colors.textMuted} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize={autoCapitalize}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            paddingHorizontal: 14,
            color: theme.colors.text,
            fontSize: 15,
            ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
          }}
        />
      </View>
      {errorText ? <ErrorText>{errorText}</ErrorText> : helperText ? <MutedText>{helperText}</MutedText> : null}
    </View>
  );
}

function MetaButton({
  title,
  subtitle,
  onPress,
  loading,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 82,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: "rgba(16, 185, 129, 0.18)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: "#10B981" }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{loading ? "Opening..." : title}</Text>
        <MutedText>{subtitle}</MutedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
    </Pressable>
  );
}

function StartingStockNotice() {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors.surface2,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.primarySoft,
          }}
        >
          <Ionicons name="radio-outline" size={17} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Stock starts at 0</Text>
          <MutedText>Receive physical units through RFID after saving this item.</MutedText>
        </View>
      </View>
      <Badge label="RFID receiving controls quantity" tone="primary" />
    </View>
  );
}

function AccordionSection({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <SurfaceCard title={title}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{title}</Text>
          {subtitle ? <MutedText>{subtitle}</MutedText> : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.textMuted} />
      </Pressable>
      {open ? <View style={{ paddingTop: 12, gap: 12 }}>{children}</View> : null}
    </SurfaceCard>
  );
}

export function InventoryEditScreen({ navigation, route }: Props) {
  const { token } = useContext(AuthContext);
  const params = (route.params ?? {}) as Partial<{ id?: string }>;
  const routeId = params.id;
  const id = routeId && routeId !== "undefined" ? routeId : undefined;

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 1080;
  const insets = useSafeAreaInsets();
  const compactActionDockOffset = Platform.OS === "web" ? 92 : Math.max(28, 68 - insets.bottom);
  const compactActionDockHeight = 96;

  const barcodeRef = useRef<TextInput>(null);

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

  const formatDate = useCallback((date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const parseDate = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, []);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
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
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const initialRef = useRef<InventoryItem | null>(null);

  const title = id ? "Edit item" : "New item";
  const stockLabel = "On-hand quantity";

  const hydrateFromItem = useCallback((item: InventoryItem | null) => {
    initialRef.current = item;
    setName(item?.name ?? "");
    setSku(item?.sku ?? "");
    setBarcode(item?.barcode ?? "");
    setDescription(item?.description ?? "");
    setLocation(item?.location ?? "");
    setQuantity(String(item?.quantity ?? 0));
    setReorderLevel(String(item?.reorderLevel ?? 0));
    setExpiryDate(item?.expiryDate ? new Date(item.expiryDate).toISOString().slice(0, 10) : "");
    setRfidTagId(item?.rfidTagId ?? "");
    setVendorId(item?.vendorId ?? "");
    setStatus(item?.status ?? "active");
  }, []);

  const resetDraft = useCallback(() => {
    if (id && initialRef.current) {
      hydrateFromItem(initialRef.current);
      setVendorSearch("");
      setVendorPickerOpen(false);
      setShowValidation(false);
      return;
    }

    hydrateFromItem(null);
    setVendorSearch("");
    setVendorPickerOpen(false);
    setShowValidation(false);
  }, [hydrateFromItem, id]);

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

  const openRfidHub = useCallback(() => {
    const parent = navigation.getParent();
    (parent as any)?.navigate?.("More", { screen: "RfidHub" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    const res = await apiRequest<GetResponse>(`/inventory/items/${encodeURIComponent(id)}`, { method: "GET", token });
    hydrateFromItem(res.item);
  }, [hydrateFromItem, id, token]);

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
      setVendors(res.vendors.map((vendor) => ({ _id: vendor._id, name: vendor.name })));
    } catch {
      // ignore vendor load failures in form bootstrap
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVendors().catch(() => undefined);
    }, [loadVendors])
  );

  const filteredVendors = useMemo(() => {
    const term = vendorSearch.trim().toLowerCase();
    if (!term) return vendors;
    return vendors.filter((vendor) => `${vendor._id} ${vendor.name}`.toLowerCase().includes(term));
  }, [vendorSearch, vendors]);

  const selectedVendor = useMemo(() => {
    if (!vendorId.trim()) return null;
    return vendors.find((vendor) => vendor._id === vendorId.trim()) ?? null;
  }, [vendorId, vendors]);

  const nameError = showValidation && !name.trim() ? "Name is required" : undefined;
  const skuError = showValidation && id && !sku.trim() ? "SKU is required" : undefined;

  const quantityError = useMemo(() => {
    if (!showValidation) return undefined;
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed)) return "Quantity must be a number";
    if (parsed < 0) return "Quantity cannot be negative";
    return undefined;
  }, [quantity, showValidation]);

  const reorderError = useMemo(() => {
    if (!showValidation) return undefined;
    if (!reorderLevel.trim()) return undefined;
    const parsed = Number(reorderLevel);
    if (!Number.isFinite(parsed)) return "Reorder level must be a number";
    if (parsed < 0) return "Reorder level cannot be negative";
    return undefined;
  }, [reorderLevel, showValidation]);

  const expiryError = useMemo(() => {
    if (!showValidation) return undefined;
    if (!expiryDate.trim()) return undefined;
    return parseDate(expiryDate.trim()) ? undefined : "Expiry date is invalid";
  }, [expiryDate, parseDate, showValidation]);

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (id && !sku.trim()) return false;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) return false;
    const reorder = reorderLevel.trim() ? Number(reorderLevel) : 0;
    if (!Number.isFinite(reorder) || reorder < 0) return false;
    if (expiryDate.trim() && !parseDate(expiryDate.trim())) return false;
    return true;
  }, [expiryDate, id, name, parseDate, quantity, reorderLevel, sku]);

  const hasChanges = useMemo(() => {
    if (!id) {
      const currentStatus = (status.trim() || "active").toLowerCase();
      return (
        Boolean(name.trim()) ||
        Boolean(sku.trim()) ||
        Boolean(barcode.trim()) ||
        Boolean(description.trim()) ||
        Boolean(location.trim()) ||
        Number(quantity) !== 0 ||
        (reorderLevel.trim() ? Number(reorderLevel) : 0) !== 0 ||
        Boolean(expiryDate.trim()) ||
        Boolean(vendorId.trim()) ||
        currentStatus !== "active"
      );
    }
    const item = initialRef.current;
    if (!item) return false;

    const currentExpiry = expiryDate.trim();
    const itemExpiry = item.expiryDate ? new Date(item.expiryDate).toISOString().slice(0, 10) : "";
    const currentStatus = (status.trim() || "active").toLowerCase();
    const itemStatus = (item.status ?? "active").toLowerCase();

    return (
      name.trim() !== (item.name ?? "").trim() ||
      sku.trim() !== (item.sku ?? "").trim() ||
      barcode.trim() !== (item.barcode ?? "").trim() ||
      description.trim() !== (item.description ?? "").trim() ||
      location.trim() !== (item.location ?? "").trim() ||
      Number(quantity) !== (item.quantity ?? 0) ||
      (reorderLevel.trim() ? Number(reorderLevel) : 0) !== (item.reorderLevel ?? 0) ||
      currentExpiry !== itemExpiry ||
      vendorId.trim() !== (item.vendorId ?? "").trim() ||
      currentStatus !== itemStatus
    );
  }, [barcode, description, expiryDate, id, location, name, quantity, reorderLevel, sku, status, vendorId]);

  const confirmDiscard = useCallback(async () => {
    const message = id ? "Discard your changes and restore the saved item?" : "Discard this draft and clear the form?";

    if (Platform.OS === "web" && typeof globalThis.confirm === "function") {
      return globalThis.confirm(message);
    }

    return await new Promise<boolean>((resolve) => {
      Alert.alert("Discard changes?", message, [
        { text: "Keep editing", style: "cancel", onPress: () => resolve(false) },
        { text: "Discard", style: "destructive", onPress: () => resolve(true) },
      ]);
    });
  }, [id]);

  const handleDiscard = useCallback(async () => {
    if (loading || !hasChanges) return;
    const confirmed = await confirmDiscard();
    if (!confirmed) return;
    resetDraft();
  }, [confirmDiscard, hasChanges, loading, resetDraft]);

  const stockTone = toneForStock(quantity, reorderLevel);

  async function save() {
    if (!token || loading) return;
    setShowValidation(true);
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const body: any = {
        name: name.trim(),
        sku: sku.trim() ? sku.trim() : undefined,
        barcode: barcode.trim() ? barcode.trim() : undefined,
        description: description.trim() ? description.trim() : undefined,
        location: location.trim() ? location.trim() : undefined,
        quantity: id ? Number(quantity) || 0 : 0,
        reorderLevel: Number(reorderLevel) || 0,
        expiryDate: expiryDate.trim() ? expiryDate.trim() : undefined,
        vendorId: vendorId.trim() ? vendorId.trim() : undefined,
        status: status.trim() ? status.trim() : undefined,
      };

      if (id) {
        const res = await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token,
          body: JSON.stringify(body),
        });
        navigation.replace("InventoryDetail", { id: res.item._id });
        return;
      }

      const res = await apiRequest<{ ok: true; item: InventoryItem }>("/inventory/items", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      navigation.replace("InventoryDetail", { id: res.item._id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  const desktopRight = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
      {hasChanges ? <AppButton title="Discard" onPress={handleDiscard} variant="secondary" disabled={loading} /> : null}
      <AppButton title="Save item" onPress={save} disabled={!canSubmit || loading || !hasChanges} loading={loading} />
    </View>
  );

  const mobileRight = <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />;

  const desktopContent = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ flexDirection: "row", gap: theme.spacing.lg, alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.lg,
            }}
          >
            <FormSection title="General details" subtitle="Core item identity shown across inventory and order flows.">
              <FormField
                label="Item name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Brazilian wig - Blonde 130%"
                errorText={nameError}
                autoCapitalize="sentences"
              />
              <FormField
                label="Description"
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. 100% human hair, straight texture, lace front..."
                multiline
                numberOfLines={4}
                autoCapitalize="sentences"
              />
              <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <IconField
                    label="SKU"
                    value={sku}
                    onChangeText={setSku}
                    placeholder={id ? "BW-BLND-130" : "Generated automatically"}
                    icon="pricetag-outline"
                    autoCapitalize="characters"
                    helperText={id ? "SKU must be unique across all items." : "Leave blank and the backend will generate a unique SKU."}
                    errorText={skuError}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <IconField
                    label="Barcode"
                    value={barcode}
                    onChangeText={setBarcode}
                    placeholder="Scan or enter"
                    icon="barcode-outline"
                    autoCapitalize="none"
                    helperText="Add a barcode if untagged units should still clear the gate."
                    inputRef={barcodeRef}
                    onIconPress={() => setBarcodeScanOpen(true)}
                  />
                </View>
              </View>
            </FormSection>

            {sectionDivider()}

            <FormSection title="Location & handling" subtitle="Where the item lives and how warehouse staff will recognize it.">
              <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <FormField
                    label="Location"
                    value={location}
                    onChangeText={setLocation}
                    placeholder="e.g. Aisle 4, Shelf B"
                    autoCapitalize="characters"
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <FormField
                    label="Operational status"
                    value={status}
                    onChangeText={setStatus}
                    placeholder="active"
                    autoCapitalize="none"
                    helperText="Use active or inactive unless you have a branch-specific workflow."
                  />
                </View>
              </View>
            </FormSection>
          </View>
        </View>

        <View style={{ width: 332, gap: theme.spacing.md, flexShrink: 0 }}>
          <SurfaceCard title="Stock levels">
            {id ? (
              <FormField label={stockLabel} value={quantity} onChangeText={setQuantity} keyboardType="numeric" errorText={quantityError} placeholder="0" />
            ) : (
              <StartingStockNotice />
            )}
            <FormField
              label="Low stock alert"
              value={reorderLevel}
              onChangeText={setReorderLevel}
              keyboardType="numeric"
              errorText={reorderError}
              placeholder="e.g. 10"
              helperText="Alert when quantity falls below this level."
            />
            <Badge label={stockTone.label} tone={stockTone.tone} />
          </SurfaceCard>

          <SurfaceCard title="Status">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {[
                { key: "active", label: "Active" },
                { key: "inactive", label: "Inactive" },
              ].map((option) => {
                const selected = status.trim().toLowerCase() === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setStatus(option.key)}
                    style={{
                      minHeight: 42,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: "800" }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SurfaceCard>

          <SurfaceCard title="RFID">
            <MetaButton title="Assign via RFID hub" subtitle={rfidTagId ? `Current tag ${rfidTagId}` : "No tag assigned yet"} onPress={openRfidHub} loading={loading} />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Badge label="SKU master" tone="default" />
              <Badge label="Live hub" tone="primary" />
            </View>
          </SurfaceCard>

          <SurfaceCard title="Vendor">
            <FormField
              label="Vendor / supplier"
              value={vendorSearch}
              onChangeText={(value) => {
                setVendorSearch(value);
                setVendorPickerOpen(true);
              }}
              placeholder="e.g. Lagos Hair Co."
              autoCapitalize="sentences"
              helperText={selectedVendor ? `Selected vendor: ${selectedVendor.name}` : "Search by vendor name to attach supplier metadata."}
            />
            {vendorPickerOpen && filteredVendors.length ? (
              <View style={{ gap: 10 }}>
                {filteredVendors.slice(0, 5).map((vendor) => (
                  <Pressable
                    key={vendor._id}
                    onPress={() => {
                      setVendorId(vendor._id);
                      setVendorSearch(vendor.name);
                      setVendorPickerOpen(false);
                    }}
                    style={({ pressed }) => ({
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                      borderRadius: theme.radius.sm,
                      padding: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    })}
                  >
                    <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                      {vendor.name}
                    </Text>
                    <MutedText>{vendor._id.slice(-6)}</MutedText>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </SurfaceCard>

          <SurfaceCard title="Expiry">
            {DateTimePicker ? (
              <>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>Expiry date</Text>
                <Pressable
                  onPress={() => setShowExpiryPicker(true)}
                  style={{
                    minHeight: 52,
                    borderRadius: theme.radius.sm,
                    borderWidth: expiryError ? 2 : 1,
                    borderColor: expiryError ? theme.colors.danger : theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    paddingHorizontal: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: expiryDate ? theme.colors.text : theme.colors.textMuted, fontSize: 15 }}>{expiryDate || "Select date"}</Text>
                  <Ionicons name="calendar-outline" size={18} color={theme.colors.textMuted} />
                </Pressable>
                {expiryError ? <ErrorText>{expiryError}</ErrorText> : <MutedText>Leave blank if the item is not perishable.</MutedText>}
                {showExpiryPicker ? (
                  <View style={{ paddingTop: 8 }}>
                    <DateTimePicker
                      value={parseDate(expiryDate) ?? new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "compact" : "default"}
                      onChange={(event: any, selected?: Date) => {
                        if (Platform.OS !== "ios") setShowExpiryPicker(false);
                        if (event?.type === "dismissed") return;
                        const resolved = selected ?? parseDate(expiryDate) ?? new Date();
                        setExpiryDate(formatDate(resolved));
                      }}
                    />
                    {Platform.OS === "ios" ? <AppButton title="Done" onPress={() => setShowExpiryPicker(false)} variant="secondary" /> : null}
                  </View>
                ) : null}
              </>
            ) : (
              <FormField
                label="Expiry date"
                value={expiryDate}
                onChangeText={setExpiryDate}
                placeholder="YYYY-MM-DD"
                errorText={expiryError}
                helperText="Leave blank if the item is not perishable."
                autoCapitalize="none"
              />
            )}
          </SurfaceCard>
        </View>
      </View>
    </ScrollView>
  );

  const mobileContent = (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: compactActionDockOffset + compactActionDockHeight }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ErrorText>{error}</ErrorText> : null}

        <AccordionSection title="General details" subtitle="Name, description, SKU, and barcode" defaultOpen>
          <FormField
            label="Item name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Brazilian wig - Blonde 130%"
            errorText={nameError}
            autoCapitalize="sentences"
          />
          <FormField
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. 100% human hair, straight texture, lace front..."
            multiline
            numberOfLines={4}
            autoCapitalize="sentences"
          />
          <IconField
            label="SKU"
            value={sku}
            onChangeText={setSku}
            placeholder={id ? "BW-BLND-130" : "Generated automatically"}
            icon="pricetag-outline"
            autoCapitalize="characters"
            helperText={id ? "SKU must be unique across all items." : "Leave blank and the backend will generate a unique SKU."}
            errorText={skuError}
          />
          <IconField
            label="Barcode"
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan or enter"
            icon="barcode-outline"
            helperText="Use this for untagged fallback scans."
            inputRef={barcodeRef}
            onIconPress={() => setBarcodeScanOpen(true)}
          />
        </AccordionSection>

        <AccordionSection title="Stock & status" subtitle="Quantity, alerts, and visibility" defaultOpen>
          {id ? (
            <FormField label={stockLabel} value={quantity} onChangeText={setQuantity} keyboardType="numeric" errorText={quantityError} placeholder="0" />
          ) : (
            <StartingStockNotice />
          )}
          <FormField
            label="Low stock alert"
            value={reorderLevel}
            onChangeText={setReorderLevel}
            keyboardType="numeric"
            errorText={reorderError}
            placeholder="e.g. 10"
            helperText="Alert when quantity falls below this level."
          />
          <FormField
            label="Location"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Aisle 4, Shelf B"
            autoCapitalize="characters"
          />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Badge label={stockTone.label} tone={stockTone.tone} />
            <Badge label={status || "active"} tone={status.trim().toLowerCase() === "inactive" ? "warning" : "default"} />
          </View>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {[
              { key: "active", label: "Active" },
              { key: "inactive", label: "Inactive" },
            ].map((option) => {
              const selected = status.trim().toLowerCase() === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setStatus(option.key)}
                  style={{
                    minHeight: 42,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: "800" }}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </AccordionSection>

        <AccordionSection title="RFID, vendor & expiry" subtitle="Secondary operational details">
          <MetaButton title="Assign via RFID hub" subtitle={rfidTagId ? `Current tag ${rfidTagId}` : "No tag assigned yet"} onPress={openRfidHub} loading={loading} />
          <FormField
            label="Vendor / supplier"
            value={vendorSearch}
            onChangeText={(value) => {
              setVendorSearch(value);
              setVendorPickerOpen(true);
            }}
            placeholder="e.g. Lagos Hair Co."
            autoCapitalize="sentences"
            helperText={selectedVendor ? `Selected vendor: ${selectedVendor.name}` : undefined}
          />
          {vendorPickerOpen && filteredVendors.length ? (
            <View style={{ gap: 10 }}>
              {filteredVendors.slice(0, 4).map((vendor) => (
                <Pressable
                  key={vendor._id}
                  onPress={() => {
                    setVendorId(vendor._id);
                    setVendorSearch(vendor.name);
                    setVendorPickerOpen(false);
                  }}
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                    borderRadius: theme.radius.sm,
                    padding: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  })}
                >
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                    {vendor.name}
                  </Text>
                  <MutedText>{vendor._id.slice(-6)}</MutedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {DateTimePicker ? (
            <>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Expiry date</Text>
              <Pressable
                onPress={() => setShowExpiryPicker(true)}
                style={{
                  minHeight: 52,
                  borderRadius: theme.radius.sm,
                  borderWidth: expiryError ? 2 : 1,
                  borderColor: expiryError ? theme.colors.danger : theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  paddingHorizontal: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: expiryDate ? theme.colors.text : theme.colors.textMuted, fontSize: 15 }}>{expiryDate || "Select date"}</Text>
                <Ionicons name="calendar-outline" size={18} color={theme.colors.textMuted} />
              </Pressable>
              {expiryError ? <ErrorText>{expiryError}</ErrorText> : <MutedText>Leave blank if this item is not perishable.</MutedText>}
              {showExpiryPicker ? (
                <View style={{ paddingTop: 8 }}>
                  <DateTimePicker
                    value={parseDate(expiryDate) ?? new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "compact" : "default"}
                    onChange={(event: any, selected?: Date) => {
                      if (Platform.OS !== "ios") setShowExpiryPicker(false);
                      if (event?.type === "dismissed") return;
                      const resolved = selected ?? parseDate(expiryDate) ?? new Date();
                      setExpiryDate(formatDate(resolved));
                    }}
                  />
                  {Platform.OS === "ios" ? <AppButton title="Done" onPress={() => setShowExpiryPicker(false)} variant="secondary" /> : null}
                </View>
              ) : null}
            </>
          ) : (
            <FormField
              label="Expiry date"
              value={expiryDate}
              onChangeText={setExpiryDate}
              placeholder="YYYY-MM-DD"
              errorText={expiryError}
              helperText="Leave blank if this item is not perishable."
              autoCapitalize="none"
            />
          )}
        </AccordionSection>
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: compactActionDockOffset,
        }}
      >
        <View
          style={[
            {
              marginHorizontal: theme.spacing.md,
              padding: 10,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceGlass,
            },
            shadow(2),
          ]}
        >
          <View style={{ flexDirection: "row", gap: 10 }}>
            {hasChanges ? (
              <View style={{ flex: 1 }}>
                <AppButton title="Discard" onPress={handleDiscard} variant="secondary" disabled={loading} />
              </View>
            ) : null}
            <View style={{ flex: hasChanges ? 1.2 : 1 }}>
              <AppButton title="Save item" onPress={save} disabled={!canSubmit || loading || !hasChanges} loading={loading} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <Screen title={title} right={isDesktopWeb ? desktopRight : mobileRight} tabBarPadding={isDesktopWeb} scroll={false}>
      <BarcodeScanModal
        visible={barcodeScanOpen}
        title="Scan item barcode"
        onClose={() => setBarcodeScanOpen(false)}
        onScanned={(value) => {
          setBarcode(value);
          setBarcodeScanOpen(false);
          setTimeout(() => barcodeRef.current?.focus(), 40);
        }}
      />
      {isDesktopWeb ? desktopContent : mobileContent}
    </Screen>
  );
}
