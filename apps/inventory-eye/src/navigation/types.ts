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
  InventoryCreate: undefined;
  InventoryEdit: { id?: string };
  InventoryAdjust: { id: string };
  InventoryLogs: { id: string };
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
