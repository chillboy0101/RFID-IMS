import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

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

function feedbackStatusTone(status: FeedbackStatus): "default" | "success" | "warning" {
  return status === "resolved" ? "success" : status === "reviewed" ? "warning" : "default";
}

function feedbackCategoryLabel(category: FeedbackCategory) {
  return category.replace("_", " ");
}

function FeedbackEntry({
  item,
  compact,
  onSetStatus,
}: {
  item: FeedbackItem;
  compact: boolean;
  onSetStatus: (id: string, status: FeedbackStatus) => void;
}) {
  const meta =
    `${item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}` +
    `${typeof item.rating === "number" ? ` - rating ${item.rating}` : ""}`;

  return (
    <Card style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: compact ? "column" : "row",
          alignItems: compact ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{feedbackCategoryLabel(item.category)}</Text>
          <MutedText style={{ marginTop: 4 }}>{meta}</MutedText>
        </View>
        <Badge label={item.status} tone={feedbackStatusTone(item.status)} />
      </View>

      <Text selectable style={[theme.typography.body, { color: theme.colors.text, lineHeight: 22 }]}>
        {item.message}
      </Text>

      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <Text style={{ color: theme.colors.textMuted }}>Set status</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {statuses.map((s) => (
          <AppButton key={s} title={s} onPress={() => onSetStatus(item._id, s)} variant={s === item.status ? "primary" : "secondary"} />
        ))}
      </View>
    </Card>
  );
}

export function AdminFeedbackScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const isAdmin = effectiveRole === "admin";

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const [q, setQ] = useState("");
  const [all, setAll] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

  const load = useCallback(async () => {
    if (!token || !isAdmin) return;
    setError(null);

    const allRes = await apiRequest<{ ok: true; feedback: FeedbackItem[] }>("/feedback/all", { method: "GET", token });
    setAll(allRes.feedback);
  }, [isAdmin, token]);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }

      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [isAdmin, load])
  );

  const filteredAll = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((f) => {
      const blob = `${f._id} ${f.category} ${f.status} ${f.message}`.toLowerCase();
      return blob.includes(t) || f._id.slice(-6).toLowerCase().includes(t);
    });
  }, [all, q]);

  async function setStatus(id: string, status: FeedbackStatus) {
    if (!token) return;

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

  if (!isAdmin) {
    return (
      <Screen
        title="Admin feedback"
        center
        right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      >
        <Badge label="Admin access required" tone="danger" />
        <MutedText style={{ marginTop: 10 }}>Only administrators can manage feedback for the branch.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen
      title="Admin feedback"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
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

          <View style={{ gap: 10 }}>
            {loading ? (
              <MutedText>Loading...</MutedText>
            ) : filteredAll.length ? (
              filteredAll.map((item) => (
                <FeedbackEntry key={item._id} item={item} compact={!isDesktopWeb} onSetStatus={setStatus} />
              ))
            ) : (
              <MutedText>{q.trim() ? "No matching feedback" : "No feedback"}</MutedText>
            )}
          </View>
        </Card>
      </View>
    </Screen>
  );
}
