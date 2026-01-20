import React, { useCallback, useContext, useState } from "react";
import { Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  quantity: number;
};

type Props = NativeStackScreenProps<InventoryStackParamList, "InventoryAdjust">;

export function InventoryAdjustScreen({ navigation, route }: Props) {
  const { token } = useContext(AuthContext);
  const { id } = route.params;

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("InventoryDetail", { id });
  }, [id, navigation]);

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${id}`, { method: "GET", token });
    setItem(res.item);
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  async function onSubmit() {
    if (!token || loading) return;
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) {
      setError("Delta must be a non-zero number");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiRequest<{ ok: true; item: InventoryItem }>(`/inventory/items/${id}/adjust`, {
        method: "POST",
        token,
        body: JSON.stringify({ delta: d, reason: reason.trim() ? reason.trim() : undefined }),
      });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen
      title="Adjust"
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
      scroll
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={2}>
              {item?.name ?? "-"}
            </Text>
            <MutedText style={{ marginTop: 6 }}>SKU: {item?.sku ?? "-"}</MutedText>
          </View>
          <Badge
            label={`Qty: ${item?.quantity ?? "-"}`}
            tone={typeof item?.quantity === "number" && item.quantity === 0 ? "warning" : "default"}
          />
        </View>
      </Card>

      <Card>
        <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Adjustment</Text>
        <TextField
          label="Delta"
          value={delta}
          onChangeText={setDelta}
          placeholder="e.g. 5 or -2"
          keyboardType="numeric"
          autoCapitalize="none"
        />
        <View style={{ height: 12 }} />
        <TextField label="Reason" value={reason} onChangeText={setReason} placeholder="Optional" />
        <MutedText style={{ marginTop: 8 }}>Delta must be non-zero.</MutedText>
        <View style={{ height: 16 }} />
        <AppButton title="Submit" onPress={onSubmit} loading={loading} />
      </Card>
    </Screen>
  );
}
