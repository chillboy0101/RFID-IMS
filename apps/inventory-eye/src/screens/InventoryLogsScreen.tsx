import React, { useCallback, useContext, useState } from "react";
import { FlatList, Platform, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, ErrorText, ListRow, MutedText, Screen } from "../ui";

type InventoryLog = {
  _id: string;
  action?: string;
  delta?: number;
  previousQuantity?: number;
  newQuantity?: number;
  reason?: string;
  createdAt?: string;
};

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryLogs">;

export function InventoryLogsScreen({ navigation, route }: Props) {
  const { token } = useContext(AuthContext);
  const { id } = route.params;
  const isWeb = Platform.OS === "web";

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("InventoryDetail", { id });
  }, [id, navigation]);

  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<{ ok: true; logs: InventoryLog[] }>(`/inventory/items/${id}/logs`, { method: "GET", token });
    setLogs(res.logs);
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  return (
    <Screen
      title="Logs"
      scroll={isWeb}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isWeb ? (
        <View style={{ gap: 12 }}>
          {!loading && !logs.length ? <MutedText>No logs yet</MutedText> : null}
          {loading && !logs.length ? <MutedText>Loading...</MutedText> : null}
          {logs.map((item) => (
            <ListRow
              key={item._id}
              title={item.action ?? "-"}
              subtitle={`Δ: ${typeof item.delta === "number" ? item.delta : "-"} • Prev: ${item.previousQuantity ?? "-"} • New: ${item.newQuantity ?? "-"}\nReason: ${item.reason ?? "-"}`}
              meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
              right={
                <Badge
                  label={typeof item.delta === "number" ? (item.delta >= 0 ? `+${item.delta}` : String(item.delta)) : "-"}
                  tone={typeof item.delta === "number" ? (item.delta === 0 ? "default" : item.delta > 0 ? "success" : "danger") : "default"}
                />
              }
            />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={logs}
          keyExtractor={(l) => l._id}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={!loading ? <MutedText>No logs yet</MutedText> : <MutedText>Loading...</MutedText>}
          renderItem={({ item }) => (
            <ListRow
              title={item.action ?? "-"}
              subtitle={`Δ: ${typeof item.delta === "number" ? item.delta : "-"} • Prev: ${item.previousQuantity ?? "-"} • New: ${item.newQuantity ?? "-"}\nReason: ${item.reason ?? "-"}`}
              meta={item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
              right={
                <Badge
                  label={typeof item.delta === "number" ? (item.delta >= 0 ? `+${item.delta}` : String(item.delta)) : "-"}
                  tone={typeof item.delta === "number" ? (item.delta === 0 ? "default" : item.delta > 0 ? "success" : "danger") : "default"}
                />
              }
            />
          )}
        />
      )}
    </Screen>
  );
}
