import React, { useCallback, useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { AppButton, Badge, Card, ErrorText, MutedText } from "./components";
import { theme } from "./theme";

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onScanned: (value: string) => void;
};

export function BarcodeScanModal({ visible, title = "Scan barcode", onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const canUseCamera = useMemo(() => {
    return !!permission?.granted;
  }, [permission?.granted]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (busy) return;
      const value = String((result as any)?.data ?? "").trim();
      if (!value) return;

      setBusy(true);
      setLast(value);
      setError(null);

      onScanned(value);
      setTimeout(() => setBusy(false), 800);
    },
    [busy, onScanned]
  );

  const body = (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />

      <View
        style={{
          padding: theme.spacing.md,
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <AppButton title="Close" onPress={onClose} variant="secondary" />
        </View>

        <View style={{ height: 12 }} />

        {Platform.OS === "web" ? (
          <MutedText>
            If the camera does not open, your browser may require HTTPS (or localhost) and explicit permission.
          </MutedText>
        ) : null}

        {error ? (
          <View style={{ marginTop: 10 }}>
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}

        <View style={{ height: 12 }} />

        {!permission ? (
          <Card>
            <MutedText>Loading camera permissions...</MutedText>
          </Card>
        ) : !permission.granted ? (
          <Card>
            <MutedText>Allow camera access to scan barcodes.</MutedText>
            <View style={{ height: 12 }} />
            <AppButton title="Allow camera" onPress={() => requestPermission().catch(() => setError("Permission request failed"))} />
          </Card>
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" as any }}>
            <View style={{ height: 320, backgroundColor: "#000" }}>
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
              {last ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <Badge label={busy ? "Processing" : "Scanned"} tone={busy ? "warning" : "success"} />
                  <MutedText>Value: {last}</MutedText>
                </View>
              ) : (
                <MutedText>Point the camera at the barcode/QR code.</MutedText>
              )}
            </View>
          </Card>
        )}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}>{body}</View>
    </Modal>
  );
}
