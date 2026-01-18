let activeTenantId: string | null = null;

export function setApiTenantId(id: string | null): void {
  activeTenantId = id;
}

export function getApiTenantId(): string | null {
  return activeTenantId;
}
