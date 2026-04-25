import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { AppButton, Badge, BarcodeScanModal, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "RfidHub">;

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = "lookup" | "receive" | "tag" | "bin" | "count" | "exit";

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

// ─── Mode definitions ─────────────────────────────────────────────────────────
// The order follows the actual physical goods journey in a warehouse.
const MODES: Array<{ key: Mode; label: string; icon: string }> = [
  { key: "lookup", label: "Lookup",   icon: "search" },
  { key: "receive", label: "Receive",  icon: "download" },
  { key: "tag",     label: "Tag Item", icon: "pricetag" },
  { key: "bin",     label: "Bin Item", icon: "cube" },
  { key: "count",   label: "Count",    icon: "checkmark-circle" },
  { key: "exit",    label: "Exit Scan", icon: "exit" },
];

// ─── Scan RFID Button ────────────────────────────────────────────────────────
// Used with a FIXED RFID reader (reader + antenna, not handheld).
// The fixed reader continuously reads tags in range and sends them to the backend
// via POST /rfid/gate-events. When the worker taps this button, it polls
// GET /rfid/events/latest every 2s until a tag is detected — then auto-fills
// the form field. No confirmation needed.
function ScanRfidButton({
  value,
  onResult,
  disabled,
  gateLocation = "RECEIVING",
}: {
  value: string;
  onResult: (tagId: string) => void;
  disabled?: boolean;
  gateLocation?: string;
}) {
  const [listening, setListening] = useState(false);
  const [listeningStart, setListeningStart] = useState<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopListening = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (listening) { stopListening(); return; }
    setListening(true);
    setListeningStart(Date.now());

    // Poll backend for latest RFID event every 2s, stop after 20s
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/rfid/events/latest?location=${encodeURIComponent(gateLocation)}`,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        const json = await res.json() as { ok: boolean; event?: { tagId: string } | null };
        if (json.ok && json.event?.tagId) {
          stopListening();
          successFeedback();
          onResult(json.event.tagId);
          return;
        }
      } catch {}
      // Timeout after 20s
      if (Date.now() - listeningStart > 20000) { stopListening(); }
    }, 2000);

    // Safety timeout
    timeoutRef.current = setTimeout(() => { stopListening(); }, 25000);
  }, [listening, listeningStart, stopListening, onResult, gateLocation]);

  useEffect(() => { return () => { stopListening(); }; }, [stopListening]);

  if (value.trim()) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
        <Text style={{ color: theme.colors.success, fontWeight: "600", fontSize: 14, flex: 1 }}>
          {value}
        </Text>
        <Pressable onPress={() => onResult("")}>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Clear</Text>
        </Pressable>
      </View>
    );
  }

  if (listening) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.primary, borderTopColor: "transparent", opacity: 0.7, transform: [{ rotate: "45deg" }] }} />
        <Text style={{ color: theme.colors.textMuted, fontSize: 13, flex: 1 }}>
          Waiting for tag...
        </Text>
        <Pressable onPress={stopListening}>
          <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: "600" }}>Stop</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <AppButton
      title="Scan RFID"
      onPress={startListening}
      variant="secondary"
      disabled={disabled}
      iconName="wifi"
    />
  );
}

// Helpers to get token/base inside non-React callback
let _token = "";
function getToken() { return _token; }
function getApiBase() { return API_BASE_URL; }

// ─── Feedback ─────────────────────────────────────────────────────────────────
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

// ─── Mode Selector ───────────────────────────────────────────────────────────
function ModeSelector({ active, onSelect }: { active: Mode; onSelect: (m: Mode) => void }) {
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;

  if (isWideWeb) {
    return (
      <View style={{ gap: 6 }}>
        {MODES.map((m) => {
          const isActive = m.key === active;
          return (
            <Pressable
              key={m.key}
              onPress={() => onSelect(m.key)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                backgroundColor: isActive ? theme.colors.primary : "transparent",
                borderWidth: isActive ? 0 : 1,
                borderColor: theme.colors.border,
              }}
            >
              <Ionicons name={m.icon as any} size={18} color={isActive ? "#fff" : theme.colors.textMuted} />
              <Text style={{ color: isActive ? "#fff" : theme.colors.text, fontWeight: isActive ? "700" : "500", fontSize: 14 }}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
      {MODES.map((m) => {
        const isActive = m.key === active;
        return (
          <Pressable
            key={m.key}
            onPress={() => onSelect(m.key)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
              borderWidth: isActive ? 0 : 1,
              borderColor: isActive ? theme.colors.primary : theme.colors.border,
            }}
          >
            <Ionicons name={m.icon as any} size={15} color={isActive ? "#fff" : theme.colors.textMuted} />
            <Text style={{ color: isActive ? "#fff" : theme.colors.text, fontWeight: isActive ? "700" : "500", fontSize: 13 }}>
              {m.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── LOOKUP ───────────────────────────────────────────────────────────────────
// Hardware: scanner reads barcode/RFID → types into field → app calls API
// Fields: scan value (barcode or RFID tag EPC)
function LookupMode({ token }: { token: string }) {
  const [scanValue, setScanValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<InventoryItem | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const doLookup = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    setFound(null);
    try {
      // /inventory/lookup accepts barcode OR rfidTagId
      const res = await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/lookup?barcode=${encodeURIComponent(value.trim())}`,
        { method: "GET", token }
      );
      setFound(res.item);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Item not found");
      errorFeedback();
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Auto-lookup when RFID tag field changes (for hardware scanner keyboard-wedge)
  const tagTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChange = (v: string) => {
    setScanValue(v);
    if (tagTimeoutRef.current) clearTimeout(tagTimeoutRef.current);
    tagTimeoutRef.current = setTimeout(() => { if (v.trim()) doLookup(v.trim()); }, 400);
  };

  const handleScanned = (val: string) => { setScanValue(val); void doLookup(val); };

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}

      <View style={{ gap: 10 }}>
        <TextField
          ref={inputRef}
          value={scanValue}
          onChangeText={handleChange}
          placeholder="Barcode or RFID tag"
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => void doLookup(scanValue)}
        />
        <AppButton
          title="Scan barcode"
          onPress={() => setScanOpen(true)}
          variant="secondary"
        />
      </View>

      {found && (
        <View style={{ gap: 6 }}>
          <Badge label="Found" tone="success" />
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{found.name}</Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <MutedText>SKU {found.sku}</MutedText>
            <MutedText>Qty {found.quantity}</MutedText>
            <MutedText>{found.location ?? "—"}</MutedText>
          </View>
          {found.rfidTagId
            ? <MutedText>RFID: {found.rfidTagId}</MutedText>
            : <MutedText>RFID: untagged</MutedText>}
        </View>
      )}

      <BarcodeScanModal visible={scanOpen} title="Scan barcode" onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </View>
  );
}

// ─── RECEIVE ─────────────────────────────────────────────────────────────────
// Physical step: goods arrive → staff scans box barcode → confirm qty → optionally scan RFID tag → submit
// Backend: POST /inventory/receiving/units  → needs itemId (from barcode lookup), quantity, optional tagId, optional location
// Fix: lookup by barcode first to get itemId, then call receiving/units
function ReceiveMode({ token }: { token: string }) {
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [tagId, setTagId] = useState("");
  const [found, setFound] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  // Step 1: lookup item by barcode to get itemId
  const doLookup = useCallback(async (val: string) => {
    if (!val.trim()) return;
    setLoading(true);
    setError(null);
    setFound(null);
    try {
      const res = await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/lookup?barcode=${encodeURIComponent(val.trim())}`,
        { method: "GET", token }
      );
      setFound(res.item);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Item not found — add it in Inventory first");
      errorFeedback();
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Step 2: submit receiving with itemId
  const doSubmit = async () => {
    if (!found) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) { setError("Enter a valid quantity"); return; }
    if (tagId.trim() && qty > 1) { setError("When RFID tag is provided, quantity must be 1"); return; }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      // Backend: POST /inventory/receiving/units
      // Note: when tagId is set, this creates 1 InventoryUnit with that tag.
      // Without tagId, this increases item quantity by qty.
      const body: Record<string, unknown> = {
        itemId: found._id,
        quantity: qty,
      };
      if (tagId.trim()) body.tagId = tagId.trim();
      if (location.trim()) body.location = location.trim();

      await apiRequest("/inventory/receiving/units", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      const label = tagId.trim()
        ? `Received 1x ${found.name} (RFID: ${tagId.trim()})`
        : `Received ${qty}x ${found.name}`;
      setSuccess(label);
      successFeedback();
      // Reset
      setBarcode("");
      setQuantity("1");
      setLocation("");
      setTagId("");
      setFound(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receive failed");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-lookup by barcode as user types
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoRef.current) clearTimeout(autoRef.current);
    if (!barcode.trim()) { setFound(null); return; }
    autoRef.current = setTimeout(() => { void doLookup(barcode.trim()); }, 350);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [barcode, doLookup]);

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {success && <Badge label={success} tone="success" fullWidth />}

      <TextField
        value={barcode}
        onChangeText={setBarcode}
        label="Barcode"
        placeholder="Scan box/item barcode"
        autoCapitalize="none"
      />

      {found ? (
        <View style={{ gap: 10 }}>
          <Badge label="Item found" tone="success" />
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{found.name}</Text>
          <MutedText>SKU {found.sku} · Current qty {found.quantity}</MutedText>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={quantity}
                onChangeText={setQuantity}
                label="Quantity received"
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                value={location}
                onChangeText={setLocation}
                label="Location"
                placeholder="RECEIVING"
                autoCapitalize="none"
              />
            </View>
          </View>

          <ScanRfidButton
            value={tagId}
            onResult={(v) => setTagId(v)}
            gateLocation={location.trim() || "RECEIVING"}
          />
          {tagId.trim() && (
            <MutedText style={{ fontSize: 12 }}>
              Unit-level: qty is forced to 1 when RFID tag is assigned
            </MutedText>
          )}

          <AppButton
            title={submitting ? "Receiving..." : `Receive${tagId.trim() ? " (unit)" : " (bulk)"}`}
            onPress={doSubmit}
            disabled={submitting}
            loading={submitting}
          />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" />
          <AppButton title={loading ? "..." : "Find item"} onPress={() => void doLookup(barcode)} disabled={loading || !barcode.trim()} loading={loading} />
        </View>
      )}

      <BarcodeScanModal visible={scanOpen} title="Scan barcode" onClose={() => setScanOpen(false)} onScanned={(v) => setBarcode(v)} />
    </View>
  );
}

// ─── TAG ITEM ────────────────────────────────────────────────────────────────
// Physical step: staff has an item already in the system, wants to assign/change its RFID tag
// Backend: PATCH /inventory/items/:id → sets rfidTagId at ITEM level (one tag per item)
function TagMode({ token }: { token: string }) {
  const [tagId, setTagId] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const searchItems = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) { setSearchResults([]); return; }
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: true; items: InventoryItem[] }>(
        `/inventory/items?search=${encodeURIComponent(q.trim())}&limit=8`,
        { method: "GET", token }
      );
      setSearchResults(res.items ?? []);
    } catch { setSearchResults([]); }
    finally { setLoading(false); }
  }, [token]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNameChange = (v: string) => {
    setNameSearch(v);
    setSelected(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { void searchItems(v); }, 350);
  };

  const doAssign = async () => {
    if (!selected || !tagId.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/items/${selected._id}`,
        {
          method: "PATCH",
          token,
          body: JSON.stringify({ rfidTagId: tagId.trim() }),
        }
      );
      setSuccess(`RFID tag assigned to ${selected.name}`);
      successFeedback();
      setTagId("");
      setSelected(null);
      setNameSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign tag");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {success && <Badge label={success} tone="success" fullWidth />}

          <ScanRfidButton
            value={tagId}
            onResult={(v) => setTagId(v)}
            gateLocation="TAGGING"
          />

          <TextField
            value={nameSearch}
            onChangeText={handleNameChange}
            label="Item"
            placeholder="Search by name or SKU..."
            autoCapitalize="none"
          />

      {loading && <MutedText>Searching...</MutedText>}

      {searchResults.length > 0 && !selected ? (
        <View style={{ gap: 6 }}>
          {searchResults.map((item) => (
            <Pressable
              key={item._id}
              onPress={() => { setSelected(item); setSearchResults([]); setNameSearch(item.name); }}
              style={{
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.sm,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 10,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.name}</Text>
              <MutedText>SKU {item.sku} · Current RFID: {item.rfidTagId ?? "none"}</MutedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selected && (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Badge label="Selected" tone="primary" />
          <Text style={{ color: theme.colors.text, fontWeight: "600", flex: 1 }} numberOfLines={1}>{selected.name}</Text>
          <Pressable onPress={() => { setSelected(null); setNameSearch(""); }}>
            <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: "600" }}>Clear</Text>
          </Pressable>
        </View>
      )}

      <AppButton
        title={submitting ? "Assigning..." : "Assign RFID Tag"}
        onPress={doAssign}
        disabled={submitting || !selected || !tagId.trim()}
        loading={submitting}
      />
    </View>
  );
}

// ─── BIN ITEM ────────────────────────────────────────────────────────────────
// Physical step: tagged item at staging → scan RFID → assign bin location
// Backend: POST /inventory/putaway/assign-tag → finds untagged unit for item, assigns tagId + location
// First must look up item by barcode, then use itemId + scanned tagId + bin location
// Note: this endpoint finds the FIRST untagged unit for the item and assigns the tag to it.
function BinMode({ token }: { token: string }) {
  const [barcode, setBarcode] = useState("");
  const [tagId, setTagId] = useState("");
  const [binLocation, setBinLocation] = useState("");
  const [found, setFound] = useState<InventoryItem | null>(null);
  const [pending, setPending] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  // Step 1: look up item by barcode to get itemId, then check how many units are untagged
  const doLookup = useCallback(async (val: string) => {
    if (!val.trim()) return;
    setLoading(true);
    setError(null);
    setFound(null);
    setPending(0);
    try {
      const res = await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/lookup?barcode=${encodeURIComponent(val.trim())}`,
        { method: "GET", token }
      );
      setFound(res.item);

      // Check how many untagged units this item has
      const pendingRes = await apiRequest<{ ok: true; pending: number }>(
        `/inventory/putaway/pending?itemId=${res.item._id}`,
        { method: "GET", token }
      );
      setPending(pendingRes.pending);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Item not found");
      errorFeedback();
    } finally {
      setLoading(false);
    }
  }, [token]);

  const doAssign = async () => {
    if (!found || !tagId.trim() || !binLocation.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      // Backend: POST /inventory/putaway/assign-tag
      // Finds the oldest untagged unit for this item and assigns tagId + bin location
      const res = await apiRequest<{ ok: true; item: InventoryItem; pending: number }>(
        "/inventory/putaway/assign-tag",
        {
          method: "POST",
          token,
          body: JSON.stringify({
            itemId: found._id,
            tagId: tagId.trim(),
            location: binLocation.trim(),
          }),
        }
      );
      const remaining = res.pending;
      setSuccess(
        remaining > 0
          ? `Tagged and binned ${found.name} → ${binLocation.trim()} (${remaining} still pending)`
          : `Tagged and binned ${found.name} → ${binLocation.trim()} (all done)`
      );
      successFeedback();
      setTagId("");
      if (remaining === 0) {
        setFound(null);
        setBarcode("");
        setBinLocation("");
      } else {
        setPending(remaining);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoRef.current) clearTimeout(autoRef.current);
    if (!barcode.trim()) { setFound(null); setPending(0); return; }
    autoRef.current = setTimeout(() => { void doLookup(barcode.trim()); }, 350);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [barcode, doLookup]);

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {success && <Badge label={success} tone="success" fullWidth />}

      <TextField
        value={barcode}
        onChangeText={setBarcode}
        label="Barcode"
        placeholder="Scan item barcode"
        autoCapitalize="none"
      />

      {found ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Badge label="Found" tone="success" />
            <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>{found.name}</Text>
            <Badge
              label={pending > 0 ? `${pending} untagged` : "All tagged"}
              tone={pending > 0 ? "warning" : "primary"}
            />
          </View>

          <ScanRfidButton
            value={tagId}
            onResult={(v) => setTagId(v)}
            gateLocation={binLocation.trim() || "STAGING"}
          />

          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={binLocation}
                onChangeText={setBinLocation}
                label="Bin / Location"
                placeholder="e.g. BIN_A1"
                autoCapitalize="none"
              />
            </View>
            <AppButton
              title={submitting ? "..." : "Assign"}
              onPress={doAssign}
              disabled={submitting || !tagId.trim() || !binLocation.trim() || pending === 0}
              loading={submitting}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" />
          <AppButton
            title={loading ? "..." : "Find item"}
            onPress={() => void doLookup(barcode)}
            disabled={loading || !barcode.trim()}
            loading={loading}
          />
        </View>
      )}

      <BarcodeScanModal visible={scanOpen} title="Scan barcode" onClose={() => setScanOpen(false)} onScanned={(v) => setBarcode(v)} />
    </View>
  );
}

// ─── COUNT ───────────────────────────────────────────────────────────────────
// Physical step: staff physically counts items → enters count → system calculates adjustment
// Backend: POST /inventory/items/:id/adjust → delta = counted - system
function CountMode({ token }: { token: string }) {
  const [barcode, setBarcode] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [found, setFound] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const doLookup = useCallback(async (val: string) => {
    if (!val.trim()) return;
    setLoading(true);
    setError(null);
    setFound(null);
    setSuccess(null);
    try {
      const res = await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/lookup?barcode=${encodeURIComponent(val.trim())}`,
        { method: "GET", token }
      );
      setFound(res.item);
      successFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Item not found");
      errorFeedback();
    } finally {
      setLoading(false);
    }
  }, [token]);

  const doSubmit = async () => {
    if (!found) return;
    const n = Number(countedQty);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      setError("Enter a valid quantity (0 or more)");
      return;
    }
    const delta = n - found.quantity;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ ok: true; item: InventoryItem }>(
        `/inventory/items/${found._id}/adjust`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ delta, reason: "RFID cycle count" }),
        }
      );
      const sign = delta >= 0 ? "+" : "";
      setSuccess(`${sign}${delta} units — new qty: ${n}`);
      successFeedback();
      setCountedQty("");
      setFound(null);
      setBarcode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Count submission failed");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoRef.current) clearTimeout(autoRef.current);
    if (!barcode.trim()) { setFound(null); return; }
    autoRef.current = setTimeout(() => { void doLookup(barcode.trim()); }, 300);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [barcode, doLookup]);

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {success && <Badge label={success} tone="success" fullWidth />}

      <TextField
        value={barcode}
        onChangeText={setBarcode}
        label="Barcode"
        placeholder="Scan item barcode"
        autoCapitalize="none"
      />

      {found ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Badge label="Found" tone="success" />
            <Text style={[theme.typography.h3, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>{found.name}</Text>
            <MutedText>System: {found.quantity}</MutedText>
          </View>

          <TextField
            value={countedQty}
            onChangeText={setCountedQty}
            label="Physical count"
            placeholder="What you counted"
            keyboardType="number-pad"
          />

          <AppButton
            title={submitting ? "Submitting..." : "Submit count"}
            onPress={doSubmit}
            disabled={submitting || !countedQty.trim()}
            loading={submitting}
          />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton title="Scan barcode" onPress={() => setScanOpen(true)} variant="secondary" />
          <AppButton
            title={loading ? "..." : "Find item"}
            onPress={() => void doLookup(barcode)}
            disabled={loading || !barcode.trim()}
            loading={loading}
          />
        </View>
      )}

      <BarcodeScanModal visible={scanOpen} title="Scan barcode" onClose={() => setScanOpen(false)} onScanned={(v) => setBarcode(v)} />
    </View>
  );
}

// ─── EXIT SCAN ───────────────────────────────────────────────────────────────
// Physical step: item passes through gate → fixed RFID reader reads tag → backend checks exit authorization
// Backend: POST /rfid/events → creates RfidEvent, checks ExitAuthorization
// Fields: tagId (from reader), location (gate name)
function ExitMode({ token }: { token: string }) {
  const [tagId, setTagId] = useState("");
  const [gateLocation, setGateLocation] = useState("EXIT_MAIN");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    authorized: boolean;
    decision: string;
    itemName?: string;
  } | null>(null);

  const doScan = async () => {
    if (!tagId.trim()) return;
    setSubmitting(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await apiRequest<{
        ok: true;
        authorized: boolean;
        decision: string;
        item?: InventoryItem;
      }>("/rfid/events", {
        method: "POST",
        token,
        body: JSON.stringify({
          tagId: tagId.trim(),
          eventType: "scan",
          location: gateLocation.trim(),
          source: "rfid-hub",
        }),
      });
      if (res.authorized) successFeedback();
      else errorFeedback();
      setLastResult({ authorized: res.authorized, decision: res.decision, itemName: res.item?.name });
      setTagId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Exit scan failed");
      errorFeedback();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {error && <ErrorText>{error}</ErrorText>}

      <ScanRfidButton
        value={tagId}
        onResult={(v) => setTagId(v)}
        gateLocation={gateLocation.trim() || "EXIT_MAIN"}
      />

      <TextField
        value={gateLocation}
        onChangeText={setGateLocation}
        label="Gate"
        placeholder="EXIT_MAIN"
        autoCapitalize="none"
      />

      <AppButton
        title={submitting ? "Scanning..." : "Scan exit"}
        onPress={doScan}
        disabled={submitting || !tagId.trim()}
        loading={submitting}
      />

      {lastResult && (
        <View
          style={{
            borderRadius: theme.radius.md,
            borderWidth: 1.5,
            borderColor: lastResult.authorized ? theme.colors.success : theme.colors.danger,
            padding: 14,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Ionicons
              name={lastResult.authorized ? "checkmark-circle" : "close-circle"}
              size={22}
              color={lastResult.authorized ? theme.colors.success : theme.colors.danger}
            />
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
              {lastResult.authorized ? "Authorized" : "Denied"}
            </Text>
          </View>
          {lastResult.itemName && <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{lastResult.itemName}</Text>}
          <MutedText style={{ fontSize: 12 }}>{lastResult.decision}</MutedText>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export function RfidHubScreen({ navigation }: Props) {
  const { token } = React.useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;
  const [mode, setMode] = useState<Mode>("lookup");

  if (token) _token = token;

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") { navigation.popToTop(); return; }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const modeContent = useMemo(() => {
    if (!token) return <MutedText>Sign in to use RFID operations.</MutedText>;
    switch (mode) {
      case "lookup":  return <LookupMode  token={token} />;
      case "receive":  return <ReceiveMode token={token} />;
      case "tag":      return <TagMode    token={token} />;
      case "bin":      return <BinMode    token={token} />;
      case "count":    return <CountMode  token={token} />;
      case "exit":     return <ExitMode   token={token} />;
    }
  }, [mode, token]);

  const currentMode = MODES.find((m) => m.key === mode)!;

  if (isWideWeb) {
    return (
      <Screen title="RFID Hub" scroll sidebarInset>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ flexDirection: "row", gap: theme.spacing.lg, alignItems: "flex-start" }}>
            {/* Left: mode nav */}
            <View style={{ width: 160, flexShrink: 0 }}>
              <ModeSelector active={mode} onSelect={setMode} />
            </View>

            {/* Right: operation panel */}
            <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={currentMode.icon as any} size={22} color={theme.colors.primary} />
                <Text style={[theme.typography.title, { color: theme.colors.text }]}>{currentMode.label}</Text>
              </View>
              <View style={{ height: 1, backgroundColor: theme.colors.border }} />
              {modeContent}
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="RFID Hub"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <ModeSelector active={mode} onSelect={setMode} />
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name={currentMode.icon as any} size={20} color={theme.colors.primary} />
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{currentMode.label}</Text>
          </View>
          {modeContent}
        </View>
      </View>
    </Screen>
  );
}
