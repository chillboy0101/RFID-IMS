import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { formatTaskSessionRoute, taskSessionKindLabels, type TaskSessionKind } from "../progress/workflow";
import { GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type Session = {
  _id: string;
  kind: TaskSessionKind;
  startedAt: string;
  endedAt?: string | null;
  createdAt?: string;
  meta?: Record<string, unknown> | null;
};

type SummaryResponse = {
  ok: true;
  window: { days: number; since: string };
  timeSpent: { totalSeconds: number; openSessions: number };
  completedInventoryUpdates: { count: number };
  orderFulfillmentProgress: { fulfilledByUserCount: number; openOrdersCount: number; fulfilledOrdersCount: number };
};

type Props = NativeStackScreenProps<MoreStackParamList, "Progress">;

const kinds: TaskSessionKind[] = ["inventory_update", "order_fulfillment", "other"];

function formatSessionLabel(session: Session): string {
  return taskSessionKindLabels[session.kind] ?? session.kind;
}

function formatSessionMode(session: Session): string {
  return session.meta?.mode === "automatic" ? "Automatic" : "Manual";
}

function buildSessionSubtitle(session: Session): string {
  const routeLabel = formatTaskSessionRoute(session.meta ?? null);
  const modeLabel = formatSessionMode(session);
  const routeLine = routeLabel ? `${modeLabel}  |  ${routeLabel}` : modeLabel;
  return `Start: ${new Date(session.startedAt).toLocaleString()}\nEnd: ${session.endedAt ? new Date(session.endedAt).toLocaleString() : "-"}\n${routeLine}`;
}

export function ProgressScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") {
      navigation.popToTop();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const [days, setDays] = useState("7");
  const [historyKind, setHistoryKind] = useState<TaskSessionKind | "">("");

  const [sessions, setSessions] = useState<Session[]>([]);
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);

  const openSession = useMemo(() => sessions.find((s) => !s.endedAt) ?? null, [sessions]);
  const openSessionRouteLabel = useMemo(() => formatTaskSessionRoute(openSession?.meta ?? null), [openSession]);

  const filteredSessions = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sessions.filter((session) => {
      if (historyKind && session.kind !== historyKind) return false;
      if (!t) return true;

      const blob = [
        session._id,
        session.kind,
        formatSessionLabel(session),
        formatSessionMode(session),
        formatTaskSessionRoute(session.meta ?? null) ?? "",
        new Date(session.startedAt).toLocaleString(),
        session.endedAt ? new Date(session.endedAt).toLocaleString() : "",
      ]
        .join(" ")
        .toLowerCase();

      return blob.includes(t) || session._id.slice(-6).toLowerCase().includes(t);
    });
  }, [historyKind, q, sessions]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);

    const [sessionsRes, summaryRes] = await Promise.all([
      apiRequest<{ ok: true; sessions: Session[] }>("/progress/sessions/me", { method: "GET", token }),
      apiRequest<SummaryResponse>(`/progress/summary?days=${encodeURIComponent(days.trim() || "7")}`, { method: "GET", token }),
    ]);

    setSessions(sessionsRes.sessions);
    setSummary(summaryRes);
  }, [days, token]);

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

  useEffect(() => {
    const d = days.trim();
    if (!d) return;

    const id = setTimeout(() => {
      loadSafe(true).catch(() => undefined);
    }, 600);

    return () => clearTimeout(id);
  }, [days, loadSafe]);

  const renderHistoryRows = () => {
    if (loading) {
      return <MutedText>Loading...</MutedText>;
    }

    if (!filteredSessions.length) {
      return <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>;
    }

    return filteredSessions.map((item) => (
      <ListRow
        key={item._id}
        title={formatSessionLabel(item)}
        subtitle={buildSessionSubtitle(item)}
        right={item.endedAt ? <Badge label="Done" tone="success" /> : <Badge label="Open" tone="warning" />}
      />
    ));
  };

  return (
    <Screen
      title="Progress"
      scroll
      busy={loading || updating}
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Automatic tracking</Text>
                <MutedText style={{ marginTop: 6 }}>
                  Progress follows the workflow you are using in the app. Inventory, fulfilment, and support work are tracked in the background.
                </MutedText>
              </View>
              {openSession ? <Badge label="Tracking" tone="success" size="header" /> : <Badge label="Idle" tone="default" size="header" />}
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
              <View style={{ width: 170 }}>
                <TextField label="Window days" value={days} onChangeText={setDays} keyboardType="numeric" />
              </View>

              <View style={{ flexGrow: 1 }} />

              <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: 10, alignItems: "center" }}>
                <Badge label={`Time(s): ${summary?.timeSpent.totalSeconds ?? "-"}`} size="header" />
                <Badge
                  label={`Open: ${summary?.timeSpent.openSessions ?? "-"}`}
                  tone={typeof summary?.timeSpent.openSessions === "number" && summary.timeSpent.openSessions > 0 ? "warning" : "default"}
                  size="header"
                />
                <Badge label={`Inv updates: ${summary?.completedInventoryUpdates.count ?? "-"}`} size="header" />
                <Badge label={`Fulfilled by you: ${summary?.orderFulfillmentProgress.fulfilledByUserCount ?? "-"}`} tone="primary" size="header" />
              </View>
            </View>

            <View style={{ height: 14 }} />
            <View style={{ minHeight: 84, justifyContent: openSession ? "flex-start" : "center" }}>
              {openSession ? (
                <ListRow
                  title={`Current: ${formatSessionLabel(openSession)}`}
                  subtitle={`${formatSessionMode(openSession)}${openSessionRouteLabel ? `  |  ${openSessionRouteLabel}` : ""}\nStarted: ${new Date(openSession.startedAt).toLocaleString()}`}
                  right={null}
                />
              ) : (
                <MutedText>No active workflow right now. A session starts automatically when you move through the app and pauses when you go idle or leave the app.</MutedText>
              )}
            </View>
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>History</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <AppButton title="All" onPress={() => setHistoryKind("")} variant={!historyKind ? "primary" : "secondary"} />
              {kinds.map((kind) => (
                <AppButton
                  key={kind}
                  title={taskSessionKindLabels[kind]}
                  onPress={() => setHistoryKind(kind)}
                  variant={historyKind === kind ? "primary" : "secondary"}
                />
              ))}
            </View>
            <TextField value={q} onChangeText={setQ} placeholder="Search: workflow, route, or date" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            <View style={{ gap: 10, minHeight: 140, justifyContent: loading ? "center" : "flex-start" }}>{renderHistoryRows()}</View>
          </Card>
        </View>
      ) : (
        <>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Automatic tracking</Text>
            <MutedText style={{ marginBottom: 12 }}>
              Progress follows the workflow you are using in the app. Sessions pause when you go idle or leave the app.
            </MutedText>
            <TextField label="Window days" value={days} onChangeText={setDays} keyboardType="numeric" />
            <View style={{ height: 12 }} />

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Badge label={`Time(s): ${summary?.timeSpent.totalSeconds ?? "-"}`} />
              <Badge
                label={`Open: ${summary?.timeSpent.openSessions ?? "-"}`}
                tone={typeof summary?.timeSpent.openSessions === "number" && summary.timeSpent.openSessions > 0 ? "warning" : "default"}
              />
              <Badge label={`Inv updates: ${summary?.completedInventoryUpdates.count ?? "-"}`} />
              <Badge label={`Fulfilled by you: ${summary?.orderFulfillmentProgress.fulfilledByUserCount ?? "-"}`} tone="primary" />
            </View>

            <View style={{ height: 14 }} />
            {openSession ? (
              <ListRow
                title={`Current: ${formatSessionLabel(openSession)}`}
                subtitle={`${formatSessionMode(openSession)}${openSessionRouteLabel ? `  |  ${openSessionRouteLabel}` : ""}\nStarted: ${new Date(openSession.startedAt).toLocaleString()}`}
                right={<Badge label="Tracking" tone="success" />}
              />
            ) : (
              <MutedText>No active workflow right now.</MutedText>
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>History</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <AppButton title="All" onPress={() => setHistoryKind("")} variant={!historyKind ? "primary" : "secondary"} />
              {kinds.map((kind) => (
                <AppButton
                  key={kind}
                  title={taskSessionKindLabels[kind]}
                  onPress={() => setHistoryKind(kind)}
                  variant={historyKind === kind ? "primary" : "secondary"}
                />
              ))}
            </View>
            <TextField value={q} onChangeText={setQ} placeholder="Search: workflow, route, or date" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10 }}>{renderHistoryRows()}</View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredSessions}
                keyExtractor={(session) => session._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>}
                renderItem={({ item }) => (
                  <ListRow
                    title={formatSessionLabel(item)}
                    subtitle={buildSessionSubtitle(item)}
                    right={item.endedAt ? <Badge label="Done" tone="success" /> : <Badge label="Open" tone="warning" />}
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
