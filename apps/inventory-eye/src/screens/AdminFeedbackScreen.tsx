import React, { useCallback, useContext, useMemo, useState } from "react";
import { FlatList, Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type FeedbackCategory = "usability" | "data_accuracy" | "issue" | "suggestion";

type FeedbackStatus = "new" | "reviewed" | "resolved";

type FeedbackItem = {
  _id: string;
  category: FeedbackCategory;
  message: string;
  rating?: number;
  status: FeedbackStatus;
  createdAt?: string;
};

type Props = NativeStackScreenProps<MoreStackParamList, "AdminFeedback">;

const statuses: FeedbackStatus[] = ["new", "reviewed", "resolved"];

export function AdminFeedbackScreen({ navigation }: Props) {
  const { token, user } = useContext(AuthContext);
  const isAdmin = user?.role === "admin";

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const isWeb = Platform.OS === "web";

  const onBack = useCallback(() => {
    if (isDesktopWeb) {
      navigation.navigate("Feedback");
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Feedback");
  }, [isDesktopWeb, navigation]);

  const [q, setQ] = useState("");
  const [all, setAll] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filteredAll = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((f) => {
      const blob = `${f._id} ${f.category} ${f.status} ${f.message}`.toLowerCase();
      return blob.includes(t) || f._id.slice(-6).toLowerCase().includes(t);
    });
  }, [all, q]);

  const load = useCallback(async () => {
    if (!token || !isAdmin) return;
    setError(null);

    const allRes = await apiRequest<{ ok: true; feedback: FeedbackItem[] }>("/feedback/all", { method: "GET", token });
    setAll(allRes.feedback);
  }, [isAdmin, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  async function setStatus(id: string, status: FeedbackStatus) {
    if (!token || !isAdmin) return;

    setError(null);
    try {
      await apiRequest<{ ok: true; feedback: FeedbackItem }>(`/feedback/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  return (
    <Screen
      title="Admin feedback"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {!isAdmin ? (
        <Card>
          <ErrorText>Admins only</ErrorText>
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Search</Text>
            <TextField value={q} onChangeText={setQ} placeholder="Message, status, category" autoCapitalize="none" />
          </Card>

          {error ? <ErrorText>{error}</ErrorText> : null}

          <Card>
            <View
              style={{
                flexDirection: isDesktopWeb ? "row" : "column",
                alignItems: isDesktopWeb ? "center" : "flex-start",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>All feedback</Text>
              <Badge label={`${filteredAll.length}`} tone="default" />
            </View>

            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredAll.length ? (
                  filteredAll.map((item) => (
                    <Card key={item._id}>
                      <ListRow
                        title={item.category}
                        subtitle={item.message}
                        meta={
                          `${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}` +
                          `${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`
                        }
                        right={
                          <Badge
                            label={item.status}
                            tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                          />
                        }
                      />

                      <View style={{ height: 10 }} />
                      <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Set status</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {statuses.map((s) => (
                          <AppButton
                            key={s}
                            title={s}
                            onPress={() => setStatus(item._id, s)}
                            variant={s === item.status ? "primary" : "secondary"}
                          />
                        ))}
                      </View>
                    </Card>
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching feedback" : "No feedback"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredAll}
                keyExtractor={(f) => f._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching feedback" : "No feedback"}</MutedText>
                }
                renderItem={({ item }) => (
                  <Card>
                    <ListRow
                      title={item.category}
                      subtitle={item.message}
                      meta={
                        `${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}` +
                        `${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`
                      }
                      right={
                        <Badge
                          label={item.status}
                          tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                        />
                      }
                    />

                    <View style={{ height: 10 }} />
                    <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Set status</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {statuses.map((s) => (
                        <AppButton
                          key={s}
                          title={s}
                          onPress={() => setStatus(item._id, s)}
                          variant={s === item.status ? "primary" : "secondary"}
                        />
                      ))}
                    </View>
                  </Card>
                )}
              />
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
