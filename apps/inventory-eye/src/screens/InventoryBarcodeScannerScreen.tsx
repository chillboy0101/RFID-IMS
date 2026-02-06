import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { AuthContext } from "../auth/AuthContext";
import type { InventoryStackParamList } from "../navigation/types";
import { AppButton, Badge, Card, ErrorText, MutedText, Screen, theme } from "../ui";

type Props = NativeStackScreenProps<InventoryStackParamList, "BarcodeScanner">;

export function InventoryBarcodeScannerScreen({ navigation, route }: Props) {
  const { token } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("InventoryList");
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
        const returnTo = route.params?.returnTo;
        if (returnTo === "InventoryEdit") {
          navigation.replace("InventoryEdit", { id: route.params?.id, scannedBarcode: value });
          return;
        }
        if (returnTo === "InventoryCreate") {
          navigation.replace("InventoryCreate", { scannedBarcode: value });
          return;
        }
        navigation.replace("InventoryCreate", { scannedBarcode: value });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setTimeout(() => setBusy(false), 800);
      }
    },
    [busy, navigation, route.params, token]
  );

  if (Platform.OS === "web") {
    return (
      <Screen title="Barcode Scanner" scroll right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}>
        <Card>
          <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 10 }]}>Camera scanning</Text>
          <MutedText>Camera scanning is not supported on web. Use a barcode scanner (keyboard-wedge / Bluetooth HID) and scan into the barcode field.</MutedText>
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
    </Screen>
  );
}
