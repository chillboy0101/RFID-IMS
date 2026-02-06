export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type AppTabsParamList = {
  Dashboard: undefined;
  Inventory: undefined;
  Orders: undefined;
  More: undefined;
  Settings: undefined;
};

export type InventoryStackParamList = {
  InventoryList: undefined;
  InventoryDetail: { id: string };
  InventoryCreate: { scannedBarcode?: string } | undefined;
  InventoryEdit: { id?: string; scannedBarcode?: string };
  InventoryAdjust: { id: string };
  InventoryLogs: { id: string };
  BarcodeScanner: { returnTo: "InventoryEdit" | "InventoryCreate"; id?: string };
};

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { id: string };
  OrderCreate: undefined;
};

export type MoreStackParamList = {
  MoreMenu: undefined;
  Branches: undefined;
  Alerts: undefined;
  Reports: undefined;
  Feedback: undefined;
  AdminFeedback: undefined;
  Progress: undefined;
  Vendors: undefined;
  VendorsCreate: undefined;
  VendorsEdit: { id: string };
  Reorders: undefined;
  ReordersCreate: undefined;
  RfidScanner: undefined;
  BarcodeScanner: undefined;
  Integrations: undefined;
};
