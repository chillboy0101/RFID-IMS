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

type Props = NativeStackScreenProps<MoreStackParamList, "Feedback">;

const categories: FeedbackCategory[] = ["usability", "data_accuracy", "issue", "suggestion"];

export function FeedbackScreen({ navigation }: Props) {
  const { token, user } = useContext(AuthContext);
  const isAdmin = user?.role === "admin";

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

  const [q, setQ] = useState("");

  const [category, setCategory] = useState<FeedbackCategory>("usability");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("");

  const [mine, setMine] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => message.trim().length > 0, [message]);

  const filteredMine = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return mine;
    return mine.filter((f) => {
      const blob = `${f._id} ${f.category} ${f.status} ${f.message}`.toLowerCase();
      return blob.includes(t) || f._id.slice(-6).toLowerCase().includes(t);
    });
  }, [mine, q]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);

    const myRes = await apiRequest<{ ok: true; feedback: FeedbackItem[] }>("/feedback/me", { method: "GET", token });
    setMine(myRes.feedback);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  async function submit() {
    if (!token || !canSubmit || submitting) return;

    const r = rating.trim() ? Number(rating) : undefined;
    if (typeof r === "number" && (!Number.isFinite(r) || r < 1 || r > 5)) {
      setError("Rating must be between 1 and 5");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest<{ ok: true; feedback: FeedbackItem }>("/feedback", {
        method: "POST",
        token,
        body: JSON.stringify({ category, message: message.trim(), rating: r }),
      });
      setMessage("");
      setRating("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title="Feedback"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ gap: theme.spacing.md }}>
          {isAdmin ? (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Admin</Text>
                  <MutedText style={{ marginTop: 6 }}>Review all feedback and set status</MutedText>
                </View>
                <AppButton title="Manage all" onPress={() => navigation.navigate("AdminFeedback")} />
              </View>
            </Card>
          ) : null}

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Submit</Text>

            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Category</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {categories.map((c) => (
                <AppButton key={c} title={c} onPress={() => setCategory(c)} variant={c === category ? "primary" : "secondary"} />
              ))}
            </View>

            <View style={{ height: 12 }} />

            <TextField
              label="Message"
              value={message}
              onChangeText={setMessage}
              placeholder="Tell us what happened or what we should improve"
              multiline
              numberOfLines={4}
            />

            <View style={{ height: 12 }} />

            <TextField label="Rating (1-5)" value={rating} onChangeText={setRating} keyboardType="numeric" placeholder="Optional" />

            <View style={{ height: 16 }} />

            <AppButton title={submitting ? "Submitting..." : "Submit"} onPress={submit} disabled={!canSubmit || submitting} loading={submitting} />
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>My feedback</Text>
            <TextField value={q} onChangeText={setQ} placeholder="Search my feedback" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredMine.length ? (
                  filteredMine.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.category}
                      subtitle={item.message}
                      meta={`${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`}
                      right={
                        <Badge
                          label={item.status}
                          tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                        />
                      }
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching feedback" : "No feedback yet"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredMine}
                keyExtractor={(f) => f._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching feedback" : "No feedback yet"}</MutedText>
                }
                renderItem={({ item }) => (
                  <ListRow
                    title={item.category}
                    subtitle={item.message}
                    meta={`${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`}
                    right={
                      <Badge
                        label={item.status}
                        tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                      />
                    }
                  />
                )}
              />
            )}
          </Card>

        </View>
      ) : (
        <>
          {isAdmin ? (
            <Card>
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Admin</Text>
              <AppButton title="Manage all feedback" onPress={() => navigation.navigate("AdminFeedback")} />
            </Card>
          ) : null}

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Submit</Text>

            <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Category</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {categories.map((c) => (
                <AppButton key={c} title={c} onPress={() => setCategory(c)} variant={c === category ? "primary" : "secondary"} />
              ))}
            </View>

            <View style={{ height: 12 }} />

            <TextField
              label="Message"
              value={message}
              onChangeText={setMessage}
              placeholder="Tell us what happened or what we should improve"
              multiline
              numberOfLines={4}
            />

            <View style={{ height: 12 }} />

            <TextField label="Rating (1-5)" value={rating} onChangeText={setRating} keyboardType="numeric" placeholder="Optional" />

            <View style={{ height: 16 }} />

            <AppButton title={submitting ? "Submitting..." : "Submit"} onPress={submit} disabled={!canSubmit || submitting} loading={submitting} />
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>My feedback</Text>
            <TextField value={q} onChangeText={setQ} placeholder="Search my feedback" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10 }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredMine.length ? (
                  filteredMine.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.category}
                      subtitle={item.message}
                      meta={`${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`}
                      right={
                        <Badge
                          label={item.status}
                          tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                        />
                      }
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching feedback" : "No feedback yet"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredMine}
                keyExtractor={(f) => f._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  loading ? <MutedText>Loading...</MutedText> : <MutedText>{q.trim() ? "No matching feedback" : "No feedback yet"}</MutedText>
                }
                renderItem={({ item }) => (
                  <ListRow
                    title={item.category}
                    subtitle={item.message}
                    meta={`${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}${typeof item.rating === "number" ? ` • rating ${item.rating}` : ""}`}
                    right={
                      <Badge
                        label={item.status}
                        tone={item.status === "resolved" ? "success" : item.status === "reviewed" ? "primary" : "warning"}
                      />
                    }
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
