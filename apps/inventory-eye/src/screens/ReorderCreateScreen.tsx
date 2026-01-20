import React, { useCallback, useContext, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "ReordersCreate">;

type ReorderStatus = "requested" | "ordered" | "received" | "cancelled";

type Reorder = {
  _id: string;
  itemId: string;
  vendorId?: string;
  requestedQuantity: number;
  status: ReorderStatus;
  note?: string;
  createdAt?: string;
};

export function ReorderCreateScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const canManage = effectiveRole === "manager" || effectiveRole === "admin";

  const [itemId, setItemId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("10");
  const [note, setNote] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Reorders");
  }, [navigation]);

  const qty = Number(requestedQuantity);

  const create = useCallback(async () => {
    if (!token || !canManage || submitting) return;

    if (!itemId.trim()) {
      setError("itemId is required");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("requestedQuantity must be > 0");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest<{ ok: true; reorder: Reorder }>("/reorders", {
        method: "POST",
        token,
        body: JSON.stringify({
          itemId: itemId.trim(),
          vendorId: vendorId.trim() ? vendorId.trim() : undefined,
          requestedQuantity: qty,
          note: note.trim() ? note.trim() : undefined,
        }),
      });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create reorder");
    } finally {
      setSubmitting(false);
    }
  }, [canManage, itemId, note, navigation, qty, submitting, token, vendorId]);

  return (
    <Screen title="New reorder" scroll right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {!canManage ? (
        <Card>
          <MutedText>Reorder management requires manager/admin.</MutedText>
        </Card>
      ) : (
        <>
          <Card>
            <TextField label="Item ID" value={itemId} onChangeText={setItemId} placeholder="Inventory item ObjectId" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            <TextField label="Vendor ID" value={vendorId} onChangeText={setVendorId} placeholder="Optional Vendor ObjectId" autoCapitalize="none" />
            <View style={{ height: 12 }} />
            <TextField label="Requested quantity" value={requestedQuantity} onChangeText={setRequestedQuantity} keyboardType="numeric" />
            <View style={{ height: 12 }} />
            <TextField label="Note" value={note} onChangeText={setNote} placeholder="Optional" />

            <View style={{ height: 16 }} />
            <AppButton title="Create reorder" onPress={create} disabled={submitting} loading={submitting} />
          </Card>
        </>
      )}
    </Screen>
  );
}
