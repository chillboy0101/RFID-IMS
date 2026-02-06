import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, theme } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "BarcodeScanner">;

type LookupResponse = { ok: true; item: { _id: string; name: string; sku: string; barcode?: string } };

export function BarcodeScannerScreen({ navigation }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") {
      navigation.popToTop();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  const [permission, requestPermission] = useCameraPermissions();
  const [lastScan, setLastScan] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canUseCamera = useMemo(() => {
    if (Platform.OS === "web") return false;
    return !!permission?.granted;
  }, [permission?.granted]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (!token) {
        setError("You must be signed in.");
        return;
      }
      if (busy) return;
      const value = String((result as any)?.data ?? "").trim();
      if (!value) return;

      setBusy(true);
      setError(null);
      setLastScan(value);

      try {
        const res = await apiRequest<LookupResponse>(`/inventory/lookup?barcode=${encodeURIComponent(value)}`, { method: "GET", token });
        (navigation as any).navigate("Inventory", { screen: "InventoryDetail", params: { id: res.item._id } });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setTimeout(() => setBusy(false), 800);
      }
    },
    [busy, navigation, token]
  );

  if (Platform.OS === "web") {
    return (
      <Screen title="Barcode Scanner" scroll right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}>
        <Card>
          <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Camera scanning</Text>
          <MutedText>Camera scanning is not supported on web. Use a barcode scanner (keyboard-wedge / Bluetooth HID) and search in Inventory or Orders.</MutedText>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Barcode Scanner" scroll busy={busy} right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {!permission ? (
        <Card>
          <MutedText>Loading camera permissions...</MutedText>
        </Card>
      ) : !permission.granted ? (
        <Card>
          <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Camera permission</Text>
          <MutedText>Allow camera access to scan barcodes.</MutedText>
          <View style={{ height: 12 }} />
          <AppButton title="Allow camera" onPress={() => requestPermission()} />
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" as any }}>
          <View style={{ height: 360, backgroundColor: "#000" }}>
            {canUseCamera ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "code128", "code39", "upc_a", "upc_e", "qr"] }}
                onBarcodeScanned={handleScan}
              />
            ) : null}
          </View>
          <View style={{ padding: theme.spacing.md, gap: 10 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Scan an item barcode</Text>
            {lastScan ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <Badge label={busy ? "Processing" : "Scanned"} tone={busy ? "warning" : "success"} />
                <MutedText>Value: {lastScan}</MutedText>
              </View>
            ) : (
              <MutedText>Point the camera at the barcode/QR code.</MutedText>
            )}
          </View>
        </Card>
      )}

      <Card>
        <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Alternative (HID scanner)</Text>
        <MutedText>If you use a Bluetooth barcode scanner, set it to keyboard mode and scan into the Inventory search field.</MutedText>
      </Card>
    </Screen>
  );
}
