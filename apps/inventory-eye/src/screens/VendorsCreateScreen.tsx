import React, { useCallback, useContext, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "VendorsCreate">;

export function VendorsCreateScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const canCreateOrEdit = effectiveRole === "manager" || effectiveRole === "admin";

  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Vendors");
  }, [navigation]);

  async function createVendor() {
    if (!token || !canCreateOrEdit || submitting) return;

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/vendors", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: name.trim(),
          contactEmail: contactEmail.trim() ? contactEmail.trim() : undefined,
          contactPhone: contactPhone.trim() ? contactPhone.trim() : undefined,
          address: address.trim() ? address.trim() : undefined,
          notes: notes.trim() ? notes.trim() : undefined,
        }),
      });

      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create vendor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title="New vendor"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {!canCreateOrEdit ? (
        <Card>
          <MutedText>Creating vendors requires manager/admin.</MutedText>
        </Card>
      ) : (
        <Card>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Vendor name" />
          <View style={{ height: 12 }} />
          <TextField
            label="Contact email"
            value={contactEmail}
            onChangeText={setContactEmail}
            placeholder="Optional"
            autoCapitalize="none"
          />
          <View style={{ height: 12 }} />
          <TextField
            label="Contact phone"
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder="Optional"
            autoCapitalize="none"
          />
          <View style={{ height: 12 }} />
          <TextField label="Address" value={address} onChangeText={setAddress} placeholder="Optional" />
          <View style={{ height: 12 }} />
          <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline numberOfLines={3} />

          <View style={{ height: 16 }} />
          <AppButton title="Create" onPress={createVendor} disabled={submitting} loading={submitting} />
        </Card>
      )}
    </Screen>
  );
}
