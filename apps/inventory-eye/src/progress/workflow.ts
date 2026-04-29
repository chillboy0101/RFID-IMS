export type TaskSessionKind = "inventory_update" | "order_fulfillment" | "other";

export type ProgressWorkflow = {
  kind: TaskSessionKind;
  routeLabel: string;
  routeName: string;
};

export const taskSessionKindLabels: Record<TaskSessionKind, string> = {
  inventory_update: "Inventory updates",
  order_fulfillment: "Order fulfillment",
  other: "Other",
};

const routeWorkflowMap: Record<string, Omit<ProgressWorkflow, "routeName">> = {
  Dashboard: { kind: "other", routeLabel: "Dashboard" },
  InventoryList: { kind: "inventory_update", routeLabel: "Inventory" },
  InventoryDetail: { kind: "inventory_update", routeLabel: "Inventory detail" },
  InventoryCreate: { kind: "inventory_update", routeLabel: "New item" },
  InventoryEdit: { kind: "inventory_update", routeLabel: "Edit item" },
  InventoryAdjust: { kind: "inventory_update", routeLabel: "Adjust stock" },
  InventoryLogs: { kind: "inventory_update", routeLabel: "Inventory logs" },
  OrdersList: { kind: "order_fulfillment", routeLabel: "Orders" },
  OrderDetail: { kind: "order_fulfillment", routeLabel: "Order detail" },
  OrderCreate: { kind: "order_fulfillment", routeLabel: "New order" },
  Receiving: { kind: "inventory_update", routeLabel: "Receiving" },
  Putaway: { kind: "inventory_update", routeLabel: "Putaway" },
  CycleCount: { kind: "inventory_update", routeLabel: "Cycle count" },
  Alerts: { kind: "other", routeLabel: "Alerts" },
  Reports: { kind: "other", routeLabel: "Reports" },
  Feedback: { kind: "other", routeLabel: "Feedback" },
  AdminFeedback: { kind: "other", routeLabel: "Admin feedback" },
  Branches: { kind: "other", routeLabel: "Branches and users" },
  Progress: { kind: "other", routeLabel: "Progress" },
  Vendors: { kind: "other", routeLabel: "Vendors" },
  VendorsCreate: { kind: "other", routeLabel: "New vendor" },
  VendorsEdit: { kind: "other", routeLabel: "Edit vendor" },
  Reorders: { kind: "other", routeLabel: "Reorders" },
  ReordersCreate: { kind: "other", routeLabel: "New reorder" },
  Integrations: { kind: "other", routeLabel: "Integrations" },
  RfidScanner: { kind: "order_fulfillment", routeLabel: "RFID scanner" },
  RfidHub: { kind: "order_fulfillment", routeLabel: "RFID hub" },
  SupplyChain: { kind: "other", routeLabel: "Supply chain" },
  PeopleData: { kind: "other", routeLabel: "People and data" },
  AdminHub: { kind: "other", routeLabel: "Admin" },
  GateKeys: { kind: "order_fulfillment", routeLabel: "Gate keys" },
  Audit: { kind: "other", routeLabel: "Audit trail" },
  MoreMenu: { kind: "other", routeLabel: "More" },
  Settings: { kind: "other", routeLabel: "Settings" },
};

function humanizeRouteName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inferProgressWorkflow(routeName: string | null): ProgressWorkflow | null {
  if (!routeName) return null;

  const mapped = routeWorkflowMap[routeName];
  if (mapped) {
    return { routeName, ...mapped };
  }

  return {
    routeName,
    kind: "other",
    routeLabel: humanizeRouteName(routeName),
  };
}

export function formatTaskSessionRoute(meta?: Record<string, unknown> | null): string | null {
  if (!meta || typeof meta !== "object") return null;

  const routeLabel = meta.routeLabel;
  if (typeof routeLabel === "string" && routeLabel.trim()) {
    return routeLabel.trim();
  }

  const routeName = meta.routeName;
  if (typeof routeName === "string" && routeName.trim()) {
    return humanizeRouteName(routeName.trim());
  }

  return null;
}
