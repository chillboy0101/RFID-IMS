import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, ErrorText, GLOBAL_AUTO_REFRESH_MS, MutedText, Screen, TextField, theme } from "../ui";

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
  { value: "admin", label: "Admin" },
  { value: "auth", label: "Security" },
  { value: "progress", label: "Progress" },
  { value: "integrations", label: "Imports" },
] as const;

const outcomes = [
  { value: "", label: "All activity" },
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

  if (event.actor.name?.trim()) {
    return event.actor.name.trim();
  }

  if (event.actor.email?.trim()) {
    return event.actor.email.trim();
  }

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

function formatMetadataEntries(metadata?: Record<string, unknown> | null): Array<[string, string]> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([key, value]) => value != null && key !== "error")
    .slice(0, 6)
    .map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (typeof value === "number" || typeof value === "boolean") return [key, String(value)];
      return [key, JSON.stringify(value)];
    });
}

function categoryLabel(category: string): string {
  const match = scopes.find((scope) => scope.value === category);
  return match?.label ?? (category || "System");
}

function outcomeTone(event: AuditEvent): "default" | "success" | "danger" {
  if (event.request.outcome === "failure") return "danger";
  if (event.request.outcome === "success" || !event.request.outcome) return "success";
  return "default";
}

function formatEventSubtitle(event: AuditEvent): string {
  if (event.category === "progress") {
    const kindLabel = event.metadata && typeof event.metadata.kindLabel === "string" ? event.metadata.kindLabel : null;
    return kindLabel?.trim() ? `Progress / ${kindLabel.trim()}` : "Progress";
  }

  return `${categoryLabel(event.category)} / ${event.type}`;
}

function formatTargetMeta(event: AuditEvent): string {
  if (event.category === "progress") {
    const mode = event.metadata && typeof event.metadata.mode === "string" ? event.metadata.mode : null;
    if (mode?.trim()) {
      return mode.trim().replace(/\b\w/g, (char) => char.toUpperCase());
    }
  }

  return event.entity.type || event.targetUser?.role || "-";
}

export function AuditScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

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
  const loadInFlightRef = useRef(false);

  const buildPath = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", "40");
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (outcome) params.set("outcome", outcome);
      return `/audit?${params.toString()}`;
    },
    [category, outcome, q]
  );

  const loadPage = useCallback(
    async (nextPage: number, append: boolean, showUpdating: boolean) => {
      if (!token) return;
      if (loadInFlightRef.current) return;

      loadInFlightRef.current = true;
      if (showUpdating) setUpdating(true);

      try {
        setError(null);
        const res = await apiRequest<AuditResponse>(buildPath(nextPage), { method: "GET", token });
        setEvents((prev) => (append ? [...prev, ...res.events] : res.events));
        setSummary(res.summary);
        setPage(res.page);
        setHasMore(res.hasMore);
        setTotal(res.total);
      } finally {
        loadInFlightRef.current = false;
        if (showUpdating) setUpdating(false);
      }
    },
    [buildPath, token]
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
      setLoading(true);
      loadPage(1, false, true)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit trail"))
        .finally(() => setLoading(false));

      const id = setInterval(() => {
        loadPage(1, false, true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [loadPage])
  );

  useEffect(() => {
    const id = setTimeout(() => {
      loadPage(1, false, true).catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit trail"));
    }, 450);
    return () => clearTimeout(id);
  }, [category, outcome, q, loadPage]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);
  const visibleEvents = useMemo(() => events, [events]);
  const activeFilterCount = [Boolean(q.trim()), Boolean(category), Boolean(outcome)].filter(Boolean).length;

  const surfaceStyle = {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    overflow: "hidden" as const,
  };

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadPage(1, false, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh audit trail");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(page + 1, true, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more audit events");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Screen
      title="Audit Trail"
      scroll
      busy={loading || updating}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View
        style={[
          surfaceStyle,
          {
            padding: 16,
            gap: 14,
          },
        ]}
      >
        <View
          style={{
            flexDirection: isDesktopWeb ? "row" : "column",
            alignItems: isDesktopWeb ? "center" : "flex-start",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Operational log</Text>
            <MutedText style={{ marginTop: 4 }}>
              Minimal tenant-wide activity across inventory, orders, RFID, people, and security events.
            </MutedText>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "Events", value: total, tone: "default" as const },
              { label: "Failures", value: summary.failures, tone: summary.failures > 0 ? ("danger" as const) : ("default" as const) },
              { label: "Changes", value: summary.changes, tone: "success" as const },
              { label: "Actors", value: summary.uniqueActors, tone: "default" as const },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  minWidth: 92,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "700" }}>{item.label}</Text>
                <Text
                  style={{
                    marginTop: 4,
                    color:
                      item.tone === "danger"
                        ? theme.colors.danger
                        : item.tone === "success"
                          ? theme.colors.success
                          : theme.colors.text,
                    fontSize: 18,
                    fontWeight: "800",
                  }}
                >
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 10 }}>
            <TextField
              value={q}
              onChangeText={setQ}
              placeholder="Search actor, entity, route, request ID"
              autoCapitalize="none"
              containerStyle={{ flex: 1 }}
            />
            {activeFilterCount ? (
              <AppButton
                title="Clear"
                onPress={() => {
                  setQ("");
                  setCategory("");
                  setOutcome("");
                }}
                variant="secondary"
              />
            ) : null}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {scopes.map((option) => {
              const active = category === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setCategory(option.value)}
                  style={({ pressed }) => [
                    {
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.text : theme.colors.border,
                      backgroundColor: active ? theme.colors.text : pressed ? theme.colors.surface : theme.colors.surface2,
                      ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                    },
                  ]}
                >
                  <Text style={{ color: active ? theme.colors.bg : theme.colors.textMuted, fontSize: 12, fontWeight: "700" }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {outcomes.map((option) => {
              const active = outcome === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setOutcome(option.value)}
                  style={({ pressed }) => [
                    {
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.danger : theme.colors.border,
                      backgroundColor: active ? "rgba(239, 68, 68, 0.14)" : pressed ? theme.colors.surface : theme.colors.surface2,
                      ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                    },
                  ]}
                >
                  <Text style={{ color: active ? theme.colors.danger : theme.colors.textMuted, fontSize: 12, fontWeight: "700" }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={surfaceStyle}>
        {visibleEvents.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: isDesktopWeb ? 1120 : 760 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                {[
                  { label: "Time", width: 154 },
                  { label: "Event", width: 332 },
                  { label: "Actor", width: 210 },
                  { label: "Target", width: 210 },
                  { label: "Request", width: 164 },
                  { label: "State", width: 90 },
                ].map((column) => (
                  <Text
                    key={column.label}
                    style={{
                      width: column.width,
                      color: theme.colors.textMuted,
                      fontSize: 11,
                      fontWeight: "700",
                      textTransform: "uppercase",
                    }}
                  >
                    {column.label}
                  </Text>
                ))}
              </View>

              {visibleEvents.map((event) => {
                const active = selectedEventId === event.id;
                const stateTone = outcomeTone(event);
                return (
                  <Pressable
                    key={event.id}
                    onPress={() => setSelectedEventId(event.id)}
                    style={({ pressed }) => [
                      {
                        flexDirection: "row",
                        alignItems: "flex-start",
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.border,
                        backgroundColor: active ? theme.colors.surface2 : pressed ? theme.colors.surface2 : theme.colors.surface,
                        ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                      },
                    ]}
                  >
                    <View style={{ width: 154, paddingRight: 12 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700", fontFamily: monoFamily as any }}>
                        {formatEventTime(event.createdAt)}
                      </Text>
                    </View>

                    <View style={{ width: 332, paddingRight: 14, gap: 4 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }}>{event.summary}</Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                        {formatEventSubtitle(event)}
                      </Text>
                    </View>

                    <View style={{ width: 210, paddingRight: 14, gap: 4 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                        {formatActor(event)}
                      </Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                        {event.actor.email || event.actor.role || "-"}
                      </Text>
                    </View>

                    <View style={{ width: 210, paddingRight: 14, gap: 4 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                        {formatEntity(event)}
                      </Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                        {formatTargetMeta(event)}
                      </Text>
                    </View>

                    <View style={{ width: 164, paddingRight: 14, gap: 4 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontFamily: monoFamily as any }} numberOfLines={1}>
                        {formatRoute(event)}
                      </Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                        {event.request.statusCode ? `HTTP ${event.request.statusCode}` : event.request.requestId ? `Req ${event.request.requestId}` : "-"}
                      </Text>
                    </View>

                    <View style={{ width: 90, alignItems: "flex-start" }}>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor:
                            stateTone === "danger"
                              ? "rgba(239, 68, 68, 0.16)"
                              : stateTone === "success"
                                ? "rgba(34, 197, 94, 0.14)"
                                : theme.colors.surface2,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              stateTone === "danger"
                                ? theme.colors.danger
                                : stateTone === "success"
                                  ? theme.colors.success
                                  : theme.colors.textMuted,
                            fontSize: 11,
                            fontWeight: "700",
                            textTransform: "uppercase",
                          }}
                        >
                          {event.request.outcome === "failure" ? "Failure" : "Success"}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <View style={{ padding: 16 }}>
            <MutedText>{q.trim() || category || outcome ? "No audit events match these filters." : "No audit events recorded yet."}</MutedText>
          </View>
        )}
      </View>

      {selectedEvent ? (
        <View
          style={[
            surfaceStyle,
            {
              padding: 16,
              gap: 14,
            },
          ]}
        >
          <View
            style={{
              flexDirection: isDesktopWeb ? "row" : "column",
              alignItems: isDesktopWeb ? "center" : "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{selectedEvent.summary}</Text>
              <MutedText style={{ marginTop: 4 }}>{formatEventTime(selectedEvent.createdAt)}</MutedText>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                {categoryLabel(selectedEvent.category)}
              </Text>
              <Text
                style={{
                  color: outcomeTone(selectedEvent) === "danger" ? theme.colors.danger : theme.colors.success,
                  fontSize: 12,
                  fontWeight: "700",
                  backgroundColor: outcomeTone(selectedEvent) === "danger" ? "rgba(239, 68, 68, 0.14)" : "rgba(34, 197, 94, 0.14)",
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                {selectedEvent.request.outcome === "failure" ? "Failure" : "Success"}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: isDesktopWeb ? "row" : "column",
              flexWrap: isDesktopWeb ? "wrap" : "nowrap",
              gap: 12,
            }}
          >
            {[
              { label: "Actor", value: formatActor(selectedEvent) },
              { label: "Actor detail", value: selectedEvent.actor.email || selectedEvent.actor.role || "-" },
              { label: "Target", value: formatEntity(selectedEvent) },
              { label: "Request", value: formatRoute(selectedEvent) },
              { label: "Request ID", value: selectedEvent.request.requestId || "-" },
              { label: "Status", value: selectedEvent.request.statusCode ? `HTTP ${selectedEvent.request.statusCode}` : "-" },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  minWidth: isDesktopWeb ? 190 : "100%",
                  flex: isDesktopWeb ? 1 : undefined,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{item.label}</Text>
                <Text
                  style={{
                    marginTop: 6,
                    color: theme.colors.text,
                    fontSize: 13,
                    fontWeight: "600",
                    fontFamily: item.label === "Request" || item.label === "Request ID" ? (monoFamily as any) : undefined,
                  }}
                >
                  {item.value}
                </Text>
              </View>
            ))}
          </View>

          {selectedEvent.fromRole || selectedEvent.toRole ? (
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Role change</Text>
              <Text style={{ marginTop: 6, color: theme.colors.text, fontSize: 13, fontWeight: "600" }}>
                {selectedEvent.fromRole ?? "-"} to {selectedEvent.toRole ?? "-"}
              </Text>
            </View>
          ) : null}

          {formatMetadataEntries(selectedEvent.metadata).length ? (
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                backgroundColor: theme.colors.surface2,
                gap: 8,
              }}
            >
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Metadata</Text>
              {formatMetadataEntries(selectedEvent.metadata).map(([key, value]) => (
                <View key={key} style={{ flexDirection: "row", gap: 10 }}>
                  <Text style={{ width: 120, color: theme.colors.textMuted, fontSize: 12, fontFamily: monoFamily as any }}>{key}</Text>
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: 12 }}>{value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {selectedEvent.metadata && typeof selectedEvent.metadata.error === "string" ? (
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                backgroundColor: "rgba(239, 68, 68, 0.08)",
              }}
            >
              <Text style={{ color: theme.colors.danger, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Error</Text>
              <ErrorText style={{ marginTop: 6 }}>{selectedEvent.metadata.error}</ErrorText>
            </View>
          ) : null}
        </View>
      ) : null}

      {hasMore ? (
        <AppButton title={loadingMore ? "Loading..." : "Load more"} onPress={loadMore} disabled={loadingMore} variant="secondary" />
      ) : null}
    </Screen>
  );
}
