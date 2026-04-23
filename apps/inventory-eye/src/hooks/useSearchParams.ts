import { useMemo } from "react";
import { Platform } from "react-native";

// Simple useSearchParams implementation for web
// On native, returns an empty object since there are no URL params
export function useSearchParams(): Record<string, string | undefined> {
  return useMemo(() => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return {};
      const searchParams = new URLSearchParams(window.location.search);
      const params: Record<string, string | undefined> = {};
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
      return params;
    }
    return {};
  }, []);
}
