import React, { useCallback, useContext, useRef, useState } from "react";
import { Alert, Clipboard, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, TextField, theme } from "../ui";

type GateKey = {
  _id: string;
  name: string;
  keyPrefix: string;
  locationHint?: string;
  lastSeenAt?: string;
  lastSeenSource?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
};

type CreateKeyResponse = {
  ok: true;
  key: string; // raw key — only returned once at creation
  keyPrefix: string;
  keyDoc: {
    _id: string;
    name: string;
    keyPrefix: string;
    locationHint?: string;
    expiresAt?: string;
    createdAt: string;
  };
};

type Props = NativeStackScreenProps<MoreStackParamList, "GateKeys">;

function formatDate(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function KeyCard({ k, onRevoke, refreshing }: { k: GateKey; onRevoke: (id: string, name: string) => void; refreshing: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isRevoked = !!k.revokedAt;

  return (
    <Pressable onPress={() => setExpanded(e => !e)}>
      <Card style={{ marginBottom: 10, opacity: isRevoked ? 0.55 : 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{k.name}</Text>
              {isRevoked ? <Badge label="Revoked" tone="danger" /> : <Badge label="Active" tone="success" />}
            </View>
            <MutedText style={{ marginTop: 4 }}>
              Key prefix: {k.keyPrefix}••••••  |  Loc: {k.locationHint ?? "Any"}
            </MutedText>
            <MutedText style={{ marginTop: 2 }}>
              Created {formatDate(k.createdAt)}  |  Expires {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
            </MutedText>
            {k.lastSeenAt ? (
              <MutedText style={{ marginTop: 2 }}>
                Last used: {formatDate(k.lastSeenAt)} via {k.lastSeenSource ?? "unknown"}
              </MutedText>
            ) : null}
          </View>
          <Text style={{ color: theme.colors.textMuted, fontSize: 20 }}>{expanded ? "▲" : "▼"}</Text>
        </View>

        {expanded && !isRevoked ? (
          <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12, gap: 10 }}>
            <MutedText>The full raw key is only shown once at creation. Share it securely with your gate hardware operator.</MutedText>
            <AppButton
              title="Revoke this key"
              onPress={() => onRevoke(k._id, k.name)}
              variant="danger"
              disabled={refreshing}
            />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

export function GateKeysScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;

  const [keys, setKeys] = useState<GateKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newMinutes, setNewMinutes] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newlyCreated, setNewlyCreated] = useState<{ name: string; rawKey: string } | null>(null);

  const loadKeys = useCallback(async (isBackground = false) => {
    if (!token) return;
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true; keys: GateKey[] }>("/rfid/gate-keys", { method: "GET", token });
      setKeys(res.keys ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void loadKeys();
  }, [loadKeys]));

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadKeys();
    setRefreshing(false);
  };

  const handleRevoke = (id: string, name: string) => {
    Alert.alert(
      "Revoke Gate Key",
      `Are you sure you want to revoke "${name}"? Any hardware using this key will immediately lose access.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            setRefreshing(true);
            try {
              await apiRequest(`/rfid/gate-keys/${id}`, { method: "DELETE", token });
              await loadKeys(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Revoke failed");
            } finally {
              setRefreshing(false);
            }
          },
        },
      ]
    );
  };

  const handleCreate = async () => {
    if (!newName.trim()) { setCreateError("Name is required"); return; }
    if (!token) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = { name: newName.trim() };
      if (newLocation.trim()) body.locationHint = newLocation.trim();
      if (newMinutes.trim()) body.minutes = Number(newMinutes);
      const res = await apiRequest<CreateKeyResponse>("/rfid/gate-keys", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setNewlyCreated({ name: res.keyDoc.name, rawKey: res.key });
      setNewName("");
      setNewLocation("");
      setNewMinutes("");
      await loadKeys(true);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateLoading(false);
    }
  };

  const copyKey = () => {
    if (!newlyCreated) return;
    if (Platform.OS === "web") {
      window.navigator.clipboard.writeText(newlyCreated.rawKey).catch(() => {});
    }
    Alert.alert("Copy the key now", "The raw key is: " + newlyCreated.rawKey + "\n\nSave it securely — it will not be shown again.");
  };

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

  if (effectiveRole !== "admin") {
    return (
      <Screen title="Gate Keys" center>
        <Badge label="Admin access required" tone="danger" />
        <MutedText style={{ marginTop: 10 }}>Only administrators can manage gate API keys.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen
      title="Gate Keys"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {/* Newly created key banner */}
      {newlyCreated ? (
        <Card style={{ marginBottom: 16, borderWidth: 2, borderColor: theme.colors.success }}>
          <Text style={[theme.typography.h3, { color: theme.colors.success, marginBottom: 8 }]}>Key created: {newlyCreated.name}</Text>
          <MutedText style={{ marginBottom: 8 }}>
            Copy and store this key securely now. It will not be shown again.
          </MutedText>
          <View style={{ backgroundColor: theme.colors.surface2, borderRadius: theme.radius.sm, padding: 10, marginBottom: 10 }}>
            <Text selectable style={{ fontFamily: "monospace" as any, fontSize: 13, color: theme.colors.text }}>
              {newlyCreated.rawKey}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton title="Copy to clipboard" onPress={copyKey} variant="secondary" />
            <AppButton title="Done" onPress={() => setNewlyCreated(null)} />
          </View>
        </Card>
      ) : null}

      {/* Create form */}
      {!showCreate ? (
        <AppButton title="+ Create new gate key" onPress={() => setShowCreate(true)} />
      ) : (
        <Card style={{ marginBottom: 16 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 12 }]}>New gate key</Text>
          {createError ? <ErrorText style={{ marginBottom: 10 }}>{createError}</ErrorText> : null}
          <View style={{ gap: 12 }}>
            <TextField value={newName} onChangeText={setNewName} label="Key name *" placeholder="e.g. Main Entrance Gate" autoCapitalize="none" />
            <TextField value={newLocation} onChangeText={setNewLocation} label="Location hint (optional)" placeholder="e.g. EXIT_MAIN" autoCapitalize="none" />
            <TextField value={newMinutes} onChangeText={setNewMinutes} label="Expires in minutes (optional)" placeholder="e.g. 1440 for 24h, leave blank for no expiry" keyboardType="number-pad" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <AppButton title="Create key" onPress={handleCreate} loading={createLoading} disabled={createLoading} />
              <AppButton title="Cancel" onPress={() => { setShowCreate(false); setCreateError(null); }} variant="secondary" />
            </View>
          </View>
        </Card>
      )}

      {/* Key list */}
      {error ? <ErrorText style={{ marginBottom: 10 }}>{error}</ErrorText> : null}

      {loading ? null : keys.length === 0 ? (
        <MutedText>No gate keys yet. Create one above.</MutedText>
      ) : (
        keys.map(k => (
          <KeyCard key={k._id} k={k} onRevoke={handleRevoke} refreshing={refreshing} />
        ))
      )}
    </Screen>
  );
}
