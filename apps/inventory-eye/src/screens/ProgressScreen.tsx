import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type TaskSessionKind = "inventory_update" | "order_fulfillment" | "other";

type Session = {
  _id: string;
  kind: TaskSessionKind;
  startedAt: string;
  endedAt?: string | null;
  createdAt?: string;
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

const kindLabels: Record<TaskSessionKind, string> = {
  inventory_update: "Inventory updates",
  order_fulfillment: "Order fulfillment",
  other: "Other",
};

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
  const [kind, setKind] = useState<TaskSessionKind>("inventory_update");
  const [historyKind, setHistoryKind] = useState<TaskSessionKind | "">("");

  const [sessions, setSessions] = useState<Session[]>([]);
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);
  const loadInFlightRef = useRef(false);

  const openSession = useMemo(() => sessions.find((s) => !s.endedAt) ?? null, [sessions]);

  const filteredSessions = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (historyKind && s.kind !== historyKind) return false;
      if (!t) return true;
      const blob = `${s._id} ${s.kind} ${new Date(s.startedAt).toLocaleString()} ${s.endedAt ? new Date(s.endedAt).toLocaleString() : ""}`.toLowerCase();
      return blob.includes(t) || s._id.slice(-6).toLowerCase().includes(t);
    });
  }, [historyKind, q, sessions]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);

    const [meRes, summaryRes] = await Promise.all([
      apiRequest<{ ok: true; sessions: Session[] }>("/progress/sessions/me", { method: "GET", token }),
      apiRequest<SummaryResponse>(`/progress/summary?days=${encodeURIComponent(days.trim() || "7")}`, { method: "GET", token }),
    ]);

    setSessions(meRes.sessions);
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

  async function startSession() {
    if (!token || starting) return;

    setStarting(true);
    setError(null);

    try {
      await apiRequest<{ ok: true; session: Session }>("/progress/sessions/start", {
        method: "POST",
        token,
        body: JSON.stringify({ kind }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  async function stopSession(id: string) {
    if (!token) return;

    setError(null);

    try {
      await apiRequest<{ ok: true; session: Session }>(`/progress/sessions/${id}/stop`, {
        method: "POST",
        token,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    }
  }

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
                <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Today’s work</Text>
                <MutedText style={{ marginTop: 6 }}>Start a timer for your current task and see your recent activity.</MutedText>
              </View>
              {openSession ? <Badge label="Running" tone="warning" size="header" /> : <Badge label="Not running" tone="default" size="header" />}
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
            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>What are you working on?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {kinds.map((k) => (
                <AppButton key={k} title={kindLabels[k]} onPress={() => setKind(k)} variant={k === kind ? "primary" : "secondary"} />
              ))}
            </View>

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <AppButton title={starting ? "Starting..." : "Start"} onPress={startSession} disabled={starting || !!openSession} loading={starting} />
              <AppButton
                title="Stop"
                onPress={() => (openSession ? stopSession(openSession._id) : undefined)}
                variant="danger"
                disabled={!openSession}
              />
            </View>

            <View style={{ height: 10 }} />
            {openSession ? (
              <ListRow
                title={`Current: ${kindLabels[openSession.kind]}`}
                subtitle={new Date(openSession.startedAt).toLocaleString()}
                right={null}
              />
            ) : (
              <MutedText>No open timer</MutedText>
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>History</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <AppButton title="All" onPress={() => setHistoryKind("")} variant={!historyKind ? "primary" : "secondary"} />
              {kinds.map((k) => (
                <AppButton
                  key={k}
                  title={kindLabels[k]}
                  onPress={() => setHistoryKind(k)}
                  variant={historyKind === k ? "primary" : "secondary"}
                />
              ))}
            </View>
            <TextField value={q} onChangeText={setQ} placeholder="Search: kind or date" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredSessions.length ? (
                  filteredSessions.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.kind}
                      subtitle={`Start: ${new Date(item.startedAt).toLocaleString()}\nEnd: ${item.endedAt ? new Date(item.endedAt).toLocaleString() : "-"}`}
                      right={item.endedAt ? <Badge label="Done" tone="success" /> : <Badge label="Open" tone="warning" />}
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredSessions}
                keyExtractor={(s) => s._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>
                }
                renderItem={({ item }) => (
                  <ListRow
                    title={item.kind}
                    subtitle={`Start: ${new Date(item.startedAt).toLocaleString()}\nEnd: ${item.endedAt ? new Date(item.endedAt).toLocaleString() : "-"}`}
                    right={item.endedAt ? <Badge label="Done" tone="success" /> : <Badge label="Open" tone="warning" />}
                  />
                )}
              />
            )}
          </Card>
        </View>
      ) : (
        <>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Today’s work</Text>
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
            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>What are you working on?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {kinds.map((k) => (
                <AppButton key={k} title={kindLabels[k]} onPress={() => setKind(k)} variant={k === kind ? "primary" : "secondary"} />
              ))}
            </View>

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <AppButton title={starting ? "Starting..." : "Start"} onPress={startSession} disabled={starting || !!openSession} loading={starting} />
              <AppButton
                title="Stop"
                onPress={() => (openSession ? stopSession(openSession._id) : undefined)}
                variant="danger"
                disabled={!openSession}
              />
              {openSession ? <Badge label="Running" tone="warning" /> : <Badge label="Not running" tone="default" />}
            </View>

            <View style={{ height: 10 }} />
            {openSession ? (
              <ListRow title={`Current: ${kindLabels[openSession.kind]}`} subtitle={new Date(openSession.startedAt).toLocaleString()} right={null} />
            ) : (
              <MutedText>No open timer</MutedText>
            )}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>History</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <AppButton title="All" onPress={() => setHistoryKind("")} variant={!historyKind ? "primary" : "secondary"} />
              {kinds.map((k) => (
                <AppButton
                  key={k}
                  title={kindLabels[k]}
                  onPress={() => setHistoryKind(k)}
                  variant={historyKind === k ? "primary" : "secondary"}
                />
              ))}
            </View>
            <TextField value={q} onChangeText={setQ} placeholder="Search: kind or date" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredSessions.length ? (
                  filteredSessions.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.kind}
                      subtitle={`Start: ${new Date(item.startedAt).toLocaleString()}\nEnd: ${item.endedAt ? new Date(item.endedAt).toLocaleString() : "-"}`}
                      right={item.endedAt ? <Badge label="Done" tone="success" /> : <Badge label="Open" tone="warning" />}
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredSessions}
                keyExtractor={(s) => s._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching sessions" : "No sessions"}</MutedText>
                }
                renderItem={({ item }) => (
                  <ListRow
                    title={item.kind}
                    subtitle={`Start: ${new Date(item.startedAt).toLocaleString()}\nEnd: ${item.endedAt ? new Date(item.endedAt).toLocaleString() : "-"}`}
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
