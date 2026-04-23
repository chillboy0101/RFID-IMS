import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Simple useSearchParams implementation for web
// On native, returns an empty object since there are no URL params
export function useSearchParams(): Record<string, string | undefined> {
  const [params, setParams] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const result: Record<string, string | undefined> = {};
      searchParams.forEach((value, key) => {
        result[key] = value;
      });
      setParams(result);
    }
  }, []); // Run once on mount for initial URL

  return params;
}
