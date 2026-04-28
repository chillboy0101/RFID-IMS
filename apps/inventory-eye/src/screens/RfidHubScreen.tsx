import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { API_BASE_URL } from "../config";
import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import {
  AppButton,
  Badge,
  BarcodeScanModal,
  Card,
  ErrorText,
  MutedText,
  Screen,
  theme,
} from "../ui";


// ─── Types ─────────────────────────────────────────────────────────────────────
type Mode = "assign" | "authorize" | "exit" | "tags";

type InventoryItem = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  rfidTagId?: string;
  quantity: number;
  location?: string;
  status?: string;
};

type RfidTag = {
  _id: string;
  tagId: string;
  itemId?: string;
  itemBarcode?: string;
  itemName?: string;
  itemSku?: string;
  status: "active" | "inactive" | "authorized" | "exited";
  location?: string;
  assignedAt?: string;
  deactivatedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
};

type ScanLogEntry = {
  tagId: string;
  itemName?: string;
  authorized: boolean;
  decision: string;
  time: Date;
};

type GateKey = {
  _id: string;
  token: string;
  expiresAt: string;
  location: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────────
let _token = "";
function getToken() { return _token; }
function getApiBase() { return API_BASE_URL; }

function successFeedback() {
  try {
    if (Platform.OS !== "web") { Vibration.vibrate(35); return; }
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 740; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { try { o.stop(); ctx.close?.(); } catch {} }, 80);
  } catch {}
}

function errorFeedback() {
  try {
    if (Platform.OS !== "web") { Vibration.vibrate([0, 50, 30, 50]); return; }
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square"; o.frequency.value = 220; g.gain.value = 0.06;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { try { o.stop(); ctx.close?.(); } catch {} }, 120);
  } catch {}
}

function tripleBeep() {
  try {
    if (Platform.OS !== "web") { Vibration.vibrate([0, 100, 50, 100, 50, 100]); return; }
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 150, 300].forEach((_delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square"; o.frequency.value = 440; g.gain.value = 0.06;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(() => { try { o.stop(); } catch {} }, 60);
    });
    setTimeout(() => { try { ctx.close?.(); } catch {} }, 400);
  } catch {}
}

function formatCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const LOCATION_PRESETS = ["RECEIVING_STAGING", "BIN_A1", "BIN_B2", "BIN_C3", "STAGING", "LOADING_BAY"];

// ─── AutoFocusInput — captures scanner input, auto-submits on Enter (scanner) ───
function AutoFocusInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  autoSubmit = true,
  monospace = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  label?: string;
  autoSubmit?: boolean;
  monospace?: boolean;
}) {
  const lastValueRef = useRef("");
  const scannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (v: string) => {
    // Detect hardware scanner: rapid input (many chars at once) + ends with Enter
    const isScan = v.length > lastValueRef.current.length + 3 && v.endsWith("\n");
    lastValueRef.current = v;

    if (scannerTimerRef.current) clearTimeout(scannerTimerRef.current);
    scannerTimerRef.current = setTimeout(() => { lastValueRef.current = v; }, 50);

    if (isScan && autoSubmit) {
      const cleaned = v.replace(/\n$/, "").trim();
      if (cleaned) { onChange(cleaned); onSubmit(cleaned); lastValueRef.current = ""; return; }
    }
    onChange(v);
  };

  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="done"
        onSubmitEditing={() => { if (autoSubmit && value.trim()) onSubmit(value.trim()); }}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.sm,
          padding: 14,
          minHeight: 52,
          color: theme.colors.text,
          fontSize: monospace ? 16 : 14,
          fontFamily: monospace ? (Platform.OS === "web" ? "monospace" : undefined) : undefined,
          ...(Platform.OS === "web" ? { outlineStyle: "none" } as any : null),
        }}
      />
    </View>
  );
}

// ─── FixedReaderPoller — polls backend for tag detection, auto-calls onTag ─────────
function FixedReaderPoller({
  location,
  onTag,
  active,
}: {
  location: string;
  onTag: (tagId: string) => void;
  active: boolean;
}): React.ReactElement | null {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(0);
  const stoppedRef = useRef(false);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    stoppedRef.current = true;
  }, []);

  const start = useCallback(() => {
    stoppedRef.current = false;
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(
          `${getApiBase()}/rfid/events/latest?location=${encodeURIComponent(location)}`,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        const json = await res.json() as { ok: boolean; event?: { tagId: string } | null };
        if (json.ok && json.event?.tagId) {
          stop();
          successFeedback();
          onTag(json.event.tagId);
          return;
        }
      } catch {}
      // Max 5 min polling
      if (Date.now() - startTimeRef.current > 300000) stop();
    }, 1200);
    timeoutRef.current = setTimeout(() => { stop(); }, 310000);
  }, [location, onTag, stop]);

  useEffect(() => {
    if (active) start();
    else stop();
    return stop;
  }, [active, start, stop]);

  return null;
}

// ─── Mode Tab Row ────────────────────────────────────────────────────────────────
function ModeTabRow({ active, onSelect }: { active: Mode; onSelect: (m: Mode) => void }) {
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 900;

  const NAV_ITEMS = [
    { key: "assign" as Mode, label: "Receive", icon: "download" },
    { key: "authorize" as Mode, label: "Authorize", icon: "shield-checkmark" },
    { key: "exit" as Mode, label: "Exit", icon: "exit" },
    { key: "tags" as Mode, label: "Tags", icon: "pricetag" },
  ];

  const colorFor = (key: Mode) => {
    if (key === "assign") return "#0D9488";
    if (key === "authorize") return "#7C3AED";
    if (key === "exit") return theme.colors.warning;
    return theme.colors.primary;
  };

  if (isWide) {
    return (
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          const color = colorFor(item.key);
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 8,
                paddingVertical: 10, paddingHorizontal: 18,
                borderRadius: theme.radius.sm,
                backgroundColor: isActive ? color + "22" : theme.colors.surface,
                borderWidth: 1,
                borderColor: isActive ? color : theme.colors.border,
              }}
            >
              <Ionicons name={item.icon as any} size={16} color={isActive ? color : theme.colors.textMuted} />
              <Text style={{ color: isActive ? color : theme.colors.textMuted, fontWeight: isActive ? "700" : "500", fontSize: 13 }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        const color = colorFor(item.key);
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={{
              flexDirection: "row", alignItems: "center", gap: 6,
              paddingVertical: 9, paddingHorizontal: 16,
              borderRadius: 999,
              backgroundColor: isActive ? color : theme.colors.surface,
              borderWidth: 1,
              borderColor: isActive ? color : theme.colors.border,
            }}
          >
            <Ionicons name={item.icon as any} size={15} color={isActive ? "#fff" : theme.colors.textMuted} />
            <Text style={{ color: isActive ? "#fff" : theme.colors.textMuted, fontWeight: "600", fontSize: 12 }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── ResultFlash ───────────────────────────────────────────────────────────────
function ResultFlash({ authorized, itemName, visible }: { authorized: boolean; itemName?: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={{
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: authorized ? theme.colors.success + "dd" : theme.colors.danger + "dd",
      alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <Ionicons name={authorized ? "checkmark-circle" : "close-circle"} size={80} color="#fff" />
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 28, marginTop: 16 }}>{authorized ? "AUTHORIZED" : "DENIED"}</Text>
      {itemName && <Text style={{ color: "#fff", fontSize: 16, marginTop: 8, opacity: 0.9 }}>{itemName}</Text>}
    </View>
  );
}

// ─── TagAssignmentMode — scan-driven: scan barcode → auto-lookup → scan tag → auto-assign ──
function TagAssignmentMode({ token }: { token: string }) {
  const [location, setLocation] = useState("RECEIVING_STAGING");
  const [found, setFound] = useState<InventoryItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [assignedCount, setAssignedCount] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  const [flashAuthorized, setFlashAuthorized] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  // state machine: idle → item-ready → assigning → assigned → (auto idle)
  const [phase, setPhase] = useState<"idle" | "item-ready" | "assigned">("idle");

  // Auto-reset after assignment shown
  useEffect(() => {
    if (phase === "assigned") {
      const t = setTimeout(() => {
        setPhase("idle");
        setFound(null);
        setSuccessMsg(null);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // Handle barcode scan: lookup item, auto-advance to item-ready
  const handleBarcodeScan = async (val: string) => {
    if (!val.trim()) return;
    setError(null);
    setFound(null);
    setPhase("idle");
    try {
      const res = await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/lookup?barcode=${encodeURIComponent(val.trim())}`,
        { method: "GET", token }
      );
      setFound(res.item);
      setPhase("item-ready");
      successFeedback();
    } catch {
      setError("Item not found");
      errorFeedback();
      tripleBeep();
    }
  };

  // Handle RFID tag: auto-assign
  const handleTagScan = async (val: string) => {
    if (!found || !val.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/inventory/receiving/units", {
        method: "POST",
        token,
        body: JSON.stringify({ itemId: found._id, tagId: val.trim(), location: location.trim(), quantity: 1 }),
      });
      setSuccessMsg(`${found.name} → ${val.trim()}`);
      setAssignedCount((c) => c + 1);
      setFlashAuthorized(true);
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 1800);
      successFeedback();
      setPhase("assigned");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
      errorFeedback();
      tripleBeep();
    } finally {
      setSubmitting(false);
    }
  };

  // Fixed reader polling starts automatically when item-ready
  const [pollingLocation, setPollingLocation] = useState("RECEIVING");

  useEffect(() => {
    if (phase === "item-ready") {
      setPollingLocation(location);
    }
  }, [phase, location]);

  const handleReaderTag = useCallback((epc: string) => {
    if (phase === "item-ready") void handleTagScan(epc);
  }, [phase]);

  return (
    <View style={{ gap: 14 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: theme.radius.sm, backgroundColor: "#0D948822", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="download" size={18} color="#0D9488" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Receive & Tag</Text>
          <MutedText style={{ fontSize: 11 }}>Scan barcode → scan tag → done</MutedText>
        </View>
        {assignedCount > 0 && <Badge label={`${assignedCount} tagged`} tone="success" />}
      </View>

      {/* Phase 1: Scan barcode */}
      {phase === "idle" && (
        <View style={{ backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md, padding: 24, alignItems: "center", gap: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#0D948822", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="barcode" size={32} color="#0D9488" />
          </View>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>Step 1 — Scan Item Barcode</Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: "center" }}>Point scanner at item barcode</Text>
        </View>
      )}

      {/* Phase 2: Item found, waiting for tag */}
      {phase === "item-ready" && found && (
        <View style={{ backgroundColor: "#0D948822", borderRadius: theme.radius.md, padding: 16, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#0D9488", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </View>
            <Text style={{ color: "#0D9488", fontWeight: "700", fontSize: 13 }}>ITEM FOUND — NOW SCAN TAG</Text>
          </View>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{found.name}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <MutedText>SKU {found.sku}</MutedText>
            <MutedText>Qty {found.quantity}</MutedText>
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#0D9488", borderTopColor: "transparent", opacity: 0.8, transform: [{ rotate: "45deg" }] }} />
            <Text style={{ color: "#0D9488", fontWeight: "600", fontSize: 14, flex: 1 }}>Waiting for RFID scan...</Text>
          </View>
        </View>
      )}

      {/* Phase 3: Success */}
      {phase === "assigned" && (
        <View style={{ backgroundColor: theme.colors.success + "22", borderRadius: theme.radius.md, padding: 24, alignItems: "center", gap: 8 }}>
          <Ionicons name="checkmark-circle" size={48} color={theme.colors.success} />
          <Text style={{ color: theme.colors.success, fontWeight: "800", fontSize: 20 }}>ASSIGNED</Text>
          {successMsg && <Text style={{ color: theme.colors.text, fontSize: 14 }}>{successMsg}</Text>}
          <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Ready for next item...</Text>
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {/* Location */}
      <View style={{ gap: 6 }}>
        <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Location</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {LOCATION_PRESETS.map((p) => (
            <Pressable key={p} onPress={() => setLocation(p)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: location === p ? "#0D9488" : theme.colors.surface, borderWidth: 1, borderColor: location === p ? "#0D9488" : theme.colors.border }}>
              <Text style={{ color: location === p ? "#fff" : theme.colors.textMuted, fontWeight: "600", fontSize: 11 }}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Fixed reader poller — auto-active when item-ready */}
      {phase === "item-ready" && (
        <FixedReaderPoller
          location={pollingLocation}
          onTag={handleReaderTag}
          active={phase === "item-ready"}
        />
      )}

      {/* Manual camera option */}
      {phase === "idle" && (
        <AppButton title="Or scan with camera" onPress={() => setScanOpen(true)} variant="secondary" iconName="camera" />
      )}

      {/* Reset */}
      {(phase === "item-ready" || error) && (
        <AppButton
          title="Reset"
          onPress={() => { setPhase("idle"); setFound(null); setError(null); setSuccessMsg(null); }}
          variant="secondary"
        />
      )}

      <BarcodeScanModal
        visible={scanOpen}
        title="Scan Barcode"
        onClose={() => setScanOpen(false)}
        onScanned={(v) => { setScanOpen(false); void handleBarcodeScan(v); }}
      />

      <ResultFlash authorized={flashAuthorized} itemName={successMsg ?? undefined} visible={showFlash} />
    </View>
  );
}

// ─── AuthorizationMode — scan-driven: scan barcode → auto-toggle-select → done → authorize ──
function AuthorizationMode({ token }: { token: string }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
  };

  // Load all items
  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiRequest<{ ok: boolean; items: InventoryItem[] }>(
          `/inventory/items?limit=200`,
          { method: "GET", token }
        );
        setItems(res.items ?? []);
      } catch {}
    };
    void load();
  }, [token]);

  // Handle barcode scan: find item → toggle select
  const handleBarcodeScan = (val: string) => {
    setLastScanned(val.trim());
    const item = items.find((i) => i.barcode === val.trim() || i._id === val.trim());
    if (!item) {
      errorFeedback();
      showToast(`Not found: ${val.trim()}`);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item._id)) {
        next.delete(item._id);
        showToast(`Removed: ${item.name}`);
      } else {
        next.add(item._id);
        successFeedback();
        showToast(`Added: ${item.name}`);
      }
      return next;
    });
  };

  const doAuthorize = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    let ok = 0;
    try {
      for (const id of Array.from(selected)) {
        await apiRequest(`/inventory/items/${id}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ status: "authorized" }),
        });
        ok++;
      }
      successFeedback();
      showToast(`${ok} items authorized for exit`);
      setSelected(new Set());
    } catch (e) {
      errorFeedback();
      showToast(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: theme.radius.sm, backgroundColor: "#7C3AED22", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="shield-checkmark" size={18} color="#7C3AED" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Authorization</Text>
          <MutedText style={{ fontSize: 11 }}>Scan items to select, then authorize</MutedText>
        </View>
        {selected.size > 0 && <Badge label={`${selected.size} selected`} tone="primary" />}
      </View>

      {/* Waiting for scans */}
      <View style={{ backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md, padding: 16, gap: 10, borderWidth: 1, borderColor: selected.size > 0 ? "#7C3AED" : theme.colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="barcode" size={18} color="#7C3AED" />
          <Text style={{ color: theme.colors.textMuted, fontWeight: "600", fontSize: 13, flex: 1 }}>
            {selected.size > 0 ? `${selected.size} item${selected.size !== 1 ? "s" : ""} selected` : "Scan barcodes to select items"}
          </Text>
          {submitting && <ActivityIndicator size="small" color="#7C3AED" />}
        </View>
        {lastScanned && <MutedText style={{ fontSize: 11 }}>Last: {lastScanned}</MutedText>}
      </View>

      {/* Selected items */}
      {selected.size > 0 && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Selected ({selected.size})</Text>
            <Pressable onPress={() => setSelected(new Set())}>
              <Text style={{ color: theme.colors.danger, fontWeight: "600", fontSize: 12 }}>Clear All</Text>
            </Pressable>
          </View>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
            {Array.from(selected).map((id) => {
              const item = items.find((i) => i._id === id);
              if (!item) return null;
              return (
                <View key={id} style={{ flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 10 }}>
                  <Ionicons name="checkmark-circle" size={18} color="#7C3AED" />
                  <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>{item.name}</Text>
                  <Pressable onPress={() => setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; })}>
                    <Ionicons name="close-circle" size={18} color={theme.colors.danger} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Authorize button */}
      {selected.size > 0 && (
        <View style={{ backgroundColor: "#7C3AED22", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "#7C3AED", padding: 16, gap: 10 }}>
          <Text style={{ color: "#7C3AED", fontWeight: "700", fontSize: 14, textAlign: "center" }}>
            {selected.size} item{selected.size !== 1 ? "s" : ""} ready for exit
          </Text>
          <AppButton
            title={`Authorize ${selected.size} Item${selected.size !== 1 ? "s" : ""}`}
            onPress={doAuthorize}
            loading={submitting}
            disabled={submitting}
            style={{ backgroundColor: "#7C3AED" }}
          />
        </View>
      )}

      {selected.size === 0 && (
        <View style={{ alignItems: "center", padding: 32 }}>
          <Ionicons name="barcode-outline" size={48} color={theme.colors.textMuted} />
          <MutedText style={{ marginTop: 12, textAlign: "center" }}>Scan item barcodes to select them for exit authorization.</MutedText>
        </View>
      )}

      {toastMsg && (
        <View style={{ position: "absolute", bottom: 60, left: 16, right: 16, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: 12, alignItems: "center", zIndex: 9999 }}>
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>{toastMsg}</Text>
        </View>
      )}
    </View>
  );
}

// ─── ExitScanMode — Step 1: request token → Step 2: scan tags (auto-verify) ─────
function ExitScanMode({ token }: { token: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [gateLocation, setGateLocation] = useState("EXIT_MAIN");
  const [gateKey, setGateKey] = useState<GateKey | null>(null);
  const [countdown, setCountdown] = useState("");
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [flashAuthorized, setFlashAuthorized] = useState(true);
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown
  useEffect(() => {
    if (!gateKey) return;
    const tick = () => {
      const c = formatCountdown(gateKey.expiresAt);
      setCountdown(c);
      if (c === "Expired") {
        setStep(1);
        setGateKey(null);
        setScanLog([]);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [gateKey]);

  // Request token
  const requestToken = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: boolean; key: GateKey }>("/rfid/gate-keys", {
        method: "POST",
        token,
        body: JSON.stringify({ name: "Exit Session", locationHint: gateLocation.trim(), minutes: 5 }),
      });
      setGateKey(res.key);
      setStep(2);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get token");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  // Handle tag scan result
  const handleTagResult = (val: string, authorized: boolean, itemName: string | undefined, decision: string) => {
    if (authorized) { successFeedback(); } else { errorFeedback(); }
    setFlashAuthorized(authorized);
    setFlashItem(itemName ?? val);
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 1800);
    setScanLog((prev) => [
      { tagId: val, itemName, authorized, decision, time: new Date() },
      ...prev,
    ]);
  };

  // Handle RFID scan
  const handleTagScan = async (val: string) => {
    if (!val.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; authorized: boolean; decision: string; item?: InventoryItem }>(
        "/rfid/events",
        { method: "POST", token, body: JSON.stringify({ tagId: val.trim(), eventType: "scan", location: gateLocation.trim(), source: "rfid-hub" }) }
      );
      void handleTagResult(val.trim(), res.authorized, res.item?.name, res.decision);
    } catch {
      void handleTagResult(val.trim(), false, undefined, "Scan error");
    } finally {
      setSubmitting(false);
    }
  };

  // Fixed reader polling in step 2
  useEffect(() => {
    if (step !== 2 || !gateKey) return;
    let startTime = Date.now();
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBase()}/rfid/events/latest?location=${encodeURIComponent(gateLocation)}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const json = await res.json() as { ok: boolean; event?: { tagId: string } | null };
        if (json.ok && json.event?.tagId) {
          clearInterval(poll);
          void handleTagScan(json.event.tagId);
          return;
        }
      } catch {}
      if (Date.now() - startTime > 300000) clearInterval(poll);
    }, 1200);
    return () => clearInterval(poll);
  }, [step, gateKey, gateLocation]);

  const clearSession = () => {
    setStep(1); setGateKey(null); setScanLog([]); setError(null);
  };

  const GatePresets = ["EXIT_MAIN", "EXIT_LOADING_BAY", "EXIT_REAR"];

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: theme.radius.sm, backgroundColor: theme.colors.warning + "22", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="exit" size={18} color={theme.colors.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Item Exit</Text>
          <MutedText style={{ fontSize: 11 }}>Get token → scan tags → done</MutedText>
        </View>
        {gateKey && countdown && (
          <View style={{ backgroundColor: countdown === "Expired" ? theme.colors.danger + "22" : theme.colors.warning + "22", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: countdown === "Expired" ? theme.colors.danger : theme.colors.warning, fontWeight: "700", fontSize: 12 }}>{countdown}</Text>
          </View>
        )}
      </View>

      {/* Step 1: Get Token */}
      {step === 1 && (
        <View style={{ gap: 14 }}>
          <View style={{ backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md, padding: 24, alignItems: "center", gap: 12 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.warning + "22", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="key" size={28} color={theme.colors.warning} />
            </View>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>Step 1: Get Exit Token</Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: "center" }}>Request a token to start your exit session</Text>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Gate</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {GatePresets.map((g) => (
                <Pressable key={g} onPress={() => setGateLocation(g)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: gateLocation === g ? theme.colors.warning : theme.colors.surface, borderWidth: 1, borderColor: gateLocation === g ? theme.colors.warning : theme.colors.border }}>
                  <Text style={{ color: gateLocation === g ? "#fff" : theme.colors.textMuted, fontWeight: "600", fontSize: 11 }}>{g}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {error && <ErrorText>{error}</ErrorText>}
          <AppButton title="Request Exit Token" onPress={requestToken} loading={submitting} disabled={submitting} style={{ backgroundColor: theme.colors.warning }} />
        </View>
      )}

      {/* Step 2: Scan Items */}
      {step === 2 && gateKey && (
        <View style={{ gap: 14 }}>
          {/* Token card */}
          <Card style={{ borderColor: theme.colors.warning, backgroundColor: theme.colors.warning + "11" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ color: theme.colors.warning, fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Exit Token</Text>
              <View style={{ backgroundColor: theme.colors.warning + "33", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.colors.warning, fontWeight: "700", fontSize: 12 }}>Valid: {countdown}</Text>
              </View>
            </View>
            <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 24, fontFamily: Platform.OS === "web" ? "monospace" : undefined, letterSpacing: 2, marginBottom: 8 }}>{gateKey.token}</Text>
            <AppButton title="Clear Session" onPress={clearSession} variant="secondary" />
          </Card>

          {/* Fixed reader poller */}
          <FixedReaderPoller location={gateLocation} onTag={handleTagScan} active={step === 2} />

          {/* Scan log */}
          {scanLog.length > 0 && (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Scan Log ({scanLog.length})</Text>
                <Pressable onPress={() => setScanLog([])}><Text style={{ color: theme.colors.danger, fontWeight: "600", fontSize: 11 }}>Clear</Text></Pressable>
              </View>
              <Card>
                {scanLog.map((entry, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: i < scanLog.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border, backgroundColor: entry.authorized ? theme.colors.success + "11" : theme.colors.danger + "11", gap: 10, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: theme.radius.sm }}>
                    <Ionicons name={entry.authorized ? "checkmark-circle" : "close-circle"} size={16} color={entry.authorized ? theme.colors.success : theme.colors.danger} />
                    <Text style={{ flex: 1, color: theme.colors.text, fontSize: 12, fontFamily: Platform.OS === "web" ? "monospace" : undefined }} numberOfLines={1}>{entry.tagId}</Text>
                    <Text style={{ flex: 1, color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>{entry.itemName ?? entry.decision}</Text>
                    <Text style={{ width: 54, color: entry.authorized ? theme.colors.success : theme.colors.danger, fontSize: 11, fontWeight: "700" }}>{entry.authorized ? "AUTH" : "DENIED"}</Text>
                  </View>
                ))}
              </Card>
            </View>
          )}
        </View>
      )}

      <ResultFlash authorized={flashAuthorized} itemName={flashItem ?? undefined} visible={showFlash} />
    </View>
  );
}

// ─── TagsContent ────────────────────────────────────────────────────────────────
function TagsContent({ token }: { token: string }) {
  const [tags, setTags] = useState<RfidTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  };

  const loadTags = useCallback(async (isBg = false) => {
    if (!token) return;
    if (!isBg) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiRequest<{ ok: boolean; tags: RfidTag[] }>(`/rfid/tags?${params.toString()}`, { method: "GET", token });
      setTags(res.tags ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { if (!isBg) setLoading(false); }
  }, [token, statusFilter]);

  useEffect(() => { void loadTags(); }, [loadTags]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.trim().toLowerCase();
    return tags.filter((t) => t.tagId.toLowerCase().includes(q) || t.itemName?.toLowerCase().includes(q) || t.itemSku?.toLowerCase().includes(q));
  }, [tags, search]);

  const handleRefresh = () => { setRefreshing(true); void loadTags(true); setRefreshing(false); };

  const doAction = async (tag: RfidTag, action: string) => {
    try {
      if (action === "activate") {
        await apiRequest(`/rfid/tags/${encodeURIComponent(tag.tagId)}/activate`, { method: "POST", token });
        showToast(`Activated: ${tag.tagId}`);
      } else if (action === "deactivate") {
        await apiRequest(`/rfid/tags/${encodeURIComponent(tag.tagId)}/deactivate`, { method: "POST", token });
        showToast(`Deactivated: ${tag.tagId}`);
      } else if (action === "remove") {
        Alert.alert("Remove Tag", `Remove ${tag.tagId} from ${tag.itemName ?? "item"}?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: async () => {
            await apiRequest(`/rfid/tags/${encodeURIComponent(tag.tagId)}`, { method: "DELETE", token });
            showToast("Tag removed");
            void loadTags(true);
          }},
        ]);
        return;
      } else if (action === "authorize") {
        if (!tag.itemId) { showToast("No item assigned"); return; }
        await apiRequest(`/inventory/items/${tag.itemId}`, { method: "PATCH", token, body: JSON.stringify({ status: "authorized" }) });
        showToast("Authorized for exit");
      }
      successFeedback();
      void loadTags(true);
    } catch (e) {
      errorFeedback();
      showToast(e instanceof Error ? e.message : "Failed");
    }
  };

  const StatusFilters = ["all", "active", "inactive", "authorized"];

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: theme.radius.sm, backgroundColor: theme.colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="pricetag" size={18} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Tag Registry</Text>
          <MutedText style={{ fontSize: 11 }}>{tags.length} tags total</MutedText>
        </View>
        <Pressable onPress={handleRefresh} style={{ padding: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
          <Ionicons name="refresh" size={18} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      <AutoFocusInput value={search} onChange={setSearch} onSubmit={() => {}} placeholder="Search tags..." />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {StatusFilters.map((s) => (
          <Pressable key={s} onPress={() => setStatusFilter(s)} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: statusFilter === s ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: statusFilter === s ? theme.colors.primary : theme.colors.border }}>
            <Text style={{ color: statusFilter === s ? "#0B0F17" : theme.colors.textMuted, fontWeight: "600", fontSize: 11, textTransform: "capitalize" }}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error && <ErrorText>{error}</ErrorText>}

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, backgroundColor: theme.colors.surface2, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 6 }}>
          <Text style={{ flex: 2, color: theme.colors.textMuted, fontWeight: "700", fontSize: 10, textTransform: "uppercase" }}>Tag EPC</Text>
          <Text style={{ flex: 2, color: theme.colors.textMuted, fontWeight: "700", fontSize: 10, textTransform: "uppercase" }}>Item</Text>
          <Text style={{ flex: 1, color: theme.colors.textMuted, fontWeight: "700", fontSize: 10, textTransform: "uppercase" }}>Status</Text>
          <Text style={{ width: 80, color: theme.colors.textMuted, fontWeight: "700", fontSize: 10, textTransform: "uppercase", textAlign: "center" }}>Actions</Text>
        </View>

        {loading ? (
          <View style={{ padding: 40, alignItems: "center" }}><MutedText>Loading...</MutedText></View>
        ) : filtered.length === 0 ? (
          <View style={{ padding: 40, alignItems: "center" }}><Ionicons name="pricetag-outline" size={36} color={theme.colors.textMuted} /><MutedText style={{ marginTop: 10 }}>No tags found</MutedText></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item._id}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            renderItem={({ item }) => (
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 6 }}>
                <Text style={{ flex: 2, color: theme.colors.text, fontSize: 11, fontFamily: Platform.OS === "web" ? "monospace" : undefined }} numberOfLines={1}>{item.tagId}</Text>
                <Text style={{ flex: 2, color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>{item.itemName ?? <Text style={{ color: theme.colors.textMuted, fontStyle: "italic" }}>Unassigned</Text>}</Text>
                <View style={{ flex: 1 }}><Badge label={item.status} tone={item.status === "active" ? "success" : item.status === "inactive" ? "default" : item.status === "authorized" ? "primary" : "warning"} size="default" /></View>
                <View style={{ width: 80, flexDirection: "row", justifyContent: "center", gap: 2 }}>
                  <Pressable onPress={() => doAction(item, item.status === "active" ? "deactivate" : "activate")} style={{ padding: 5, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
                    <Ionicons name={item.status === "active" ? "pause-circle-outline" : "play-circle-outline"} size={14} color={item.status === "active" ? theme.colors.warning : theme.colors.success} />
                  </Pressable>
                  <Pressable onPress={() => doAction(item, "authorize")} style={{ padding: 5, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
                    <Ionicons name="shield-checkmark-outline" size={14} color="#7C3AED" />
                  </Pressable>
                  <Pressable onPress={() => doAction(item, "remove")} style={{ padding: 5, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
                    <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {toastMsg && (
        <View style={{ position: "absolute", bottom: 20, left: 16, right: 16, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: 12, alignItems: "center", zIndex: 9999 }}>
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>{toastMsg}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export function RfidHubScreen() {
  const { token } = React.useContext(AuthContext);
  const [mode, setMode] = useState<Mode>("assign"); // Default to Receive — the main entry point

  if (token) _token = token;

  if (!token) {
    return (
      <Screen title="RFID Hub" center>
        <MutedText>Sign in to use RFID operations.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen title="RFID Hub" scroll>
      <View style={{ gap: theme.spacing.md, paddingBottom: 40 }}>
        <ModeTabRow active={mode} onSelect={setMode} />
        {mode === "tags" && <TagsContent token={token} />}
        {mode === "assign" && <TagAssignmentMode token={token} />}
        {mode === "authorize" && <AuthorizationMode token={token} />}
        {mode === "exit" && <ExitScanMode token={token} />}
      </View>
    </Screen>
  );
}
