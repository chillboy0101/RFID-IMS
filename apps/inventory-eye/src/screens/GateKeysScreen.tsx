import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, LivePulse, MutedText, Screen, TextField, theme } from "../ui";

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
  key: string;
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

type StationConfigResponse = {
  ok: true;
  stations: {
    gateLocations: string[];
    defaults: {
      gateLocation: string;
    };
  };
};

type Props = NativeStackScreenProps<MoreStackParamList, "GateKeys">;

type KeyFilter = "active" | "expired" | "revoked" | "all";
type KeyStatus = "active" | "expired" | "revoked";
type ExpiryPreset = "never" | "day" | "week" | "month";

const expiryPresets: Array<{ key: ExpiryPreset; label: string; minutes?: number }> = [
  { key: "never", label: "Never" },
  { key: "day", label: "24h", minutes: 1440 },
  { key: "week", label: "7d", minutes: 10080 },
  { key: "month", label: "30d", minutes: 43200 },
];

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocation(value?: string) {
  if (!value) return "Any gate";
  const normalized = value.replace(/_/g, " ").trim();
  if (!normalized) return "Any gate";
  if (/[a-z]/.test(normalized)) return normalized;
  return normalized.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function isExpiredKey(key: GateKey, nowMs: number) {
  if (!key.expiresAt) return false;
  return new Date(key.expiresAt).getTime() <= nowMs;
}

function statusForKey(key: GateKey, nowMs: number): KeyStatus {
  if (key.revokedAt) return "revoked";
  if (isExpiredKey(key, nowMs)) return "expired";
  return "active";
}

function toneForStatus(status: KeyStatus): "success" | "warning" | "danger" {
  if (status === "revoked") return "danger";
  if (status === "expired") return "warning";
  return "success";
}

function labelForStatus(status: KeyStatus) {
  if (status === "revoked") return "Revoked";
  if (status === "expired") return "Expired";
  return "Active";
}

function formatValidUntil(key: GateKey, nowMs: number) {
  if (!key.expiresAt) return "No expiry";
  const formatted = formatDate(key.expiresAt);
  return isExpiredKey(key, nowMs) ? `Expired ${formatted}` : formatted;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={(state) => [
        {
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 9,
          minHeight: 40,
          justifyContent: "center",
          alignItems: "center",
          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
        },
        (state as any).hovered && !state.pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
        state.pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
      ]}
    >
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function GateSuggestion({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          paddingHorizontal: 12,
          paddingVertical: 7,
          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
        },
        pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
      ]}
    >
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function KeyListDesktop({
  keys,
  refreshing,
  onRevoke,
  nowMs,
}: {
  keys: GateKey[];
  refreshing: boolean;
  onRevoke: (id: string, name: string) => void;
  nowMs: number;
}) {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 10 }}>
        <View style={{ flex: 1.7, minWidth: 190 }}>
          <MutedText>Key</MutedText>
        </View>
        <View style={{ flex: 0.9, minWidth: 120 }}>
          <MutedText>Gate</MutedText>
        </View>
        <View style={{ flex: 1, minWidth: 130 }}>
          <MutedText>Activity</MutedText>
        </View>
        <View style={{ flex: 1, minWidth: 130 }}>
          <MutedText>Created</MutedText>
        </View>
        <View style={{ flex: 1.05, minWidth: 150 }}>
          <MutedText>Valid until</MutedText>
        </View>
        <View style={{ width: 112, alignItems: "center" }}>
          <MutedText>Status</MutedText>
        </View>
      </View>

      {keys.map((key, index) => (
        <View
          key={key._id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingVertical: 14,
            minHeight: 72,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {(() => {
            const status = statusForKey(key, nowMs);
            return (
              <>
          <View style={{ flex: 1.7, minWidth: 190 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
              {key.name}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
              {key.keyPrefix}......
            </Text>
          </View>

          <View style={{ flex: 0.9, minWidth: 120 }}>
            <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
              {formatLocation(key.locationHint)}
            </Text>
          </View>

          <View style={{ flex: 1, minWidth: 130 }}>
            <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
              {key.lastSeenAt ? formatDate(key.lastSeenAt) : "Not used yet"}
            </Text>
            {key.lastSeenSource ? <MutedText>{key.lastSeenSource}</MutedText> : null}
          </View>

          <View style={{ flex: 1, minWidth: 130 }}>
            <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
              {formatDate(key.createdAt)}
            </Text>
          </View>

          <View style={{ flex: 1.05, minWidth: 150 }}>
            <Text
              style={[
                theme.typography.body,
                { color: status === "expired" ? theme.colors.warning : theme.colors.text },
              ]}
              numberOfLines={1}
            >
              {formatValidUntil(key, nowMs)}
            </Text>
          </View>

          <View style={{ width: 112, alignItems: "stretch", justifyContent: "center", gap: 8 }}>
            <View style={{ alignItems: "center" }}>
              <Badge label={labelForStatus(status)} tone={toneForStatus(status)} />
            </View>
            {!key.revokedAt ? (
              <Pressable
                onPress={() => onRevoke(key._id, key.name)}
                disabled={refreshing}
                style={({ pressed }) => [
                  {
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    minWidth: 76,
                    alignItems: "center",
                    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                    opacity: refreshing ? 0.6 : 1,
                  },
                  pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
                ]}
              >
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>Revoke</Text>
              </Pressable>
            ) : null}
          </View>
              </>
            );
          })()}
        </View>
      ))}
    </Card>
  );
}

function KeyListMobile({
  keys,
  refreshing,
  onRevoke,
  nowMs,
}: {
  keys: GateKey[];
  refreshing: boolean;
  onRevoke: (id: string, name: string) => void;
  nowMs: number;
}) {
  return (
    <View style={{ gap: 12 }}>
      {keys.map((key) => {
        const status = statusForKey(key, nowMs);
        return (
          <Card key={key._id}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                  {key.name}
                </Text>
                <MutedText style={{ marginTop: 4 }}>{formatLocation(key.locationHint)}</MutedText>
              </View>
              <Badge label={labelForStatus(status)} tone={toneForStatus(status)} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <Badge label={`${key.keyPrefix}......`} />
              <Badge label={key.lastSeenAt ? "Seen" : "Unused"} tone={key.lastSeenAt ? "success" : "default"} />
              <Badge label={key.expiresAt ? (status === "expired" ? "Expired" : "Expires") : "No expiry"} tone={key.expiresAt ? "warning" : "default"} />
            </View>

            <View style={{ marginTop: 12, gap: 4 }}>
              <MutedText>Created {formatDate(key.createdAt)}</MutedText>
              <MutedText>{key.lastSeenAt ? `Last seen ${formatDate(key.lastSeenAt)}` : "No hardware activity yet"}</MutedText>
              {key.lastSeenSource ? <MutedText>Source: {key.lastSeenSource}</MutedText> : null}
              <MutedText>{formatValidUntil(key, nowMs)}</MutedText>
            </View>

            {!key.revokedAt ? (
              <View style={{ marginTop: 14 }}>
                <AppButton title="Revoke key" onPress={() => onRevoke(key._id, key.name)} variant="secondary" disabled={refreshing} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

export function GateKeysScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const useTableLayout = Platform.OS === "web" && width >= 1180;

  const [keys, setKeys] = useState<GateKey[]>([]);
  const [gateLocations, setGateLocations] = useState<string[]>([]);
  const [defaultGateLocation, setDefaultGateLocation] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<KeyFilter>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("never");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<{ name: string; rawKey: string; locationHint?: string } | null>(null);
  const nowMs = Date.now();

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

  const loadPageData = useCallback(async (background = false) => {
    if (!token) return;
    if (!background) setLoading(true);
    setError(null);

    try {
      const [keysRes, stationsRes] = await Promise.all([
        apiRequest<{ ok: true; keys: GateKey[] }>("/rfid/gate-keys", { method: "GET", token }),
        apiRequest<StationConfigResponse>("/rfid/stations", { method: "GET", token }),
      ]);

      setKeys(keysRes.keys ?? []);
      const nextGateLocations = stationsRes.stations?.gateLocations ?? [];
      const nextDefaultGate = stationsRes.stations?.defaults?.gateLocation ?? "";

      setGateLocations(nextGateLocations);
      setDefaultGateLocation(nextDefaultGate);
      setLocationHint((current) => current || nextDefaultGate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gate keys");
    } finally {
      if (!background) setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadPageData();
    }, [loadPageData])
  );

  useEffect(() => {
    if (showCreate || createdKey) return;
    setCreateError(null);
  }, [createdKey, showCreate]);

  const counts = useMemo(() => {
    const active = keys.filter((key) => statusForKey(key, nowMs) === "active").length;
    const expired = keys.filter((key) => statusForKey(key, nowMs) === "expired").length;
    const revoked = keys.filter((key) => statusForKey(key, nowMs) === "revoked").length;
    return {
      total: keys.length,
      active,
      expired,
      revoked,
    };
  }, [keys, nowMs]);

  const suggestedGateLocations = useMemo(
    () => uniqueStrings([...gateLocations, ...keys.map((key) => key.locationHint), defaultGateLocation]),
    [defaultGateLocation, gateLocations, keys]
  );

  const filteredKeys = useMemo(() => {
    if (filter === "all") return keys;
    return keys.filter((key) => statusForKey(key, nowMs) === filter);
  }, [filter, keys, nowMs]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPageData(true);
    setRefreshing(false);
  }, [loadPageData]);

  const handleRevoke = useCallback(
    (id: string, keyName: string) => {
      Alert.alert(
        "Revoke gate key",
        `Revoke "${keyName}"? Any reader using it will lose access immediately.`,
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
                await loadPageData(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to revoke key");
              } finally {
                setRefreshing(false);
              }
            },
          },
        ]
      );
    },
    [loadPageData, token]
  );

  const handleCopy = useCallback(() => {
    if (!createdKey) return;
    if (Platform.OS === "web" && typeof window !== "undefined" && window.navigator?.clipboard) {
      window.navigator.clipboard.writeText(createdKey.rawKey).catch(() => undefined);
    }
    Alert.alert("Gate key", createdKey.rawKey);
  }, [createdKey]);

  const handleCreate = useCallback(async () => {
    if (!token) return;
    if (!name.trim()) {
      setCreateError("Key name is required");
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      const selectedPreset = expiryPresets.find((preset) => preset.key === expiryPreset);
      const body: Record<string, unknown> = { name: name.trim() };
      if (locationHint.trim()) body.locationHint = locationHint.trim();
      if (selectedPreset?.minutes) body.minutes = selectedPreset.minutes;

      const res = await apiRequest<CreateKeyResponse>("/rfid/gate-keys", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });

      setCreatedKey({
        name: res.keyDoc.name,
        rawKey: res.key,
        locationHint: res.keyDoc.locationHint,
      });
      setName("");
      setExpiryPreset("never");
      setShowCreate(false);
      await loadPageData(true);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setCreateLoading(false);
    }
  }, [expiryPreset, loadPageData, locationHint, name, token]);

  const createPanel = showCreate ? (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <Text style={[theme.typography.h2, { color: theme.colors.text }]}>New key</Text>
        <Pressable
          onPress={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
          style={({ pressed }) => [
            {
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
            },
            pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
          ]}
        >
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Close</Text>
        </Pressable>
      </View>

      <View style={{ gap: 14 }}>
        {createError ? <ErrorText>{createError}</ErrorText> : null}

        <TextField
          label="Key name"
          value={name}
          onChangeText={setName}
          placeholder="Main exit reader"
          autoCapitalize="words"
        />

        <View style={{ gap: 8 }}>
          <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Gate</Text>
          {suggestedGateLocations.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {suggestedGateLocations.map((gate) => (
                <GateSuggestion
                  key={gate}
                  label={formatLocation(gate)}
                  active={locationHint.trim() === gate}
                  onPress={() => setLocationHint(gate)}
                />
              ))}
            </View>
          ) : null}
          <TextField
            value={locationHint}
            onChangeText={setLocationHint}
            placeholder="EXIT_MAIN"
            autoCapitalize="characters"
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Expiry</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {expiryPresets.map((preset) => (
              <GateSuggestion
                key={preset.key}
                label={preset.label}
                active={expiryPreset === preset.key}
                onPress={() => setExpiryPreset(preset.key)}
              />
            ))}
          </View>
        </View>

        <MutedText>Saved gates appear in RFID Hub station options, and the key becomes valid for hardware immediately.</MutedText>

        <AppButton title="Save key" onPress={handleCreate} loading={createLoading} disabled={createLoading} />
      </View>
    </Card>
  ) : null;

  const createdPanel = createdKey ? (
    <Card style={createdKey ? { borderWidth: 1.5, borderColor: theme.colors.success } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <LivePulse />
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Key created</Text>
          <MutedText>{createdKey.name}</MutedText>
        </View>
      </View>

      {createdKey.locationHint ? <Badge label={formatLocation(createdKey.locationHint)} tone="success" /> : null}

      <View
        style={{
          marginTop: 12,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          padding: 12,
        }}
      >
        <Text selectable style={{ color: theme.colors.text, fontFamily: "monospace" as any }}>
          {createdKey.rawKey}
        </Text>
      </View>

      <MutedText style={{ marginTop: 10 }}>Copy this now. The raw key is only shown once.</MutedText>

      <View style={{ flexDirection: isDesktopWeb ? "row" : "column", gap: 10, marginTop: 14 }}>
        <AppButton title="Copy key" onPress={handleCopy} variant="secondary" style={isDesktopWeb ? { flex: 1 } : undefined} />
        <AppButton title="Done" onPress={() => setCreatedKey(null)} style={isDesktopWeb ? { flex: 1 } : undefined} />
      </View>
    </Card>
  ) : null;

  if (effectiveRole !== "admin") {
    return (
      <Screen
        title="Gate Keys"
        center
        right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      >
        <Badge label="Admin access required" tone="danger" />
        <MutedText style={{ marginTop: 10 }}>Only administrators can manage gate API keys.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen
      title="Gate Keys"
      scroll
      busy={loading}
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      <View style={{ gap: theme.spacing.md }}>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <View
          style={{
            flexDirection: isDesktopWeb ? "row" : "column",
            alignItems: isDesktopWeb ? "center" : "stretch",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <FilterChip label={`Active ${counts.active}`} active={filter === "active"} onPress={() => setFilter("active")} />
            <FilterChip label={`Expired ${counts.expired}`} active={filter === "expired"} onPress={() => setFilter("expired")} />
            <FilterChip label={`Revoked ${counts.revoked}`} active={filter === "revoked"} onPress={() => setFilter("revoked")} />
            <FilterChip label={`All ${counts.total}`} active={filter === "all"} onPress={() => setFilter("all")} />
          </View>

          {!showCreate ? (
            <AppButton
              title="Create key"
              onPress={() => setShowCreate(true)}
              iconName="add"
              style={isDesktopWeb ? undefined : { width: "100%" }}
            />
          ) : null}
        </View>

        {createdPanel}
        {createPanel}

        {filteredKeys.length ? (
          useTableLayout ? (
            <KeyListDesktop keys={filteredKeys} refreshing={refreshing} onRevoke={handleRevoke} nowMs={nowMs} />
          ) : (
            <KeyListMobile keys={filteredKeys} refreshing={refreshing} onRevoke={handleRevoke} nowMs={nowMs} />
          )
        ) : (
          <Card>
            <MutedText>
              {filter === "active"
                ? "No active keys."
                : filter === "expired"
                  ? "No expired keys."
                  : filter === "revoked"
                    ? "No revoked keys."
                    : "No gate keys yet."}
            </MutedText>
          </Card>
        )}
      </View>
    </Screen>
  );
}
