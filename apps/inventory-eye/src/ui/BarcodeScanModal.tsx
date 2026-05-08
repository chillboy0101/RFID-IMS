import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";

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

function ScanFrameOverlay() {
  const lineColor = "rgba(255,255,255,0.92)";
  const shadowColor = "rgba(11,15,23,0.28)";
  const cornerSize = 34;
  const lineWidth = 3;

  const baseCorner = {
    position: "absolute" as const,
    width: cornerSize,
    height: cornerSize,
    borderColor: lineColor,
    shadowColor,
    shadowOpacity: 0.45,
    shadowRadius: 8,
  };

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ width: "74%", height: "48%", maxWidth: 310, maxHeight: 220, minHeight: 138, position: "relative" }}>
        <View style={[baseCorner, { top: 0, left: 0, borderTopWidth: lineWidth, borderLeftWidth: lineWidth }]} />
        <View style={[baseCorner, { top: 0, right: 0, borderTopWidth: lineWidth, borderRightWidth: lineWidth }]} />
        <View style={[baseCorner, { bottom: 0, left: 0, borderBottomWidth: lineWidth, borderLeftWidth: lineWidth }]} />
        <View style={[baseCorner, { bottom: 0, right: 0, borderBottomWidth: lineWidth, borderRightWidth: lineWidth }]} />
      </View>
    </View>
  );
}

export function BarcodeScanModal({ visible, title = "Scan barcode", onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [webVideoReady, setWebVideoReady] = useState(0);
  const [webNeedsTap, setWebNeedsTap] = useState(false);
  const [webStatus, setWebStatus] = useState<string>("");
  const [webDiag, setWebDiag] = useState<string>("");
  const [webMirror, setWebMirror] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const busyRef = useRef(false);
  const webHiddenRef = useRef(false);
  const webFocusedRef = useRef(true);

  const webScanIntervalRef = useRef<any>(null);
  const webStartTimeoutRef = useRef<any>(null);
  const busyTimeoutRef = useRef<any>(null);

  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const webReaderRef = useRef<any>(null);
  const webStreamRef = useRef<MediaStream | null>(null);
  const manualInputRef = useRef<TextInput | null>(null);

  const isWeb = Platform.OS === "web";
  const webScanDisabled = false;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const processScannedValue = useCallback(
    (rawValue: string) => {
      if (busyRef.current) return false;
      const value = String(rawValue ?? "")
        .replace(/[\r\n]+/g, "")
        .trim();
      if (!value) return false;

      const now = Date.now();
      if (lastScanRef.current.value === value && now - lastScanRef.current.at < 1200) return false;
      lastScanRef.current = { value, at: now };

      setBusy(true);
      setLast(value);
      setError(null);
      setManualValue("");
      onScanned(value);

      try {
        if (busyTimeoutRef.current) clearTimeout(busyTimeoutRef.current);
      } catch {
        // ignore
      }
      busyTimeoutRef.current = setTimeout(() => setBusy(false), 800);
      return true;
    },
    [onScanned]
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (webScanDisabled) return;
    if (typeof document === "undefined") return;

    const update = () => {
      try {
        webHiddenRef.current = !!(document as any).hidden;
      } catch {
        webHiddenRef.current = false;
      }
    };

    update();
    try {
      document.addEventListener("visibilitychange", update);
    } catch {
      // ignore
    }

    return () => {
      try {
        document.removeEventListener("visibilitychange", update);
      } catch {
        // ignore
      }
    };
  }, [webScanDisabled]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (webScanDisabled) return;
    if (typeof window === "undefined") return;

    const onFocus = () => {
      webFocusedRef.current = true;
    };
    const onBlur = () => {
      webFocusedRef.current = false;
    };

    try {
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
      } catch {
        // ignore
      }
    };
  }, []);

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
    hints.set(DecodeHintType.TRY_HARDER, true);
    return hints;
  }, []);

  const canUseCamera = useMemo(() => {
    return !!permission?.granted;
  }, [permission?.granted]);

  const stopWebCamera = useCallback(() => {
    if (webScanDisabled) return;
    setWebStatus("");
    setWebDiag("");
    setWebVideoReady(0);
    setWebNeedsTap(true);
    try {
      if (webScanIntervalRef.current) clearInterval(webScanIntervalRef.current);
    } catch {
      // ignore
    }
    webScanIntervalRef.current = null;
    try {
      if (webStartTimeoutRef.current) clearTimeout(webStartTimeoutRef.current);
    } catch {
      // ignore
    }
    webStartTimeoutRef.current = null;
    try {
      if (busyTimeoutRef.current) clearTimeout(busyTimeoutRef.current);
    } catch {
      // ignore
    }
    busyTimeoutRef.current = null;

    try {
      webStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    webStreamRef.current = null;
    try {
      const videoEl = webVideoRef.current;
      try {
        (videoEl as any)?.pause?.();
      } catch {
        // ignore
      }
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
  }, [webScanDisabled]);

  const startWebCamera = useCallback(async () => {
    if (webScanDisabled) {
      setError("Scanning is disabled on web. Please use the mobile app to scan.");
      return;
    }
    setError(null);
    setWebNeedsTap(false);
    setWebStatus("Requesting camera…");
    setWebDiag("");
    setWebMirror(false);

    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const videoEl = webVideoRef.current;
    if (!videoEl) return;

    const isSecure = (window as any).isSecureContext;
    const host = window.location?.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    if (!isSecure && !isLocalhost) {
      setError("Camera requires HTTPS (or localhost). Open the app over HTTPS then try again.");
      setWebStatus("Blocked: insecure context");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported in this browser.");
      setWebStatus("Blocked: getUserMedia unavailable");
      return;
    }

    stopWebCamera();
    setWebVideoReady(0);
    setWebStatus("Starting stream…");

    try {
      (videoEl as any).setAttribute?.("playsinline", "true");
      (videoEl as any).setAttribute?.("webkit-playsinline", "true");
      (videoEl as any).muted = true;
      (videoEl as any).autoplay = true;
    } catch {
      // ignore
    }

    let stream: MediaStream;
    try {
      let deviceId: string | undefined = undefined;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const preferred = cams.find((d) => /back|rear|environment/i.test(String(d.label ?? "")));
        deviceId = (preferred ?? cams[cams.length - 1])?.deviceId;
      } catch {
        // ignore
      }

      stream = await navigator.mediaDevices.getUserMedia(
        {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : null),
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        } as any
      );
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false } as any);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to access camera. Please allow camera permission.");
        return;
      }
    }

    webStreamRef.current = stream;
    (videoEl as any).srcObject = stream;

    try {
      const track = stream.getVideoTracks?.()?.[0];
      const s = track?.getSettings?.();
      const facing = String((s as any)?.facingMode ?? "").toLowerCase();
      if (facing === "user") setWebMirror(true);
      setWebDiag(
        `track:${track ? "yes" : "no"} enabled:${String(track?.enabled)} muted:${String((track as any)?.muted)} ` +
          `w:${String((s as any)?.width ?? "?")} h:${String((s as any)?.height ?? "?")}`
      );
    } catch {
      // ignore
    }

    const waitForMeta = () =>
      new Promise<void>((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          reject(new Error("Camera did not start (no video frames)"));
        }, 2500);

        const cleanup = () => {
          try {
            clearTimeout(t);
          } catch {
            // ignore
          }
          try {
            (videoEl as any).removeEventListener?.("loadedmetadata", onLoaded);
          } catch {
            // ignore
          }
        };

        const onLoaded = () => {
          if (done) return;
          done = true;
          cleanup();
          resolve();
        };

        try {
          if (((videoEl as any).videoWidth ?? 0) > 0) {
            done = true;
            cleanup();
            resolve();
            return;
          }
          (videoEl as any).addEventListener?.("loadedmetadata", onLoaded);
        } catch {
          // ignore
        }
      });

    try {
      setWebStatus("Waiting for camera frames…");
      await waitForMeta();
      setWebStatus("Starting preview…");
      await (videoEl as any).play?.();
      setWebVideoReady((v) => v + 1);
      setWebNeedsTap(false);
      setWebStatus("Camera ready");
    } catch (e) {
      setWebNeedsTap(true);
      setWebStatus("Tap required");
      if (e instanceof Error && e.message.includes("no video frames")) {
        setError(
          "Camera permission may be allowed, but no frames are arriving. If using Brave, disable Shields for this site, or close other apps using the camera, then try again."
        );
      }
    }

    try {
      if (webStartTimeoutRef.current) clearTimeout(webStartTimeoutRef.current);
    } catch {
      // ignore
    }

    webStartTimeoutRef.current = setTimeout(() => {
      try {
        if (webStreamRef.current && (videoEl as any) && ((videoEl as any).videoWidth ?? 0) === 0) {
          setWebNeedsTap(true);
        }
      } catch {
        // ignore
      }
    }, 1200);
  }, [stopWebCamera, webScanDisabled]);

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
      setManualValue("");
    }
    if (Platform.OS !== "web") return;
    if (webScanDisabled) return;
    if (!visible) return;
    setWebNeedsTap(false);
    setWebStatus("Starting camera...");
    void startWebCamera();
    return () => stopWebCamera();
  }, [startWebCamera, stopWebCamera, visible, webScanDisabled]);

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS !== "web") return;
    const id = setTimeout(() => {
      try {
        manualInputRef.current?.focus?.();
      } catch {
        // ignore
      }
    }, 120);

    return () => {
      try {
        clearTimeout(id);
      } catch {
        // ignore
      }
    };
  }, [visible]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (webScanDisabled) return;
    if (!visible) return;

    if (webVideoReady) return;

    const id = setInterval(() => {
      try {
        if (webHiddenRef.current) return;
        const videoEl = webVideoRef.current as any;
        if (!videoEl) return;
        if (((videoEl.videoWidth ?? 0) > 0 || (videoEl.readyState ?? 0) >= 2) && !videoEl.paused) {
          setWebVideoReady((v) => v || 1);
          setWebNeedsTap(false);
          setWebStatus("Camera ready");
          return;
        }
        setWebDiag((prev) => {
          const base = prev?.split(" | ")?.[0] ?? prev;
          const meta = `video:readyState:${String(videoEl.readyState)} w:${String(videoEl.videoWidth ?? 0)} h:${String(videoEl.videoHeight ?? 0)}`;
          return base ? `${base} | ${meta}` : meta;
        });
      } catch {
        // ignore
      }
    }, 700);

    return () => {
      try {
        clearInterval(id);
      } catch {
        // ignore
      }
    };
  }, [visible, webVideoReady, webScanDisabled]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (webScanDisabled) return;
    if (!visible) return;
    if (!webVideoReady) return;

    const videoEl = webVideoRef.current;
    if (!videoEl) return;

    let cancelled = false;

    // Ensure any prior scan loop is stopped before starting a new one
    try {
      if (webScanIntervalRef.current) clearInterval(webScanIntervalRef.current);
    } catch {
      // ignore
    }
    webScanIntervalRef.current = null;

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

          let inFlight = false;
          const id = setInterval(() => {
            if (cancelled) return;
            if (inFlight) return;
            if (busyRef.current) return;
            if (webHiddenRef.current) return;
            if (!webFocusedRef.current) return;

            try {
              if (((videoEl as any).videoWidth ?? 0) === 0) return;
              if (((videoEl as any).readyState ?? 0) < 2) return;
            } catch {
              // ignore
            }

            inFlight = true;
            Promise.resolve()
              .then(() => detector.detect(videoEl))
              .then((barcodes: any) => {
                if (cancelled) return;
                const raw = barcodes?.[0]?.rawValue;
                processScannedValue(String(raw ?? ""));
              })
              .finally(() => {
                inFlight = false;
              });
          }, 250);

          webScanIntervalRef.current = id;
          return;
        }
        if (!webReaderRef.current) {
          webReaderRef.current = new BrowserMultiFormatReader(webHints, { delayBetweenScanAttempts: 150 } as any);
        }
        const reader = webReaderRef.current;

        void reader.decodeFromVideoElement(videoEl, (result: any) => {
          if (cancelled) return;
          if (!result) return;
          if (webHiddenRef.current) return;
          processScannedValue(String(result?.getText?.() ?? ""));
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to scan barcode");
      }
    };

    void run();

    return () => {
      cancelled = true;
      try {
        if (webScanIntervalRef.current) clearInterval(webScanIntervalRef.current);
      } catch {
        // ignore
      }
      webScanIntervalRef.current = null;
      try {
        (webReaderRef.current as any)?.reset?.();
      } catch {
        // ignore
      }
    };
  }, [processScannedValue, visible, webHints, webVideoReady, webScanDisabled]);

  const handleClose = useCallback(() => {
    if (Platform.OS === "web" && !webScanDisabled) stopWebCamera();
    onClose();
  }, [onClose, stopWebCamera, webScanDisabled]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (busy) return;
      processScannedValue(String((result as any)?.data ?? ""));
    },
    [busy, processScannedValue]
  );

  const submitManualValue = useCallback(() => {
    if (!processScannedValue(manualValue)) {
      setError("Enter or scan a barcode value first.");
    }
  }, [manualValue, processScannedValue]);

  const cameraCard = (
    <Card style={{ padding: 0, overflow: "hidden" as any }}>
      <View style={{ width: "100%", aspectRatio: 1, backgroundColor: "#000" }}>
        {isWeb ? (
          <Pressable
            onPress={() => {
              if (!webVideoReady || webNeedsTap) void startWebCamera();
            }}
            style={{ flex: 1, position: "relative" }}
          >
            {React.createElement("video", {
              ref: (node: HTMLVideoElement | null) => {
                webVideoRef.current = node;
              },
              playsInline: true,
              muted: true,
              autoPlay: true,
              onLoadedMetadata: () => {
                setWebVideoReady((v) => v || 1);
                setWebNeedsTap(false);
                setWebStatus("Camera ready");
              },
              onCanPlay: () => {
                setWebVideoReady((v) => v || 1);
                setWebNeedsTap(false);
                setWebStatus("Camera ready");
              },
              onPlaying: () => {
                setWebVideoReady((v) => v || 1);
                setWebNeedsTap(false);
                setWebStatus("Camera ready");
              },
              style: {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: webMirror ? "scaleX(-1)" : "none",
                display: "block",
                opacity: webVideoReady ? 1 : 0.35,
              },
            })}
          </Pressable>
        ) : (
          <CameraView
            style={{ width: "100%", height: "100%" }}
            onBarcodeScanned={canUseCamera ? handleScan : undefined}
            barcodeScannerSettings={{ barcodeTypes }}
          />
        )}
        <ScanFrameOverlay />
      </View>
      <View style={{ padding: theme.spacing.md, gap: 10 }}>
        {last ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Badge label={busy ? "Processing" : "Scanned"} tone={busy ? "warning" : "success"} />
            <MutedText>Value: {last}</MutedText>
          </View>
        ) : null}
        {isWeb ? (
          <TextInput
            ref={manualInputRef}
            value={manualValue}
            onChangeText={(next) => {
              setManualValue(next);
              if (error) setError(null);
            }}
            onSubmitEditing={submitManualValue}
            autoFocus={visible}
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              opacity: 0,
              left: -1000,
              top: -1000,
            }}
          />
        ) : null}
      </View>
    </Card>
  );

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      <AppButton title="Close" onPress={handleClose} variant="secondary" />
    </View>
  );

  const helper = null;

  const errorBox = error ? (
    <View style={{ marginTop: 10 }}>
      <ErrorText>{error}</ErrorText>
    </View>
  ) : null;

  const body = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.md }}>
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={handleClose} />
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
    <Modal visible={visible} transparent animationType={isDesktopWeb ? "fade" : "fade"} onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}>{body}</View>
    </Modal>
  );
}
