import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform, type ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";

export type AppTheme = {
  colors: {
    bg: string;
    surface: string;
    surface2: string;
    border: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryPressed: string;
    primarySoft: string;
    surfaceGlass: string;
    danger: string;
    dangerPressed: string;
    success: string;
    warning: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  typography: {
    title: { fontSize: number; fontWeight: "800" };
    h2: { fontSize: number; fontWeight: "800" };
    h3: { fontSize: number; fontWeight: "700" };
    body: { fontSize: number; fontWeight: "400" };
    caption: { fontSize: number; fontWeight: "500" };
    label: { fontSize: number; fontWeight: "700" };
  };
};

const base = {
  radius: { sm: 12, md: 18, lg: 24 },
  spacing: { xs: 6, sm: 10, md: 16, lg: 20, xl: 28 },
  typography: {
    title: { fontSize: 28, fontWeight: "800" as const },
    h2: { fontSize: 20, fontWeight: "800" as const },
    h3: { fontSize: 16, fontWeight: "700" as const },
    body: { fontSize: 14, fontWeight: "400" as const },
    caption: { fontSize: 12, fontWeight: "500" as const },
    label: { fontSize: 12, fontWeight: "700" as const },
  },
};

export const lightTheme: AppTheme = {
  ...base,
  colors: {
    bg: "#F8FAFC",
    surface: "#FFFFFF",
    surface2: "#F1F5F9",
    border: "#E2E8F0",
    text: "#0F172A",
    textMuted: "#475569",
    primary: "#0F172A",
    primaryPressed: "#0B1220",
    primarySoft: "rgba(15, 23, 42, 0.12)",
    surfaceGlass: "rgba(255, 255, 255, 0.9)",
    danger: "#DC2626",
    dangerPressed: "#B91C1C",
    success: "#16A34A",
    warning: "#D97706",
  },
};

export const darkTheme: AppTheme = {
  ...base,
  colors: {
    bg: "#0B0F17",
    surface: "#111827",
    surface2: "#0F172A",
    border: "#243244",
    text: "#F8FAFC",
    textMuted: "#94A3B8",
    primary: "#E2E8F0",
    primaryPressed: "#CBD5E1",
    primarySoft: "rgba(226, 232, 240, 0.18)",
    surfaceGlass: "rgba(17, 24, 39, 0.86)",
    danger: "#EF4444",
    dangerPressed: "#DC2626",
    success: "#16A34A",
    warning: "#F59E0B",
  },
};

export let theme: AppTheme = lightTheme;

const ThemeContext = createContext<AppTheme>(lightTheme);

export type ThemeMode = "system" | "light" | "dark";

const THEME_MODE_KEY = "inventory_eye_theme_mode";

type ThemeModeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  resolved: "light" | "dark";
};

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: async () => undefined,
});

async function getStoredThemeMode(): Promise<ThemeMode> {
  if (Platform.OS === "web") {
    try {
      const raw = window.localStorage.getItem(THEME_MODE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
      return "system";
    } catch {
      return "system";
    }
  }

  try {
    const raw = await SecureStore.getItemAsync(THEME_MODE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "system";
  } catch {
    return "system";
  }
}

async function setStoredThemeMode(mode: ThemeMode): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(THEME_MODE_KEY, mode);
    } catch {
    }
    return;
  }

  try {
    await SecureStore.setItemAsync(THEME_MODE_KEY, mode);
  } catch {
  }
}

function useSafeColorScheme(): ColorSchemeName {
  const [scheme, setScheme] = useState<ColorSchemeName>(() => {
    try {
      return Appearance.getColorScheme();
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    try {
      const sub = Appearance.addChangeListener(({ colorScheme }) => {
        setScheme(colorScheme);
      });

      return () => {
        try {
          sub.remove();
        } catch {
          // no-op
        }
      };
    } catch {
      return;
    }
  }, []);

  return scheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useSafeColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getStoredThemeMode();
      if (cancelled) return;
      setModeState(stored);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved: "light" | "dark" = useMemo(() => {
    if (mode === "light" || mode === "dark") return mode;
    return scheme === "dark" ? "dark" : "light";
  }, [mode, scheme]);

  const value = useMemo(() => (resolved === "dark" ? darkTheme : lightTheme), [resolved]);
  theme = value;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      document.documentElement.setAttribute("data-theme", resolved);
    } catch {
    }
  }, [resolved]);

  const ctx = useMemo<ThemeModeContextValue>(
    () => ({
      mode: loaded ? mode : "system",
      resolved,
      setMode: async (nextMode: ThemeMode) => {
        setModeState(nextMode);
        if (Platform.OS === "web") {
          try {
            const nextResolved = nextMode === "light" || nextMode === "dark" ? nextMode : scheme === "dark" ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", nextResolved);
          } catch {
          }
        }
        await setStoredThemeMode(nextMode);
      },
    }),
    [loaded, mode, resolved, scheme]
  );

  return React.createElement(
    ThemeModeContext.Provider,
    { value: ctx },
    React.createElement(ThemeContext.Provider, { value }, children)
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export function shadow(level: 1 | 2 = 1) {
  if (Platform.OS === "android") {
    return { elevation: level === 1 ? 3 : 10 };
  }

  if (Platform.OS === "web") {
    const alpha = level === 1 ? 0.14 : 0.24;
    const blur = level === 1 ? 12 : 22;
    const y = level === 1 ? 8 : 14;
    return { boxShadow: `0px ${y}px ${blur}px rgba(0, 0, 0, ${alpha})` } as any;
  }

  return {
    shadowColor: "#000",
    shadowOpacity: level === 1 ? 0.14 : 0.24,
    shadowRadius: level === 1 ? 12 : 22,
    shadowOffset: { width: 0, height: level === 1 ? 8 : 14 },
  };
}
