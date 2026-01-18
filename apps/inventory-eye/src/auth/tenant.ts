import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "inventory_eye_active_tenant";

export async function getActiveTenantId(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  return SecureStore.getItemAsync(KEY);
}

export async function setActiveTenantId(id: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
    }
    return;
  }

  await SecureStore.setItemAsync(KEY, id);
}

export async function clearActiveTenantId(): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
    }
    return;
  }

  await SecureStore.deleteItemAsync(KEY);
}
