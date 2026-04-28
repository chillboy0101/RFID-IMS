export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyEmail: { token?: string } | undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string };
  RecoverAccount: { token?: string } | undefined;
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
  Receiving: undefined;
  Putaway: undefined;
  CycleCount: undefined;
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
  SupplyChain: undefined;
  PeopleData: undefined;
  AdminHub: undefined;
  RfidHub: undefined;
  RfidScanner: undefined;
  GateKeys: undefined;
  Integrations: undefined;
};
