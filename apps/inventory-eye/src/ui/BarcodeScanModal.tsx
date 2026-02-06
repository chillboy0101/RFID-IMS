import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";

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

  const { width, height } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const modalMaxWidth = useMemo(() => {
    if (!width) return 420;
    return Math.min(420, Math.max(280, width - theme.spacing.md * 2));
  }, [width]);

  const modalMaxHeight = useMemo(() => {
    if (!height) return 620;
    return Math.min(680, Math.max(460, height - theme.spacing.md * 2));
  }, [height]);

  const barcodeTypes = useMemo(
    () =>
      [
        "qr",
        "ean13",
        "ean8",
        "upc_a",
        "upc_e",
        "code128",
        "code39",
        "code93",
        "pdf417",
        "aztec",
        "datamatrix",
        "itf14",
        "codabar",
      ] as any,
    []
  );

  const canUseCamera = useMemo(() => {
    return !!permission?.granted;
  }, [permission?.granted]);

  useEffect(() => {
    if (!visible) return;
    if (!permission) return;
    if (permission.granted) return;
    if (permission.status === "denied") return;

    requestPermission().catch(() => setError("Permission request failed"));
  }, [permission, requestPermission, visible]);

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

  const cameraCard = !permission ? (
    <Card>
      <MutedText>Loading camera permissions...</MutedText>
    </Card>
  ) : !permission.granted ? (
    permission.status === "denied" ? (
      <Card>
        <MutedText>Camera permission is denied. Enable it in your device settings to scan barcodes.</MutedText>
        <View style={{ height: 12 }} />
        <AppButton title="Try again" onPress={() => requestPermission().catch(() => setError("Permission request failed"))} />
      </Card>
    ) : (
      <Card>
        <MutedText>Requesting camera permission…</MutedText>
      </Card>
    )
  ) : (
    <Card style={{ padding: 0, overflow: "hidden" as any }}>
      <View style={{ width: "100%", aspectRatio: 1, backgroundColor: "#000" }}>
        {canUseCamera ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes }}
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
  );

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      <AppButton title="Close" onPress={onClose} variant="secondary" />
    </View>
  );

  const helper = Platform.OS === "web" ? (
    <MutedText>If the camera does not open, your browser may require HTTPS (or localhost) and explicit permission.</MutedText>
  ) : null;

  const errorBox = error ? (
    <View style={{ marginTop: 10 }}>
      <ErrorText>{error}</ErrorText>
    </View>
  ) : null;

  const body = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.md }}>
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
      <View
        style={{
          width: "100%",
          maxWidth: modalMaxWidth,
          maxHeight: modalMaxHeight,
          backgroundColor: theme.colors.bg,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
        }}
      >
        {header}
        <View style={{ height: 12 }} />
        {helper}
        {errorBox}
        <View style={{ height: 12 }} />
        {cameraCard}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType={isDesktopWeb ? "fade" : "fade"} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}>{body}</View>
    </Modal>
  );
}
