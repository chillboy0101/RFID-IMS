import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, ErrorText, GLOBAL_AUTO_REFRESH_MS, LivePulse, MutedText, Screen, TextField, theme } from "../ui";

type AuditEvent = {
  id: string;
  createdAt: string;
  type: string;
  category: string;
  summary: string;
  fromRole?: string | null;
  toRole?: string | null;
  actor: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    source?: string | null;
  };
  targetUser?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
  entity: {
    type?: string | null;
    id?: string | null;
    label?: string | null;
  };
  request: {
    method?: string | null;
    path?: string | null;
    routeKey?: string | null;
    requestId?: string | null;
    statusCode?: number | null;
    outcome?: "success" | "failure" | null;
  };
  metadata?: Record<string, unknown> | null;
};

type AuditResponse = {
  ok: true;
  events: AuditEvent[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  summary: {
    total: number;
    failures: number;
    changes: number;
    uniqueActors: number;
  };
};

type Props = NativeStackScreenProps<MoreStackParamList, "Audit">;

const scopes = [
  { value: "", label: "All" },
  { value: "inventory", label: "Inventory" },
  { value: "orders", label: "Orders" },
  { value: "rfid", label: "RFID" },
  { value: "tenants", label: "People" },
  { value: "vendors", label: "Vendors" },
  { value: "reorders", label: "Reorders" },
  { value: "feedback", label: "Feedback" },
  { value: "auth", label: "Security" },
  { value: "admin", label: "Admin" },
  { value: "progress", label: "Progress" },
  { value: "integrations", label: "Imports" },
] as const;

const outcomes = [
  { value: "", label: "All states" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failures" },
] as const;

const monoFamily =
  Platform.OS === "web"
    ? ("ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" as const)
    : Platform.OS === "ios"
      ? ("Menlo" as const)
      : ("monospace" as const);

function formatActor(event: AuditEvent): string {
  if (event.actor.source === "hardware") {
    return event.actor.name?.trim() || "RFID hardware";
  }
  if (event.actor.name?.trim()) return event.actor.name.trim();
  if (event.actor.email?.trim()) return event.actor.email.trim();
  return "System";
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFullEventTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function titleCase(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function categoryLabel(category: string): string {
  const match = scopes.find((scope) => scope.value === category);
  return match?.label ?? titleCase(category || "System");
}

function formatEntity(event: AuditEvent): string {
  if (event.category === "progress") {
    const routeLabel = event.metadata && typeof event.metadata.routeLabel === "string" ? event.metadata.routeLabel : null;
    const kindLabel = event.metadata && typeof event.metadata.kindLabel === "string" ? event.metadata.kindLabel : null;
    if (routeLabel?.trim()) return routeLabel.trim();
    if (kindLabel?.trim()) return kindLabel.trim();
  }
  return event.entity.label?.trim() || event.targetUser?.name || event.targetUser?.email || event.entity.id || "-";
}

function formatRoute(event: AuditEvent): string {
  const parts = [event.request.method, event.request.path].filter(Boolean);
  return parts.length ? parts.join(" ") : event.request.routeKey || "-";
}

function formatEventSubtitle(event: AuditEvent): string {
  if (event.category === "progress") {
    const kindLabel = event.metadata && typeof event.metadata.kindLabel === "string" ? event.metadata.kindLabel : null;
    return kindLabel?.trim() ? `Progress / ${kindLabel.trim()}` : "Progress";
  }
  return `${categoryLabel(event.category)} / ${titleCase(event.type)}`;
}

function formatTargetMeta(event: AuditEvent): string {
  if (event.category === "progress") {
    const mode = event.metadata && typeof event.metadata.mode === "string" ? event.metadata.mode : null;
    if (mode?.trim()) return titleCase(mode.trim());
  }
  return event.entity.type ? titleCase(event.entity.type) : event.targetUser?.role ? titleCase(event.targetUser.role) : "-";
}

function outcomeTone(event: AuditEvent): "success" | "danger" | "default" {
  if (event.request.outcome === "failure") return "danger";
  if (event.request.outcome === "success" || !event.request.outcome) return "success";
  return "default";
}

function formatMetadataEntries(metadata?: Record<string, unknown> | null): Array<[string, string]> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([key, value]) => value != null && key !== "error")
    .slice(0, 8)
    .map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (typeof value === "number" || typeof value === "boolean") return [key, String(value)];
      return [key, JSON.stringify(value)];
    });
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAuditCsv(events: AuditEvent[]): string {
  const header = ["Time", "Outcome", "Category", "Type", "Summary", "Actor", "Actor email", "Entity", "Entity type", "Request", "Request ID", "HTTP"];
  const rows = events.map((event) => [
    formatFullEventTime(event.createdAt),
    event.request.outcome ?? "success",
    categoryLabel(event.category),
    event.type,
    event.summary,
    formatActor(event),
    event.actor.email ?? "",
    formatEntity(event),
    event.entity.type ?? "",
    formatRoute(event),
    event.request.requestId ?? "",
    event.request.statusCode ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  if (Platform.OS === "web" && typeof window !== "undefined" && window.navigator?.clipboard) {
    await window.navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function entityIsOpenable(event: AuditEvent): boolean {
  const type = event.entity.type;
  if (!type) return false;
  if (type === "inventory_item" || type === "order" || type === "vendor") return Boolean(event.entity.id);
  return [
    "tenant",
    "tenant_membership",
    "user",
    "session",
    "feedback",
    "task_session",
    "reorder_request",
    "gate_api_key",
    "rfid_event",
    "rfid_tag",
    "exit_session",
    "exit_authorization",
    "import_job",
    "inventory_import",
  ].includes(type);
}

function Surface({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  tone = "default",
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: "default" | "danger" | "success";
}) {
  const activeColor = tone === "danger" ? theme.colors.danger : tone === "success" ? theme.colors.success : theme.colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 38,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? activeColor : theme.colors.border,
          backgroundColor: active
            ? tone === "danger"
              ? "rgba(239, 68, 68, 0.12)"
              : tone === "success"
                ? "rgba(34, 197, 94, 0.12)"
                : theme.colors.surface
            : pressed
              ? theme.colors.surface
              : theme.colors.surface2,
          alignItems: "center",
          justifyContent: "center",
          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
        },
        pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
      ]}
    >
      <Text style={{ color: active ? activeColor : theme.colors.textMuted, fontSize: 12, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function OutcomePill({ event }: { event: AuditEvent }) {
  const tone = outcomeTone(event);
  const bg = tone === "danger" ? "rgba(239, 68, 68, 0.14)" : tone === "success" ? "rgba(34, 197, 94, 0.14)" : theme.colors.surface2;
  const fg = tone === "danger" ? theme.colors.danger : tone === "success" ? theme.colors.success : theme.colors.textMuted;
  const label = event.request.outcome === "failure" ? "Failure" : "Success";
  return (
    <View
      style={{
        width: 82,
        minHeight: 32,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
      }}
    >
      <Text style={{ color: fg, fontSize: 11, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

function MetricTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  tone?: "success" | "danger" | "default";
}) {
  const color = tone === "success" ? theme.colors.success : tone === "danger" ? theme.colors.danger : theme.colors.textMuted;
  return (
    <View
      style={{
        minWidth: 116,
        flexGrow: 1,
        flexBasis: 116,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>{label}</Text>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={{ color: color === theme.colors.textMuted ? theme.colors.text : color, fontSize: 22, fontWeight: "900" }}>{value}</Text>
    </View>
  );
}

function KeyValueRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>{label}</Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 13,
          fontWeight: "600",
          fontFamily: mono ? (monoFamily as any) : undefined,
        }}
        numberOfLines={3}
      >
        {value}
      </Text>
    </View>
  );
}

function DetailPanel({
  event,
  copiedLabel,
  onCopy,
  onOpenEntity,
  onClose,
  compact,
}: {
  event: AuditEvent;
  copiedLabel: string | null;
  onCopy: (label: string, value: string) => void;
  onOpenEntity: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const metadataEntries = formatMetadataEntries(event.metadata);
  const canOpen = entityIsOpenable(event);

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={3}>
            {event.summary}
          </Text>
          <MutedText style={{ marginTop: 5 }}>{formatFullEventTime(event.createdAt)}</MutedText>
        </View>
        {onClose ? <AppButton title="Close" onPress={onClose} variant="secondary" iconName="close" iconOnly /> : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Badge label={categoryLabel(event.category)} tone="default" />
        <OutcomePill event={event} />
        {event.request.statusCode ? <Badge label={`HTTP ${event.request.statusCode}`} tone={outcomeTone(event)} /> : null}
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface2,
          padding: 12,
          gap: 14,
        }}
      >
        <KeyValueRow label="Actor" value={formatActor(event)} />
        <KeyValueRow label="Actor detail" value={event.actor.email || event.actor.role || event.actor.source || "-"} />
        <KeyValueRow label="Entity" value={formatEntity(event)} />
        <KeyValueRow label="Entity type" value={formatTargetMeta(event)} />
        <KeyValueRow label="Request" value={formatRoute(event)} mono />
        <KeyValueRow label="Request ID" value={event.request.requestId || "-"} mono />
      </View>

      {event.fromRole || event.toRole ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surface2,
            padding: 12,
          }}
        >
          <KeyValueRow label="Role change" value={`${event.fromRole ?? "-"} to ${event.toRole ?? "-"}`} />
        </View>
      ) : null}

      {metadataEntries.length ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surface2,
            padding: 12,
            gap: 10,
          }}
        >
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Metadata</Text>
          {metadataEntries.map(([key, value]) => (
            <View key={key} style={{ flexDirection: compact ? "column" : "row", gap: compact ? 3 : 10 }}>
              <Text style={{ width: compact ? undefined : 112, color: theme.colors.textMuted, fontSize: 12, fontFamily: monoFamily as any }} numberOfLines={1}>
                {key}
              </Text>
              <Text style={{ flex: 1, color: theme.colors.text, fontSize: 12 }} numberOfLines={3}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {event.metadata && typeof event.metadata.error === "string" ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            padding: 12,
          }}
        >
          <Text style={{ color: theme.colors.danger, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Error</Text>
          <ErrorText style={{ marginTop: 6 }}>{event.metadata.error}</ErrorText>
        </View>
      ) : null}

      <View style={{ flexDirection: compact ? "column" : "row", flexWrap: "wrap", gap: 8 }}>
        {canOpen ? <AppButton title="Open target" onPress={onOpenEntity} variant="secondary" iconName="open-outline" style={{ flex: compact ? undefined : 1 }} /> : null}
        <AppButton
          title={copiedLabel === "request" ? "Copied" : "Copy request"}
          onPress={() => onCopy("request", event.request.requestId || event.id)}
          variant="secondary"
          iconName="copy-outline"
          style={{ flex: compact ? undefined : 1 }}
        />
        <AppButton
          title={copiedLabel === "event" ? "Copied" : "Copy event"}
          onPress={() => onCopy("event", JSON.stringify(event, null, 2))}
          variant="secondary"
          iconName="document-text-outline"
          style={{ flex: compact ? undefined : 1 }}
        />
      </View>
    </View>
  );
}

export function AuditScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isSplitView = Platform.OS === "web" && width >= 1180;
  const isTableView = Platform.OS === "web" && width >= 820;

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<(typeof scopes)[number]["value"]>("");
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]["value"]>("");

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditResponse["summary"]>({ total: 0, failures: 0, changes: 0, uniqueActors: 0 });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

  const buildPath = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", "60");
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (outcome) params.set("outcome", outcome);
      return `/audit?${params.toString()}`;
    },
    [category, outcome, q]
  );

  const loadPage = useCallback(
    async (nextPage: number, append: boolean, showUpdating: boolean) => {
      if (!token || effectiveRole !== "admin") return;

      const seq = ++requestSeqRef.current;
      if (showUpdating) setUpdating(true);

      try {
        setError(null);
        const res = await apiRequest<AuditResponse>(buildPath(nextPage), { method: "GET", token });
        if (seq !== requestSeqRef.current) return;
        setEvents((prev) => (append ? [...prev, ...res.events] : res.events));
        setSummary(res.summary);
        setPage(res.page);
        setHasMore(res.hasMore);
        setTotal(res.total);
      } finally {
        if (seq === requestSeqRef.current && showUpdating) setUpdating(false);
      }
    },
    [buildPath, effectiveRole, token]
  );

  useEffect(() => {
    if (!events.length) {
      setSelectedEventId(null);
      return;
    }
    setSelectedEventId((current) => (current && events.some((event) => event.id === current) ? current : events[0]!.id));
  }, [events]);

  useFocusEffect(
    useCallback(() => {
      if (effectiveRole !== "admin") return undefined;

      setLoading(true);
      loadPage(1, false, true)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit trail"))
        .finally(() => setLoading(false));

      const id = setInterval(() => {
        loadPage(1, false, true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [effectiveRole, loadPage])
  );

  useEffect(() => {
    if (effectiveRole !== "admin") return;
    const id = setTimeout(() => {
      setLoading(true);
      loadPage(1, false, true)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit trail"))
        .finally(() => setLoading(false));
    }, q.trim() ? 350 : 0);
    return () => clearTimeout(id);
  }, [category, effectiveRole, loadPage, outcome, q]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);
  const activeFilterCount = [Boolean(q.trim()), Boolean(category), Boolean(outcome)].filter(Boolean).length;

  const resetFilters = useCallback(() => {
    setQ("");
    setCategory("");
    setOutcome("");
  }, []);

  const selectEvent = useCallback(
    (event: AuditEvent) => {
      setSelectedEventId(event.id);
      if (!isSplitView) setDetailOpen(true);
    },
    [isSplitView]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPage(1, false, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh audit trail");
    } finally {
      setRefreshing(false);
    }
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(page + 1, true, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more audit events");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadPage, loadingMore, page]);

  const handleCopy = useCallback(async (label: string, value: string) => {
    const copied = await copyText(value).catch(() => false);
    if (!copied) return;
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 1600);
  }, []);

  const exportCsv = useCallback(async () => {
    const csv = buildAuditCsv(events);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return;
    }
    await handleCopy("csv", csv);
  }, [events, handleCopy]);

  const openSelectedEntity = useCallback(() => {
    if (!selectedEvent) return;
    setDetailOpen(false);
    const type = selectedEvent.entity.type;
    const id = selectedEvent.entity.id || selectedEvent.targetUser?.id || "";
    const parent = (navigation as any).getParent?.();

    if (type === "inventory_item" && id) {
      parent?.navigate?.("Inventory", { screen: "InventoryDetail", params: { id } });
      return;
    }
    if (type === "order" && id) {
      parent?.navigate?.("Orders", { screen: "OrderDetail", params: { id } });
      return;
    }
    if (type === "vendor" && id) {
      navigation.navigate("VendorsEdit", { id });
      return;
    }
    if (type === "tenant" || type === "tenant_membership" || type === "user" || type === "session") {
      navigation.navigate("Branches");
      return;
    }
    if (type === "feedback") {
      navigation.navigate("AdminFeedback");
      return;
    }
    if (type === "task_session") {
      navigation.navigate("Progress");
      return;
    }
    if (type === "reorder_request") {
      navigation.navigate("Reorders");
      return;
    }
    if (type === "gate_api_key") {
      navigation.navigate("GateKeys");
      return;
    }
    if (
      type === "rfid_event" ||
      type === "rfid_tag" ||
      type === "exit_session" ||
      type === "exit_authorization"
    ) {
      navigation.navigate("RfidHub");
      return;
    }
    if (type === "import_job" || type === "inventory_import") {
      navigation.navigate("Integrations");
    }
  }, [navigation, selectedEvent]);

  if (effectiveRole !== "admin") {
    return (
      <Screen
        title="Audit Trail"
        center
        right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      >
        <Badge label="Admin access required" tone="danger" />
        <MutedText style={{ marginTop: 10 }}>Audit history is restricted to administrators.</MutedText>
      </Screen>
    );
  }

  const filterPanel = (
    <Surface style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 10, alignItems: isDesktopWeb ? "center" : "stretch" }}>
        <TextField
          value={q}
          onChangeText={setQ}
          placeholder="Search actor, entity, route, request ID"
          autoCapitalize="none"
          containerStyle={{ flex: 1 }}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {activeFilterCount ? <AppButton title="Clear" onPress={resetFilters} variant="secondary" iconName="close-circle-outline" /> : null}
          <AppButton title="Refresh" onPress={onRefresh} variant="secondary" iconName="refresh" iconOnly />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8, paddingRight: 4 }}>
          {scopes.map((option) => (
            <FilterChip
              key={option.label}
              label={option.label}
              active={category === option.value}
              onPress={() => setCategory(option.value)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {outcomes.map((option) => (
          <FilterChip
            key={option.label}
            label={option.label}
            active={outcome === option.value}
            tone={option.value === "failure" ? "danger" : option.value === "success" ? "success" : "default"}
            onPress={() => setOutcome(option.value)}
          />
        ))}
      </View>
    </Surface>
  );

  const metricsPanel = (
    <Surface style={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: isDesktopWeb ? "row" : "column", alignItems: isDesktopWeb ? "center" : "flex-start", gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <LivePulse />
            <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Live activity</Text>
            {updating ? <MutedText>Updating</MutedText> : null}
          </View>
          <MutedText style={{ marginTop: 5 }}>Tenant-wide changes, security events, RFID activity, and user actions.</MutedText>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, flex: isDesktopWeb ? 1.2 : undefined, width: isDesktopWeb ? undefined : "100%" }}>
          <MetricTile icon="list-outline" label="Events" value={total} />
          <MetricTile icon="swap-horizontal-outline" label="Changes" value={summary.changes} tone="success" />
          <MetricTile icon="alert-circle-outline" label="Failures" value={summary.failures} tone={summary.failures > 0 ? "danger" : "default"} />
          <MetricTile icon="people-outline" label="Actors" value={summary.uniqueActors} />
        </View>
      </View>
    </Surface>
  );

  const tablePanel = (
    <Surface style={{ flex: 1 }}>
      {events.length ? (
        <>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
            }}
          >
            {[
              { label: "Time", width: 124 },
              { label: "Action", flex: 2.2 },
              { label: "Actor", flex: 1.25 },
              { label: "Entity", flex: 1.3 },
              { label: "State", width: 98 },
            ].map((column) => (
              <Text
                key={column.label}
                style={{
                  width: "width" in column ? column.width : undefined,
                  flex: "flex" in column ? column.flex : undefined,
                  paddingRight: 12,
                  color: theme.colors.textMuted,
                  fontSize: 11,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {column.label}
              </Text>
            ))}
          </View>

          {events.map((event) => {
            const active = selectedEventId === event.id;
            return (
              <Pressable
                key={event.id}
                onPress={() => selectEvent(event)}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 72,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                    borderLeftWidth: active ? 3 : 0,
                    borderLeftColor: active ? theme.colors.primary : "transparent",
                    backgroundColor: active || pressed ? theme.colors.surface2 : theme.colors.surface,
                    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                  },
                ]}
              >
                <View style={{ width: 124, paddingRight: 12 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700", fontFamily: monoFamily as any }} numberOfLines={2}>
                    {formatEventTime(event.createdAt)}
                  </Text>
                </View>
                <View style={{ flex: 2.2, minWidth: 0, paddingRight: 12, gap: 4 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "800" }} numberOfLines={1}>
                    {event.summary}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                    {formatEventSubtitle(event)}
                  </Text>
                </View>
                <View style={{ flex: 1.25, minWidth: 0, paddingRight: 12, gap: 4 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                    {formatActor(event)}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                    {event.actor.email || event.actor.role || event.actor.source || "-"}
                  </Text>
                </View>
                <View style={{ flex: 1.3, minWidth: 0, paddingRight: 12, gap: 4 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                    {formatEntity(event)}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                    {formatTargetMeta(event)}
                  </Text>
                </View>
                <View style={{ width: 98, alignItems: "flex-end" }}>
                  <OutcomePill event={event} />
                </View>
              </Pressable>
            );
          })}
        </>
      ) : (
        <View style={{ padding: 18, alignItems: "center", gap: 8 }}>
          <Ionicons name="document-text-outline" size={28} color={theme.colors.textMuted} />
          <MutedText>{q.trim() || category || outcome ? "No audit events match these filters." : "No audit events recorded yet."}</MutedText>
        </View>
      )}
    </Surface>
  );

  const mobileCards = (
    <View style={{ gap: 10 }}>
      {events.length ? (
        events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => selectEvent(event)}
            style={({ pressed }) => [
              {
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                padding: 14,
                gap: 12,
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "800" }} numberOfLines={2}>
                  {event.summary}
                </Text>
                <MutedText style={{ marginTop: 4 }}>{formatEventTime(event.createdAt)}</MutedText>
              </View>
              <OutcomePill event={event} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Badge label={categoryLabel(event.category)} tone="default" />
              <Badge label={formatActor(event)} tone="default" />
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <MutedText>Entity</MutedText>
                <Text style={{ color: theme.colors.text, fontWeight: "700", marginTop: 3 }} numberOfLines={1}>
                  {formatEntity(event)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </View>
          </Pressable>
        ))
      ) : (
        <Surface style={{ padding: 18, alignItems: "center", gap: 8 }}>
          <Ionicons name="document-text-outline" size={28} color={theme.colors.textMuted} />
          <MutedText>{q.trim() || category || outcome ? "No audit events match these filters." : "No audit events recorded yet."}</MutedText>
        </Surface>
      )}
    </View>
  );

  return (
    <Screen
      title="Audit Trail"
      scroll
      busy={loading && !events.length}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      right={
        <View style={{ flexDirection: "row", gap: 8 }}>
          {events.length ? <AppButton title="Export CSV" onPress={exportCsv} variant="secondary" iconName="download-outline" iconOnly={!isDesktopWeb} /> : null}
          <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
        </View>
      }
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {metricsPanel}
      {filterPanel}

      {isSplitView ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md }}>
          {tablePanel}
          <Surface style={{ width: 360, padding: 16 }}>
            {selectedEvent ? (
              <DetailPanel
                event={selectedEvent}
                copiedLabel={copiedLabel}
                onCopy={handleCopy}
                onOpenEntity={openSelectedEntity}
              />
            ) : (
              <MutedText>Select an event to inspect its actor, entity, request, and metadata.</MutedText>
            )}
          </Surface>
        </View>
      ) : isTableView ? (
        tablePanel
      ) : (
        mobileCards
      )}

      {hasMore ? (
        <AppButton title={loadingMore ? "Loading..." : "Load more"} onPress={loadMore} disabled={loadingMore} loading={loadingMore} variant="secondary" />
      ) : null}

      {!isSplitView && selectedEvent ? (
        <Modal transparent visible={detailOpen} animationType="fade" onRequestClose={() => setDetailOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(15, 23, 42, 0.34)" }} onPress={() => setDetailOpen(false)} />
          <View
            style={{
              position: "absolute",
              left: isDesktopWeb ? "50%" : 0,
              right: isDesktopWeb ? undefined : 0,
              bottom: 0,
              width: isDesktopWeb ? 520 : undefined,
              maxHeight: "88%",
              transform: isDesktopWeb ? [{ translateX: -260 }] : undefined,
              padding: theme.spacing.md,
            }}
          >
            <Surface style={{ padding: 16 }}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <DetailPanel
                  event={selectedEvent}
                  copiedLabel={copiedLabel}
                  onCopy={handleCopy}
                  onOpenEntity={openSelectedEntity}
                  onClose={() => setDetailOpen(false)}
                  compact
                />
              </ScrollView>
            </Surface>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
