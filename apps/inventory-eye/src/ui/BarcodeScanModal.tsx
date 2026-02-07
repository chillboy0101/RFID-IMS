import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BrowserMultiFormatReader } from "@zxing/browser";

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
  const [webVideoReady, setWebVideoReady] = useState(0);
  const [webNeedsTap, setWebNeedsTap] = useState(false);

  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const webReaderRef = useRef<any>(null);
  const webStreamRef = useRef<MediaStream | null>(null);

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

  const webHints = useMemo(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.PDF_417,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.AZTEC,
    ]);
    return hints;
  }, []);

  const canUseCamera = useMemo(() => {
    return !!permission?.granted;
  }, [permission?.granted]);

  const stopWebCamera = useCallback(() => {
    try {
      webStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    webStreamRef.current = null;
    try {
      const videoEl = webVideoRef.current;
      if (videoEl) (videoEl as any).srcObject = null;
    } catch {
      // ignore
    }
    try {
      (webReaderRef.current as any)?.reset?.();
      (webReaderRef.current as any)?.stopContinuousDecode?.();
      (webReaderRef.current as any)?.stopAsyncDecode?.();
    } catch {
      // ignore
    }
  }, []);

  const startWebCamera = useCallback(async () => {
    setError(null);
    setWebNeedsTap(false);

    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const videoEl = webVideoRef.current;
    if (!videoEl) return;

    const isSecure = (window as any).isSecureContext;
    const host = window.location?.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    if (!isSecure && !isLocalhost) {
      setError("Camera requires HTTPS (or localhost). Open the app over HTTPS then try again.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported in this browser.");
      return;
    }

    stopWebCamera();
    setWebVideoReady(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false } as any);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to access camera. Please allow camera permission.");
      return;
    }

    webStreamRef.current = stream;
    (videoEl as any).srcObject = stream;

    try {
      await (videoEl as any).play?.();
      setWebVideoReady((v) => v + 1);
    } catch {
      setWebNeedsTap(true);
    }
  }, [stopWebCamera]);

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === "web") return;
    if (permission?.granted) return;
    if (permission?.status === "denied") {
      setError("Camera permission is denied. Enable it in your device settings to scan barcodes.");
      return;
    }

    requestPermission().catch(() => setError("Failed to request camera permission"));
  }, [permission, requestPermission, visible]);

  useEffect(() => {
    if (!visible) {
      setBusy(false);
      setLast("");
      setError(null);
    }
    if (Platform.OS !== "web") return;
    if (!visible) return;
    void startWebCamera();
    return () => stopWebCamera();
  }, [startWebCamera, stopWebCamera, visible]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!visible) return;
    if (!webVideoReady) return;
    if (busy) return;

    const videoEl = webVideoRef.current;
    if (!videoEl) return;

    let cancelled = false;

    const run = async () => {
      try {
        const AnyWindow = window as any;
        const Detector = AnyWindow?.BarcodeDetector as any;

        if (Detector) {
          const formats = [
            "qr_code",
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "code_128",
            "code_39",
            "code_93",
            "itf",
            "codabar",
            "pdf417",
            "data_matrix",
            "aztec",
          ];
          const detector = new Detector({ formats });

          while (!cancelled) {
            const barcodes = await detector.detect(videoEl);
            if (cancelled) return;
            const raw = barcodes?.[0]?.rawValue;
            const value = String(raw ?? "").trim();
            if (value) {
              setBusy(true);
              setLast(value);
              onScanned(value);
              setTimeout(() => setBusy(false), 800);
              return;
            }
            await new Promise((r) => setTimeout(r, 180));
          }
          return;
        }

        if (!webReaderRef.current) {
          webReaderRef.current = new BrowserMultiFormatReader(webHints, { delayBetweenScanAttempts: 200 } as any);
        }
        const reader = webReaderRef.current;

        while (!cancelled) {
          const result = await reader.decodeFromVideoElement(videoEl);
          if (cancelled) return;
          const value = String(result?.getText?.() ?? "").trim();
          if (!value) continue;

          setBusy(true);
          setLast(value);
          onScanned(value);
          setTimeout(() => setBusy(false), 800);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to scan barcode");
      }
    };

    void run();

    return () => {
      cancelled = true;
      try {
        (webReaderRef.current as any)?.reset?.();
      } catch {
        // ignore
      }
    };
  }, [busy, onScanned, visible, webHints, webVideoReady]);

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

  const cameraCard = (
    <Card style={{ padding: 0, overflow: "hidden" as any }}>
      <View style={{ width: "100%", aspectRatio: 1, backgroundColor: "#000" }}>
        {Platform.OS === "web" ? (
          <View style={{ flex: 1 }}>
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "#000",
              }}
            />
            <video
              ref={(el) => {
                webVideoRef.current = el;
              }}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              muted
              playsInline
              autoPlay
            />
            {webVideoReady ? null : (
              <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                {webNeedsTap ? (
                  <AppButton title="Tap to start camera" onPress={startWebCamera as any} variant="secondary" />
                ) : (
                  <MutedText style={{ color: "#fff" as any }}>Starting camera…</MutedText>
                )}
              </View>
            )}
          </View>
        ) : canUseCamera ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes }}
            onBarcodeScanned={handleScan}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <MutedText style={{ color: "#fff" as any }}>Waiting for camera permission…</MutedText>
          </View>
        )}
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
        {helper ? <View style={{ height: 12 }} /> : null}
        {helper}
        {errorBox}
        {cameraCard ? <View style={{ height: 12 }} /> : null}
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
