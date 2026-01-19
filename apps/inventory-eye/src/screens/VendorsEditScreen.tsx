import React, { useCallback, useContext, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Card, ErrorText, MutedText, Screen, TextField } from "../ui";

type Vendor = {
  _id: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Props = NativeStackScreenProps<MoreStackParamList, "VendorsEdit">;

export function VendorsEditScreen({ navigation, route }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Vendors");
  }, [navigation]);

  const canCreateOrEdit = effectiveRole === "manager" || effectiveRole === "admin";
  const canDelete = effectiveRole === "admin";

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selected = useMemo(() => vendors.find((v) => v._id === route.params.id) ?? null, [route.params.id, vendors]);

  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<{ ok: true; vendors: Vendor[] }>("/vendors", { method: "GET", token });
    setVendors(res.vendors);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      if (!selected) return;
      setEditName(selected.name ?? "");
      setEditEmail(selected.contactEmail ?? "");
      setEditPhone(selected.contactPhone ?? "");
      setEditAddress(selected.address ?? "");
      setEditNotes(selected.notes ?? "");
    }, [selected])
  );

  async function save() {
    if (!token || !canCreateOrEdit || !selected || saving) return;

    if (!editName.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; vendor: Vendor }>(`/vendors/${selected._id}`,
        {
          method: "PATCH",
          token,
          body: JSON.stringify({
            name: editName.trim(),
            contactEmail: editEmail.trim() ? editEmail.trim() : undefined,
            contactPhone: editPhone.trim() ? editPhone.trim() : undefined,
            address: editAddress.trim() ? editAddress.trim() : undefined,
            notes: editNotes.trim() ? editNotes.trim() : undefined,
          }),
        }
      );
      setVendors((prev) => prev.map((v) => (v._id === selected._id ? res.vendor : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVendor() {
    if (!token || !canDelete || !selected || deleting) return;

    setDeleting(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/vendors/${selected._id}`, { method: "DELETE", token });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen title="Edit vendor" scroll right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {!selected ? (
        <Card>
          <MutedText>{loading ? "Loading vendor..." : "Vendor not found"}</MutedText>
        </Card>
      ) : !canCreateOrEdit ? (
        <Card>
          <MutedText>Editing vendors requires manager/admin.</MutedText>
        </Card>
      ) : (
        <Card>
          <MutedText>ID: {route.params.id}</MutedText>
          <View style={{ height: 12 }} />
          <TextField label="Name" value={editName} onChangeText={setEditName} />
          <View style={{ height: 12 }} />
          <TextField label="Contact email" value={editEmail} onChangeText={setEditEmail} autoCapitalize="none" />
          <View style={{ height: 12 }} />
          <TextField label="Contact phone" value={editPhone} onChangeText={setEditPhone} autoCapitalize="none" />
          <View style={{ height: 12 }} />
          <TextField label="Address" value={editAddress} onChangeText={setEditAddress} />
          <View style={{ height: 12 }} />
          <TextField label="Notes" value={editNotes} onChangeText={setEditNotes} multiline numberOfLines={3} />

          <View style={{ height: 16 }} />
          <AppButton title={saving ? "Saving..." : "Save"} onPress={save} disabled={saving} loading={saving} />

          <View style={{ height: 10 }} />
          <AppButton title={deleting ? "Deleting..." : "Delete"} onPress={deleteVendor} variant="danger" disabled={!canDelete || deleting} loading={deleting} />
        </Card>
      )}
    </Screen>
  );
}
