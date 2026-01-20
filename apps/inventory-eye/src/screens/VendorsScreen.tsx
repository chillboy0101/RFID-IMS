import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { FlatList, Platform, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AUTO_REFRESH_PAUSE_MS, GLOBAL_AUTO_REFRESH_MS, AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

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

type Props = NativeStackScreenProps<MoreStackParamList, "Vendors">;

export function VendorsScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);

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

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const loadInFlightRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const canCreateOrEdit = effectiveRole === "manager" || effectiveRole === "admin";

  const [q, setQ] = useState("");
  const lastTypingAtRef = useRef(0);
  const filteredVendors = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) => {
      const blob = `${v._id} ${v.name} ${v.contactEmail ?? ""} ${v.contactPhone ?? ""}`.toLowerCase();
      return blob.includes(t);
    });
  }, [q, vendors]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<{ ok: true; vendors: Vendor[] }>("/vendors", { method: "GET", token });
    setVendors(res.vendors);
  }, [token]);

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
        if (Date.now() - lastTypingAtRef.current < AUTO_REFRESH_PAUSE_MS) return;
        loadSafe(true).catch(() => undefined);
      }, GLOBAL_AUTO_REFRESH_MS);

      return () => clearInterval(id);
    }, [loadSafe])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadSafe(false);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      title="Vendors"
      scroll
      busy={refreshing || updating}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      right={
        isDesktopWeb ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {canCreateOrEdit ? (
              <AppButton title="New" onPress={() => navigation.navigate("VendorsCreate")} variant="secondary" iconName="add" iconOnly />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />
            {canCreateOrEdit ? (
              <AppButton title="New" onPress={() => navigation.navigate("VendorsCreate")} variant="secondary" iconName="add" iconOnly />
            ) : null}
          </View>
        )
      }
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {isDesktopWeb ? (
        <View style={{ gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  value={q}
                  onChangeText={(t) => {
                    lastTypingAtRef.current = Date.now();
                    setQ(t);
                  }}
                  placeholder="Search: name, email, phone"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
                <Badge label={`Total: ${filteredVendors.length}`} size="header" />
              </View>
            </View>
            <MutedText style={{ marginTop: 8 }}>Tip: click a row to open the vendor edit page.</MutedText>
            {!canCreateOrEdit ? (
              <View style={{ marginTop: 12 }}>
                <MutedText>Creating/editing vendors requires manager/admin.</MutedText>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>List</Text>
            {isWeb ? (
              <View style={{ gap: 10, minHeight: 160, justifyContent: loading ? "center" : "flex-start" }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredVendors.length ? (
                  filteredVendors.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.name}
                      subtitle={`${item.contactEmail ?? "-"}\n${item.contactPhone ?? "-"}`}
                      onPress={() => navigation.navigate("VendorsEdit", { id: item._id })}
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching vendors" : "No vendors"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredVendors}
                keyExtractor={(v) => v._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={<MutedText>{q.trim() ? "No matching vendors" : "No vendors"}</MutedText>}
                renderItem={({ item }) => (
                  <ListRow
                    title={item.name}
                    subtitle={`${item.contactEmail ?? "-"}\n${item.contactPhone ?? "-"}`}
                    onPress={() => navigation.navigate("VendorsEdit", { id: item._id })}
                  />
                )}
              />
            )}
          </Card>
        </View>
      ) : (
        <>
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>List</Text>
            <TextField
              value={q}
              onChangeText={setQ}
              placeholder="Name, email, phone"
              autoCapitalize="none"
            />
            <View style={{ height: 12 }} />
            {isWeb ? (
              <View style={{ gap: 10, minHeight: 160, justifyContent: loading ? "center" : "flex-start" }}>
                {loading ? (
                  <MutedText>Loading...</MutedText>
                ) : filteredVendors.length ? (
                  filteredVendors.map((item) => (
                    <ListRow
                      key={item._id}
                      title={item.name}
                      subtitle={`${item.contactEmail ?? "-"}\n${item.contactPhone ?? "-"}`}
                      onPress={() => navigation.navigate("VendorsEdit", { id: item._id })}
                    />
                  ))
                ) : (
                  <MutedText>{q.trim() ? "No matching vendors" : "No vendors"}</MutedText>
                )}
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filteredVendors}
                keyExtractor={(v) => v._id}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={<MutedText>{q.trim() ? "No matching vendors" : "No vendors"}</MutedText>}
                renderItem={({ item }) => (
                  <ListRow
                    title={item.name}
                    subtitle={`${item.contactEmail ?? "-"}\n${item.contactPhone ?? "-"}`}
                    onPress={() => navigation.navigate("VendorsEdit", { id: item._id })}
                  />
                )}
              />
            )}
          </Card>
          {!canCreateOrEdit ? (
            <Card>
              <MutedText>Creating/editing vendors requires manager/admin.</MutedText>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
