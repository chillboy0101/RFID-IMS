import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, MutedText, Screen, theme } from "../ui";

declare const require: undefined | ((id: string) => any);

type InventoryFlow = {
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
  updatedAt?: string;
  createdAt?: string;
  flow?: InventoryFlow;
};

type Response = { ok: true; item: InventoryItem };

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryDetail">;

type FlowChip = {
  label: string;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
};

type FlowBoardRow = {
  key: string;
  label: string;
  value: string;
  secondary?: string;
  progressValue?: number;
  progressTotal?: number;
  chips?: FlowChip[];
};

type StepStage = {
  label: string;
  complete: boolean;
  active: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function formatStatusLabel(status?: string | null) {
  const normalized = (status ?? "active").trim().toLowerCase();
  if (normalized === "inactive") return "Inactive";
  if (!normalized) return "Active";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function stockState(item?: InventoryItem | null) {
  const quantity = item?.quantity ?? 0;
  const reorderLevel = item?.reorderLevel ?? 0;
  if (quantity <= 0) return { label: "Out of stock", tone: "danger" as const };
  if (quantity <= reorderLevel) return { label: "Low stock", tone: "warning" as const };
  return { label: "In stock", tone: "success" as const };
}

function progressPercent(value: number, total: number) {
  if (total <= 0 || value <= 0) return 0;
  return Math.max(6, Math.min(100, (value / total) * 100));
}

function compactId(value?: string) {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function buildStepperStages(item?: InventoryItem | null): StepStage[] {
  const quantity = Math.max(0, item?.quantity ?? 0);
  const flow = item?.flow;
  const trackedUnits = flow?.trackedUnits ?? 0;
  const exitReadyUnits = flow?.exitReadyUnits ?? 0;
  const reservedUnits = flow?.reservedUnits ?? 0;
  const pickedUnits = flow?.pickedUnits ?? 0;
  const dispatchedUnits = flow?.dispatchedUnits ?? 0;
  const activeExitAuthorizations = flow?.activeExitAuthorizations ?? 0;
  const reservedGateLive = reservedUnits > 0 || pickedUnits > 0 || activeExitAuthorizations > 0;

  const activeIndex =
    quantity <= 0
      ? 0
      : dispatchedUnits >= quantity
        ? 4
        : reservedGateLive
          ? 3
          : exitReadyUnits >= quantity
            ? 2
            : trackedUnits >= quantity
              ? 1
              : 0;

  return [
    {
      label: "Stocked",
      complete: quantity > 0,
      active: quantity > 0 && activeIndex === 0,
    },
    {
      label: "Tracked",
      complete: quantity > 0 && trackedUnits >= quantity,
      active: quantity > 0 && activeIndex === 1,
    },
    {
      label: "Exit ready",
      complete: quantity > 0 && exitReadyUnits >= quantity,
      active: quantity > 0 && activeIndex === 2,
    },
    {
      label: "Reserved / Gate",
      complete: reservedGateLive || dispatchedUnits > 0,
      active: quantity > 0 && activeIndex === 3,
    },
    {
      label: "Exited",
      complete: quantity > 0 && dispatchedUnits >= quantity,
      active: quantity > 0 && activeIndex === 4,
    },
  ];
}

function SectionLabel({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: 13,
          fontWeight: "800",
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {right}
    </View>
  );
}

function FlowStepper({ stages, compact }: { stages: StepStage[]; compact: boolean }) {
  const size = compact ? 34 : 38;
  const labelSize = compact ? 11 : 12;

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 0,
      }}
    >
      {stages.map((stage, index) => {
        const fg = stage.complete ? theme.colors.success : stage.active ? theme.colors.text : theme.colors.textMuted;
        const bg = stage.complete ? "rgba(34, 197, 94, 0.16)" : stage.active ? theme.colors.primarySoft : theme.colors.surface2;

        return (
          <React.Fragment key={stage.label}>
            <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
              <View
                style={{
                  width: size,
                  height: size,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {stage.complete ? (
                  <Ionicons name="checkmark" size={compact ? 16 : 18} color={fg} />
                ) : stage.active ? (
                  <Ionicons name="arrow-forward" size={compact ? 16 : 18} color={fg} />
                ) : (
                  <Text style={{ color: fg, fontWeight: "800", fontSize: compact ? 12 : 13 }}>{index + 1}</Text>
                )}
              </View>
              <Text
                style={{
                  marginTop: 8,
                  color: stage.active || stage.complete ? theme.colors.text : theme.colors.textMuted,
                  fontWeight: stage.active ? "800" : "700",
                  fontSize: labelSize,
                  lineHeight: compact ? 14 : 16,
                  textAlign: "center",
                }}
                numberOfLines={2}
              >
                {stage.label}
              </Text>
            </View>
            {index < stages.length - 1 ? (
              <View
                style={{
                  flex: 1,
                  height: 2,
                  marginHorizontal: compact ? 6 : 10,
                  marginTop: size / 2 - 1,
                  backgroundColor: stage.complete ? theme.colors.success : theme.colors.border,
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function MetaRow({
  label,
  value,
  accent,
  interactive,
  copied,
  onPress,
}: {
  label: string;
  value: string;
  accent?: boolean;
  interactive?: boolean;
  copied?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!interactive || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
        ...(Platform.OS === "web" && interactive ? ({ cursor: "pointer" } as any) : null),
      })}
    >
      <Text style={[theme.typography.label, { color: theme.colors.textMuted, paddingTop: 2 }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, flex: 1, justifyContent: "flex-end" }}>
        <Text
          style={[
            theme.typography.body,
            {
              color: accent ? theme.colors.success : theme.colors.text,
              fontWeight: accent ? "800" : "600",
              textAlign: "right",
              flexShrink: 1,
            },
          ]}
        >
          {value}
        </Text>
        {interactive ? (
          <Ionicons
            name={copied ? "checkmark-circle" : "copy-outline"}
            size={16}
            color={copied ? theme.colors.success : theme.colors.textMuted}
            style={{ marginTop: 1 }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function FlowMetricRow({
  label,
  value,
  secondary,
  progressValue,
  progressTotal,
  chips,
  divider = true,
}: {
  label: string;
  value: string;
  secondary?: string;
  progressValue?: number;
  progressTotal?: number;
  chips?: FlowChip[];
  divider?: boolean;
}) {
  const showProgress = typeof progressValue === "number" && typeof progressTotal === "number";
  const width = showProgress ? progressPercent(progressValue, progressTotal) : 0;

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 14,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <Text style={[theme.typography.label, { color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }]}>{label}</Text>
        <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: "right", flexShrink: 1 }]}>{value}</Text>
      </View>

      {secondary ? <MutedText>{secondary}</MutedText> : null}

      {showProgress ? (
        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: theme.colors.surface2,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${width}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: theme.colors.success,
            }}
          />
        </View>
      ) : null}

      {chips?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {chips.map((chip) => (
            <Badge key={`${label}-${chip.label}`} label={chip.label} tone={chip.tone ?? "default"} responsive={false} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function InventoryDetailScreen({ navigation, route }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 1100;

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<"" | "item" | "sku" | "rfid" | "barcode" | "vendor">("");
  const loadInFlightRef = useRef(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flow = item?.flow;
  const quantity = Math.max(0, item?.quantity ?? 0);
  const trackedUnits = flow?.trackedUnits ?? 0;
  const taggedUnits = flow?.taggedUnits ?? 0;
  const exitReadyUnits = flow?.exitReadyUnits ?? 0;
  const reservedUnits = flow?.reservedUnits ?? 0;
  const pickedUnits = flow?.pickedUnits ?? 0;
  const dispatchedUnits = flow?.dispatchedUnits ?? 0;
  const activeExitAuthorizations = flow?.activeExitAuthorizations ?? 0;
  const awaitingUnits = (flow?.awaitingTagUnits ?? 0) + (flow?.untrackedUnits ?? 0);
  const gateFlowUnits = Math.min(quantity, reservedUnits + pickedUnits);

  const canDelete = effectiveRole === "manager" || effectiveRole === "admin";
  const stockBadge = stockState(item);
  const stages = useMemo(() => buildStepperStages(item), [item]);

  const flowBoardRows = useMemo<FlowBoardRow[]>(() => {
    if (!item || !flow) return [];

    const taggedSecondary = flow.barcodeReady
      ? `${taggedUnits}/${quantity} tagged | barcode enabled`
      : `${taggedUnits}/${quantity} tagged | barcode missing`;
    const reservedSecondary = `${reservedUnits} reserved | ${pickedUnits} picked`;
    const dispatchedSecondary = quantity > 0 ? `${Math.max(0, quantity - dispatchedUnits)} remaining in stock` : "No units on hand";

    return [
      {
        key: "next-step",
        label: "Next step",
        value: flow.nextStep,
        secondary: item.status?.toLowerCase() === "inactive" ? "Item is inactive until stock handling resumes." : undefined,
        chips: [
          { label: `Qty ${quantity}` },
          ...(quantity > 0 && item.quantity <= item.reorderLevel ? [{ label: "Low stock", tone: "warning" as const }] : []),
          ...(activeExitAuthorizations > 0 ? [{ label: `Gate live ${activeExitAuthorizations}`, tone: "primary" as const }] : []),
        ] satisfies FlowChip[],
      },
      {
        key: "tracked",
        label: "Tracked units",
        value: `${trackedUnits}/${quantity}`,
        secondary: flow.untrackedUnits > 0 ? `${flow.untrackedUnits} still bulk-only` : "All stock has unit tracking.",
        progressValue: trackedUnits,
        progressTotal: quantity,
        chips: [{ label: `Untracked ${flow.untrackedUnits}`, tone: flow.untrackedUnits > 0 ? "warning" : "success" as const }],
      },
      {
        key: "tagged",
        label: "Tagged / barcode-ready",
        value: `${exitReadyUnits}/${quantity} exit ready`,
        secondary: taggedSecondary,
        progressValue: exitReadyUnits,
        progressTotal: quantity,
        chips: [
          { label: `Tagged ${taggedUnits}`, tone: taggedUnits > 0 ? "success" : "default" as const },
          { label: flow.barcodeReady ? "Barcode ready" : "Barcode missing", tone: flow.barcodeReady ? "success" : "warning" as const },
          { label: `Awaiting ${awaitingUnits}`, tone: awaitingUnits > 0 ? "warning" : "default" as const },
        ] satisfies FlowChip[],
      },
      {
        key: "reserved",
        label: "Reserved / picked / gate live",
        value: `${gateFlowUnits}/${quantity} in motion`,
        secondary: reservedSecondary,
        progressValue: gateFlowUnits,
        progressTotal: quantity,
        chips: [
          { label: `Reserved ${reservedUnits}`, tone: reservedUnits > 0 ? "primary" : "default" as const },
          { label: `Picked ${pickedUnits}`, tone: pickedUnits > 0 ? "warning" : "default" as const },
          { label: `Gate live ${activeExitAuthorizations}`, tone: activeExitAuthorizations > 0 ? "primary" : "default" as const },
        ] satisfies FlowChip[],
      },
      {
        key: "dispatched",
        label: "Dispatched",
        value: `${dispatchedUnits}/${quantity}`,
        secondary: dispatchedSecondary,
        progressValue: dispatchedUnits,
        progressTotal: quantity,
        chips: [
          {
            label: flow.missingExitTrackingUnits > 0 ? `${flow.missingExitTrackingUnits} need exit tracking` : "Exit tracking clear",
            tone: flow.missingExitTrackingUnits > 0 ? "warning" : "success",
          },
        ] satisfies FlowChip[],
      },
    ];
  }, [activeExitAuthorizations, awaitingUnits, dispatchedUnits, flow, gateFlowUnits, item, pickedUnits, quantity, reservedUnits, taggedUnits, trackedUnits, exitReadyUnits]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

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

      const timer = setInterval(() => {
        loadSafe(true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(timer);
    }, [loadSafe])
  );

  const openRfidHub = useCallback(() => {
    const parent = navigation.getParent();
    (parent as any)?.navigate?.("More", { screen: "RfidHub", params: { initialMode: "assign", itemId: id } });
  }, [id, navigation]);

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
          return require("expo-clipboard") as { setStringAsync: (text: string) => Promise<void> };
        } catch {
          return null;
        }
      })();

      if (expoClipboard?.setStringAsync) {
        await expoClipboard.setStringAsync(value);
      }
    } catch {
      // ignore clipboard errors
    }
  }

  function copyWithFeedback(key: "item" | "sku" | "rfid" | "barcode" | "vendor", value: string) {
    if (!value || value === "-") return;
    void copyText(value);
    setCopiedKey(key);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedKey(""), 900);
  }

  async function performDelete() {
    if (!token || !canDelete) return;
    await apiRequest<{ ok: true }>(`/inventory/items/${id}`, { method: "DELETE", token });
    navigation.navigate("InventoryList");
  }

  async function onDelete() {
    if (!token || !canDelete) return;

    if (Platform.OS === "web") {
      const confirmDelete = (globalThis as any)?.confirm;
      if (typeof confirmDelete === "function") {
        const ok = confirmDelete("Delete this item?");
        if (!ok) return;
        try {
          await performDelete();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Delete failed");
        }
        return;
      }
    }

    Alert.alert("Delete item", "Are you sure you want to delete this item?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await performDelete();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed");
          }
        },
      },
    ]);
  }

  const headerActions = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        alignSelf: isDesktopWeb ? "auto" : "stretch",
      }}
    >
      <AppButton
        title="Open RFID Hub"
        onPress={openRfidHub}
        variant="secondary"
        iconName="radio-outline"
        style={!isDesktopWeb ? { flex: 1 } : undefined}
      />
      <AppButton
        title="More"
        onPress={() => setActionMenuOpen((current) => !current)}
        variant="secondary"
        iconName="ellipsis-horizontal"
        iconOnly
      />
    </View>
  );

  const headerCard = (
    <Card style={{ padding: 0 }}>
      <View style={{ padding: theme.spacing.md, gap: 16 }}>
        <View
          style={{
            flexDirection: isDesktopWeb ? "row" : "column",
            alignItems: isDesktopWeb ? "flex-start" : "stretch",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text style={[theme.typography.title, { color: theme.colors.text, flexShrink: 1 }]} numberOfLines={isDesktopWeb ? 1 : 2}>
                {item?.name ?? "Inventory item"}
              </Text>
              <Badge label={formatStatusLabel(item?.status)} tone={(item?.status ?? "active").toLowerCase() === "inactive" ? "warning" : "success"} size="header" responsive={false} />
              <Badge label={stockBadge.label} tone={stockBadge.tone} size="header" responsive={false} />
              <Badge
                label={quantity > 0 ? `Exit ready ${exitReadyUnits}/${quantity}` : "No stock"}
                tone={quantity > 0 && exitReadyUnits >= quantity ? "success" : quantity > 0 ? "warning" : "default"}
                size="header"
                responsive={false}
              />
            </View>

            <Text style={[theme.typography.h3, { color: theme.colors.textMuted, marginTop: 10 }]} numberOfLines={1}>
              {item?.sku ?? "-"}
            </Text>

            <MutedText style={{ marginTop: 8 }}>
              {`ID ${compactId(item?._id)} | RFID ${item?.rfidTagId ? compactId(item.rfidTagId) : "None"} | Barcode ${item?.barcode ? compactId(item.barcode) : "None"}`}
            </MutedText>
          </View>

          {isDesktopWeb ? headerActions : null}
        </View>

        {!isDesktopWeb ? headerActions : null}
      </View>

      <FlowStepper stages={stages} compact={!isDesktopWeb} />

      {actionMenuOpen ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            padding: theme.spacing.md,
            gap: 10,
            backgroundColor: theme.colors.surface,
          }}
        >
          <AppButton title="Edit" onPress={() => navigation.navigate("InventoryEdit", { id })} variant="secondary" style={{ width: "100%" }} />
          <AppButton title="Adjust quantity" onPress={() => navigation.navigate("InventoryAdjust", { id })} variant="secondary" style={{ width: "100%" }} />
          <AppButton title="View logs" onPress={() => navigation.navigate("InventoryLogs", { id })} variant="secondary" style={{ width: "100%" }} />
          <AppButton title="Delete" onPress={() => void onDelete()} variant="danger" disabled={!canDelete} style={{ width: "100%" }} />
          {!canDelete ? <MutedText>Delete requires manager or admin access.</MutedText> : null}
        </View>
      ) : null}
    </Card>
  );

  const flowBoard = (
    <Card style={{ padding: 0 }}>
      <SectionLabel
        label="Flow board"
        right={
          flow ? (
            <Text style={[theme.typography.label, { color: exitReadyUnits >= quantity && quantity > 0 ? theme.colors.success : theme.colors.textMuted }]}>
              {quantity > 0 ? `${exitReadyUnits}/${quantity} ready` : "No stock"}
            </Text>
          ) : null
        }
      />

      {flowBoardRows.length ? (
        flowBoardRows.map((row, index) => (
          <FlowMetricRow
            key={row.key}
            label={row.label}
            value={row.value}
            secondary={row.secondary}
            progressValue={row.progressValue}
            progressTotal={row.progressTotal}
            chips={row.chips}
            divider={index < flowBoardRows.length - 1}
          />
        ))
      ) : (
        <View style={{ padding: theme.spacing.md }}>
          <MutedText>Flow summary unavailable.</MutedText>
        </View>
      )}
    </Card>
  );

  const metaRail = (
    <Card style={{ padding: 0 }}>
      <SectionLabel label="Item meta" />
      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <MetaRow
          label="Item ID"
          value={item?._id ?? "-"}
          interactive={!!item?._id}
          copied={copiedKey === "item"}
          onPress={item?._id ? () => copyWithFeedback("item", item._id) : undefined}
        />
        <MetaRow
          label="SKU"
          value={item?.sku ?? "-"}
          interactive={!!item?.sku}
          copied={copiedKey === "sku"}
          onPress={item?.sku ? () => copyWithFeedback("sku", item.sku) : undefined}
        />
        <MetaRow label="Location" value={item?.location ?? "-"} />
        <MetaRow label="Quantity" value={typeof item?.quantity === "number" ? String(item.quantity) : "-"} />
        <MetaRow label="Reorder level" value={typeof item?.reorderLevel === "number" ? String(item.reorderLevel) : "-"} />
        <MetaRow label="Expiry" value={formatDate(item?.expiryDate)} />
        <MetaRow
          label="Vendor"
          value={item?.vendorId ?? "-"}
          interactive={!!item?.vendorId}
          copied={copiedKey === "vendor"}
          onPress={item?.vendorId ? () => copyWithFeedback("vendor", item.vendorId!) : undefined}
        />
        <MetaRow
          label="RFID tag"
          value={item?.rfidTagId ?? "-"}
          interactive={!!item?.rfidTagId}
          copied={copiedKey === "rfid"}
          onPress={item?.rfidTagId ? () => copyWithFeedback("rfid", item.rfidTagId!) : undefined}
        />
        <MetaRow
          label="Barcode"
          value={item?.barcode ?? "-"}
          interactive={!!item?.barcode}
          copied={copiedKey === "barcode"}
          onPress={item?.barcode ? () => copyWithFeedback("barcode", item.barcode!) : undefined}
        />
        <MetaRow label="Created" value={formatDateTime(item?.createdAt)} />
        <MetaRow label="Updated" value={formatDateTime(item?.updatedAt)} accent={!!item?.updatedAt} />

        {item?.description ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              marginTop: 10,
              paddingTop: 18,
              gap: 8,
            }}
          >
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: 13,
                fontWeight: "800",
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              Notes
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.text }]}>{item.description}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );

  const desktopBody = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      {headerCard}
      <View style={{ flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>{flowBoard}</View>
        <View style={{ width: 336, minWidth: 0 }}>{metaRail}</View>
      </View>
    </ScrollView>
  );

  const mobileBody = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      {headerCard}
      {flowBoard}
      {metaRail}
    </ScrollView>
  );

  return (
    <Screen
      title="Item detail"
      busy={loading || updating}
      scroll={false}
      tabBarPadding={isDesktopWeb}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}
      {isDesktopWeb ? desktopBody : mobileBody}
    </Screen>
  );
}
