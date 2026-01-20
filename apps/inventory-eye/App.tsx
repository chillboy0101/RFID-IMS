import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { Analytics } from "@vercel/analytics/react";

import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "./src/auth/AuthContext";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { ThemeProvider } from "./src/ui";

export default function App() {
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const originalWarn = console.warn;
    const originalError = console.error;

    const shouldSuppress = (args: unknown[]) => {
      const first = args[0];
      if (typeof first !== "string") return false;
      const msg = first.toLowerCase();
      return msg.includes("pointerevents") && msg.includes("deprecated");
    };

    console.warn = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      originalWarn(...args);
    };

    console.error = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      originalError(...args);
    };

    const style = document.createElement("style");
    style.setAttribute("data-inventory-eye", "scrollbar");
    style.innerHTML = `
      html, body { background: #F8FAFC; }
      body { scrollbar-color: #CBD5E1 rgba(241, 245, 249, 0.9); scrollbar-width: thin; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: rgba(241, 245, 249, 0.9); }
      ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 999px; border: 2px solid rgba(241, 245, 249, 0.9); }
      ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }

      html[data-theme='dark'], html[data-theme='dark'] body { background: #0B0F17; }
      html[data-theme='dark'] body { scrollbar-color: #243244 rgba(11, 15, 23, 0.65); }
      html[data-theme='dark'] ::-webkit-scrollbar-track { background: rgba(11, 15, 23, 0.65); }
      html[data-theme='dark'] ::-webkit-scrollbar-thumb { background: #243244; border: 2px solid rgba(11, 15, 23, 0.65); }
      html[data-theme='dark'] ::-webkit-scrollbar-thumb:hover { background: #33465F; }
    `;
    document.head.appendChild(style);

    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      style.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const anyGlobal = global as any;
    const ErrorUtils = anyGlobal?.ErrorUtils;
    if (!ErrorUtils?.setGlobalHandler) return;

    const previous = ErrorUtils.getGlobalHandler?.();
    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        console.error("[GlobalErrorHandler]", isFatal ? "FATAL" : "NON_FATAL", error?.message ?? error, error?.stack);
      } catch {
      }

      if (typeof previous === "function") {
        previous(error, isFatal);
      }
    });
  }, []);

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <AppNavigator />
          {Platform.OS === "web" ? <Analytics /> : null}
          <StatusBar style="auto" />
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
