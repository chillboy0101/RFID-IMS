export function isAuthBypassPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.includes("/reset-password") || normalized.includes("/verify-email") || normalized.includes("/recover-account");
}

export function hasWebAuthBypassToken(): boolean {
  if (typeof window === "undefined") return false;
  return isAuthBypassPath(window.location.pathname);
}
