import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { API_BASE_URL } from "../config";
import { getApiTenantId } from "../api/tenant";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, TextField, theme } from "../ui";

type ExportType = "inventory" | "orders" | "logs" | "reorders";

type Props = NativeStackScreenProps<MoreStackParamList, "Integrations">;

const exportTypes: ExportType[] = ["inventory", "orders", "logs", "reorders"];

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, "-");
}

export function IntegrationsScreen({ navigation }: Props) {
  const { token, effectiveRole } = useContext(AuthContext);
  const isAdmin = effectiveRole === "admin";

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "AdminHub");
  }, [navigation]);

  const [exportType, setExportType] = useState<ExportType>("inventory");
  const [exportCsv, setExportCsv] = useState<string>("");
  const [exportPreviewOpen, setExportPreviewOpen] = useState(true);

  const [importJson, setImportJson] = useState<string>("");
  const [importFileName, setImportFileName] = useState<string>("");
  const [importPreviewCount, setImportPreviewCount] = useState<number | null>(null);
  const [importCsv, setImportCsv] = useState<string>("");
  const [importPreviewOpen, setImportPreviewOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultJson, setResultJson] = useState<string>("");

  const canUse = isAdmin;

  const downloadTextFile = useCallback(async (filename: string, text: string, mimeType: string) => {
    if (!text.trim()) return;

    if (Platform.OS !== "web") {
      const dir = FileSystem.cacheDirectory;
      if (!dir) throw new Error("File storage is unavailable on this device");

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) throw new Error("File sharing is unavailable on this device");

      const uri = `${dir}${safeFileName(filename)}`;
      await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, {
        mimeType,
        UTI: mimeType === "text/csv" ? "public.comma-separated-values-text" : "public.plain-text",
        dialogTitle: filename,
      });
      return;
    }

    if (typeof document === "undefined") return;

    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const parseCsv = useCallback((text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          const next = text[i + 1];
          if (next === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === ",") {
        row.push(field);
        field = "";
        continue;
      }

      if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        continue;
      }

      if (ch === "\r") {
        continue;
      }

      field += ch;
    }

    row.push(field);
    rows.push(row);

    while (rows.length > 0 && rows[rows.length - 1].every((c) => String(c ?? "").trim() === "")) {
      rows.pop();
    }

    return rows;
  }, []);

  const exportPreview = useMemo(() => {
    if (!exportCsv.trim()) return null;
    const rows = parseCsv(exportCsv);
    if (rows.length === 0) return null;
    const header = rows[0] ?? [];
    const body = rows.slice(1, 51);
    return { header, body, totalRows: Math.max(0, rows.length - 1) };
  }, [exportCsv, parseCsv]);

  const importPreview = useMemo(() => {
    if (!importCsv.trim()) return null;
    const rows = parseCsv(importCsv);
    if (rows.length === 0) return null;
    const header = rows[0] ?? [];
    const body = rows.slice(1, 51);
    return { header, body, totalRows: Math.max(0, rows.length - 1) };
  }, [importCsv, parseCsv]);

  const applyImportFileText = useCallback(
    (text: string, filename: string) => {
      setImportFileName(filename);
      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error("CSV must include a header row and at least 1 data row");
      }
      setImportPreviewCount(Math.max(0, rows.length - 1));
      setImportCsv(text);
      setImportPreviewOpen(true);
    },
    [parseCsv]
  );

  const pickImportFile = useCallback(async () => {
    if (Platform.OS !== "web") {
      try {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ["text/csv", "text/plain", "text/comma-separated-values", "application/vnd.ms-excel"],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (picked.canceled) return;
        const asset = picked.assets?.[0];
        if (!asset) return;
        const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
        applyImportFileText(text, asset.name || "inventory-import.csv");
      } catch (e) {
        setImportFileName("");
        setImportPreviewCount(null);
        setImportCsv("");
        setError(e instanceof Error ? e.message : "Invalid import file");
      }
      return;
    }

    if (typeof document === "undefined") return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/plain,application/vnd.ms-excel";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        applyImportFileText(text, file.name);
      } catch (e) {
        setImportFileName("");
        setImportPreviewCount(null);
        setImportCsv("");
        setError(e instanceof Error ? e.message : "Invalid import file");
      }
    };
    input.click();
  }, [applyImportFileText]);

  const onPasteImportCsv = useCallback(
    (text: string) => {
      setImportCsv(text);
      try {
        const rows = parseCsv(text);
        if (rows.length >= 2) {
          setImportPreviewCount(Math.max(0, rows.length - 1));
          setImportPreviewOpen(true);
        } else {
          setImportPreviewCount(null);
        }
      } catch {
        setImportPreviewCount(null);
      }
    },
    [parseCsv]
  );

  const runExport = useCallback(async () => {
    if (!token || !canUse) return;
    setLoading(true);
    setError(null);

    try {
      const tenantId = getApiTenantId();
      if (!tenantId) throw new Error("Active branch is required");
      const res = await fetch(`${API_BASE_URL}/integrations/export?type=${encodeURIComponent(exportType)}&format=csv`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Tenant-ID": tenantId,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      setExportCsv(text);
      setExportPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }, [canUse, exportType, token]);

  const downloadExportCsv = useCallback(async () => {
    if (!exportCsv) return;
    setError(null);
    try {
      await downloadTextFile(`export-${exportType}.csv`, exportCsv, "text/csv");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }, [downloadTextFile, exportCsv, exportType]);

  const downloadTemplate = useCallback(async () => {
    if (!token || !canUse) return;
    setLoading(true);
    setError(null);
    try {
      const tenantId = getApiTenantId();
      if (!tenantId) throw new Error("Active branch is required");
      const res = await fetch(`${API_BASE_URL}/integrations/template?type=inventory&format=csv`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Tenant-ID": tenantId,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      await downloadTextFile("inventory-import-template.csv", text, "text/csv");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template download failed");
    } finally {
      setLoading(false);
    }
  }, [canUse, downloadTextFile, token]);

  const runImportInventoryCsv = useCallback(async () => {
    if (!token || !canUse) return;
    if (!importCsv.trim()) {
      setError("Choose a CSV file first");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tenantId = getApiTenantId();
      if (!tenantId) throw new Error("Active branch is required");
      const res = await fetch(`${API_BASE_URL}/integrations/import/inventory/csv`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Tenant-ID": tenantId,
          "Content-Type": "text/csv",
        },
        body: importCsv,
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { ok: false, error: text || `HTTP ${res.status}` };
      }
      if (!res.ok) {
        throw new Error(String(parsed?.error ?? `HTTP ${res.status}`));
      }

      setResultJson(JSON.stringify(parsed, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }, [canUse, importCsv, token]);

  const runImportInventory = useCallback(async () => {
    if (!token || !canUse) return;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(importJson);
      if (!Array.isArray(parsed)) {
        throw new Error("Import JSON must be an array of inventory items");
      }

      const res = await apiRequest<{ ok: true; upserted: number }>("/integrations/import/inventory", {
        method: "POST",
        token,
        body: JSON.stringify({ items: parsed }),
      });

      setResultJson(JSON.stringify(res, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }, [canUse, importJson, token]);

  const Table = useCallback(
    ({ header, body }: { header: string[]; body: string[][] }) => {
      return (
        <ScrollView horizontal style={{ marginTop: 10 }}>
          <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", backgroundColor: theme.colors.surface2 }}>
              {header.map((h, i) => (
                <View
                  key={`${h}-${i}`}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, minWidth: 140, borderRightWidth: i === header.length - 1 ? 0 : 1, borderColor: theme.colors.border }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{h || "-"}</Text>
                </View>
              ))}
            </View>
            {body.map((r, ri) => (
              <View key={ri} style={{ flexDirection: "row", backgroundColor: ri % 2 === 0 ? theme.colors.surface : theme.colors.surface2 }}>
                {header.map((_, ci) => (
                  <View
                    key={`${ri}-${ci}`}
                    style={{ paddingVertical: 10, paddingHorizontal: 12, minWidth: 140, borderTopWidth: 1, borderRightWidth: ci === header.length - 1 ? 0 : 1, borderColor: theme.colors.border }}
                  >
                    <Text style={{ color: theme.colors.textMuted }} numberOfLines={2}>
                      {String(r[ci] ?? "")}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    },
    []
  );

  const PreviewToolbar = useCallback(
    ({
      totalRows,
      open,
      onToggle,
    }: {
      totalRows: number;
      open: boolean;
      onToggle: () => void;
    }) => (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          minHeight: 48,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <Badge label={`Rows: ${totalRows}`} tone="primary" />
          {isDesktopWeb ? <Badge label="Preview (first 50)" tone="default" /> : <MutedText>Preview</MutedText>}
        </View>
        <AppButton
          title={open ? "Hide preview" : "Show preview"}
          variant="secondary"
          onPress={onToggle}
          style={{ minWidth: isDesktopWeb ? undefined : 142 }}
        />
      </View>
    ),
    [isDesktopWeb]
  );

  return (
    <Screen
      title="Import & Export"
      scroll
      right={<AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly />}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ gap: theme.spacing.md }}>
        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Export</Text>
          <MutedText>Run an export to generate a CSV (Excel-friendly), then download it.</MutedText>

          {!canUse ? (
            <View style={{ marginTop: 10 }}>
              <MutedText>Import & Export is admin-only.</MutedText>
            </View>
          ) : null}

          <View style={{ height: 10 }} />
          <Text style={{ color: theme.colors.textMuted, marginBottom: 8 }}>Type</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {exportTypes.map((t) => (
              <AppButton key={t} title={t} onPress={() => setExportType(t)} variant={t === exportType ? "primary" : "secondary"} />
            ))}
          </View>

          <View style={{ height: 12 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <AppButton title="Run export" onPress={runExport} disabled={!canUse || loading} loading={loading} />
            <AppButton
              title="Download CSV"
              onPress={downloadExportCsv}
              variant="secondary"
              disabled={!canUse || !exportCsv}
            />
          </View>

          {exportPreview ? (
            <View style={{ marginTop: 10 }}>
              <PreviewToolbar
                totalRows={exportPreview.totalRows}
                open={exportPreviewOpen}
                onToggle={() => setExportPreviewOpen((v) => !v)}
              />
              {exportPreviewOpen ? <Table header={exportPreview.header} body={exportPreview.body} /> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Import inventory</Text>
          <MutedText>Upload a CSV file (Excel-friendly) to add/update items in bulk.</MutedText>

          <View style={{ height: 10 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <AppButton title="Choose file" onPress={pickImportFile} variant="secondary" disabled={!canUse || loading} />
            <AppButton
              title="Download template"
              onPress={downloadTemplate}
              variant="secondary"
              disabled={!canUse || loading}
            />
            {importFileName ? <Badge label={importFileName} tone="default" /> : null}
            {typeof importPreviewCount === "number" ? <Badge label={`Items: ${importPreviewCount}`} tone="primary" /> : null}
          </View>

          {Platform.OS !== "web" ? (
            <View style={{ marginTop: 12, gap: 12 }}>
              <TextField
                label="CSV (paste from Excel)"
                value={importCsv}
                onChangeText={onPasteImportCsv}
                placeholder="name,quantity\nItem,10"
                autoCapitalize="none"
                multiline
                numberOfLines={10}
              />
              <TextField
                label="Items JSON array (optional)"
                value={importJson}
                onChangeText={setImportJson}
                placeholder='[{"name":"Item","quantity":10}]'
                autoCapitalize="none"
                multiline
                numberOfLines={8}
              />
            </View>
          ) : null}

          {importPreview ? (
            <View style={{ marginTop: 10 }}>
              <PreviewToolbar
                totalRows={importPreview.totalRows}
                open={importPreviewOpen}
                onToggle={() => setImportPreviewOpen((v) => !v)}
              />
              {importPreviewOpen ? <Table header={importPreview.header} body={importPreview.body} /> : null}
            </View>
          ) : null}

          <View style={{ height: 12 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <AppButton title="Import CSV" onPress={runImportInventoryCsv} disabled={!canUse || loading} loading={loading} />
            {Platform.OS !== "web" ? (
              <AppButton
                title="Import JSON"
                onPress={runImportInventory}
                disabled={!canUse || loading}
                loading={loading}
                variant="secondary"
              />
            ) : null}
          </View>
        </Card>

        {resultJson ? (
          <Card>
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginBottom: 10 }]}>Result</Text>
            <Text
              selectable
              style={{
                color: theme.colors.textMuted,
                fontFamily: "monospace" as any,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {resultJson}
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
