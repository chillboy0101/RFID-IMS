import React, { useContext, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AuthContext } from "../auth/AuthContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { InventoryListScreen } from "../screens/InventoryListScreen";
import { OrdersListScreen } from "../screens/OrdersListScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { InventoryDetailScreen } from "../screens/InventoryDetailScreen";
import { InventoryEditScreen } from "../screens/InventoryEditScreen";
import { InventoryAdjustScreen } from "../screens/InventoryAdjustScreen";
import { InventoryLogsScreen } from "../screens/InventoryLogsScreen";
import { OrderDetailScreen } from "../screens/OrderDetailScreen";
import { OrderCreateScreen } from "../screens/OrderCreateScreen";
import { MoreMenuScreen } from "../screens/MoreMenuScreen";
import { BranchSelectGateScreen } from "../screens/BranchSelectGateScreen";
import { AlertsScreen } from "../screens/AlertsScreen";
import { ReportsScreen } from "../screens/ReportsScreen";
import { FeedbackScreen } from "../screens/FeedbackScreen";
import { AdminFeedbackScreen } from "../screens/AdminFeedbackScreen";
import { AdminBranchesScreen } from "../screens/AdminBranchesScreen";
import { ForcePasswordChangeScreen } from "../screens/ForcePasswordChangeScreen";
import { ProgressScreen } from "../screens/ProgressScreen";
import { VendorsScreen } from "../screens/VendorsScreen";
import { VendorsCreateScreen } from "../screens/VendorsCreateScreen";
import { VendorsEditScreen } from "../screens/VendorsEditScreen";
import { ReordersScreen } from "../screens/ReordersScreen";
import { ReorderCreateScreen } from "../screens/ReorderCreateScreen";
import { IntegrationsScreen } from "../screens/IntegrationsScreen";
import { RfidScannerScreen } from "../screens/RfidScannerScreen";

import { AppButton, Badge, FullScreenLoader, shadow, theme, useTheme } from "../ui";

import {
  AppTabsParamList,
  AuthStackParamList,
  InventoryStackParamList,
  MoreStackParamList,
  OrdersStackParamList,
} from "./types";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator<AppTabsParamList>();
const InventoryStack = createNativeStackNavigator<InventoryStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

function EnterpriseTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;
  const mobileBottom = Math.max(0, insets.bottom - theme.spacing.lg);
  const isCompactSidebar = isWideWeb && height < 820;
  const { signOut, effectiveRole, tenants, activeTenantId } = useContext(AuthContext);
  const isAdmin = effectiveRole === "admin";
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const activeTenantName = tenants.find((t) => t.id === activeTenantId)?.name ?? null;

  const activeTab = state.routes[state.index];
  const nestedState = (activeTab as any)?.state;
  const nestedIndex = typeof nestedState?.index === "number" ? nestedState.index : 0;
  const nestedName = nestedState?.routes?.[nestedIndex]?.name as string | undefined;

  const moreActiveKey = (() => {
    if (!nestedName) return "More";
    if (nestedName === "AdminFeedback") return "More/Feedback";
    if (nestedName === "VendorsCreate" || nestedName === "VendorsEdit") return "More/Vendors";
    if (nestedName === "ReordersCreate") return "More/Reorders";
    return `More/${nestedName}`;
  })();

  const activeKey = activeTab?.name === "More" ? moreActiveKey : activeTab?.name;

  const sidebarLinks = [
    { title: "Dashboard", icon: "speedometer-outline", match: "Dashboard", onPress: () => (navigation as any).navigate("Dashboard") },
    { title: "Inventory", icon: "cube-outline", match: "Inventory", onPress: () => (navigation as any).navigate("Inventory") },
    { title: "Orders", icon: "receipt-outline", match: "Orders", onPress: () => (navigation as any).navigate("Orders") },
    { title: "Branches and Users", icon: "business-outline", match: "More/Branches", onPress: () => (navigation as any).navigate("More", { screen: "Branches" }) },
    { title: "Alerts", icon: "alert-circle-outline", match: "More/Alerts", onPress: () => (navigation as any).navigate("More", { screen: "Alerts" }) },
    { title: "Reports", icon: "bar-chart-outline", match: "More/Reports", onPress: () => (navigation as any).navigate("More", { screen: "Reports" }) },
    { title: "Feedback", icon: "chatbox-ellipses-outline", match: "More/Feedback", onPress: () => (navigation as any).navigate("More", { screen: "Feedback" }) },
    { title: "Progress", icon: "analytics-outline", match: "More/Progress", onPress: () => (navigation as any).navigate("More", { screen: "Progress" }) },
    { title: "Vendors", icon: "people-outline", match: "More/Vendors", onPress: () => (navigation as any).navigate("More", { screen: "Vendors" }) },
    { title: "Reorders", icon: "repeat-outline", match: "More/Reorders", onPress: () => (navigation as any).navigate("More", { screen: "Reorders" }) },
    { title: "RFID Scanner", icon: "radio-outline", match: "More/RfidScanner", onPress: () => (navigation as any).navigate("More", { screen: "RfidScanner" }) },
    ...(isAdmin
      ? ([
          {
            title: "Import & Export",
            icon: "swap-horizontal-outline",
            match: "More/Integrations",
            onPress: () => (navigation as any).navigate("More", { screen: "Integrations" }),
          },
        ] as const)
      : []),
    { title: "Settings", icon: "settings-outline", match: "Settings", onPress: () => (navigation as any).navigate("Settings") },
  ] as const;

  return (
    <View
      style={{
        pointerEvents: "box-none",
        position: "absolute",
        left: theme.spacing.md,
        right: isWideWeb ? undefined : theme.spacing.md,
        top: isWideWeb ? theme.spacing.lg : undefined,
        bottom: isWideWeb ? theme.spacing.lg : mobileBottom,
        width: isWideWeb ? 240 : undefined,
      }}
    >
      <View
        style={[
          {
            backgroundColor: theme.colors.surfaceGlass,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.colors.border,
            flexDirection: isWideWeb ? "column" : "row",
            justifyContent: isWideWeb ? "flex-start" : "space-between",
            paddingHorizontal: isWideWeb ? 10 : 8,
            paddingVertical: isWideWeb ? 10 : 8,
            gap: isWideWeb ? 6 : 0,
            ...(isWideWeb ? ({ maxHeight: "100%" } as any) : null),
          },
          shadow(2),
        ]}
      >
        {!isWideWeb ? (
          <Modal transparent visible={quickCreateOpen} animationType="fade" onRequestClose={() => setQuickCreateOpen(false)}>
            <Pressable style={{ flex: 1 }} onPress={() => setQuickCreateOpen(false)}>
              <View style={{ flex: 1 }} />
            </Pressable>
            <View
              style={{
                pointerEvents: "box-none",
                position: "absolute",
                left: theme.spacing.md,
                right: theme.spacing.md,
                bottom: mobileBottom + 84,
              }}
            >
              <View
                style={[
                  {
                    backgroundColor: theme.colors.surfaceGlass,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: 10,
                    flexDirection: "row",
                    gap: 10,
                  },
                  shadow(2),
                ]}
              >
                <Pressable
                  onPress={() => {
                    setQuickCreateOpen(false);
                    (navigation as any).navigate("Inventory", { screen: "InventoryCreate" });
                  }}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "800" }}>New item</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setQuickCreateOpen(false);
                    (navigation as any).navigate("Orders", { screen: "OrderCreate" });
                  }}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "800" }}>New order</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {isWideWeb && !isCompactSidebar ? (
          <View style={{ paddingHorizontal: 6, paddingVertical: 6, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 13 }}>Navigation</Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                  {activeTenantName ? `Active branch: ${activeTenantName}` : "Inventory Eye"}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {isWideWeb ? (
          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 6, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ flexGrow: 1, gap: isCompactSidebar ? 10 : 12 }}>
              <View style={{ flexGrow: 1, gap: isCompactSidebar ? 2 : 4 }}>
                {sidebarLinks.map((l) => (
                  (() => {
                    const isActive = activeKey === l.match;
                    const itemBg = isActive ? "#0B0F17" : "transparent";
                    const itemBorder = isActive ? "#0B0F17" : "transparent";
                    const iconColor = isActive ? "#fff" : theme.colors.textMuted;
                    const textColor = isActive ? "#fff" : theme.colors.text;

                    return (
                  <Pressable
                    key={l.title}
                    onPress={l.onPress}
                    style={(state) => {
                      const pressed = state.pressed;
                      const hovered = !!(state as any).hovered;
                      return [
                        {
                          width: "100%",
                          paddingVertical: isCompactSidebar ? 8 : 10,
                          paddingHorizontal: isCompactSidebar ? 10 : 12,
                          borderRadius: 14,
                          backgroundColor: pressed ? (isActive ? "#111827" : theme.colors.surface2) : hovered ? (isActive ? "#111827" : theme.colors.surface2) : itemBg,
                          borderWidth: isActive ? 1 : 0,
                          borderColor: itemBorder,
                          opacity: pressed ? 0.95 : 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: isCompactSidebar ? 8 : 10,
                          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                        },
                        hovered && !pressed ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
                      ];
                    }}
                  >
                    <Ionicons name={l.icon as any} size={isCompactSidebar ? 18 : 20} color={iconColor} />
                    <Text
                      style={{ color: textColor, fontWeight: isActive ? "800" : "700", fontSize: isCompactSidebar ? 12 : 13 }}
                      numberOfLines={1}
                    >
                      {l.title}
                    </Text>
                  </Pressable>
                    );
                  })()
                ))}
              </View>

              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: isCompactSidebar ? 8 : 10,
                  gap: isCompactSidebar ? 6 : 8,
                }}
              >
                <Pressable
                  onPress={() => (navigation as any).navigate("Inventory", { screen: "InventoryCreate" })}
                  style={({ pressed }) => [
                    {
                      width: "100%",
                      paddingVertical: isCompactSidebar ? 10 : 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 13 }}>New item</Text>
                </Pressable>
                <Pressable
                  onPress={() => (navigation as any).navigate("Orders", { screen: "OrderCreate" })}
                  style={({ pressed }) => [
                    {
                      width: "100%",
                      paddingVertical: isCompactSidebar ? 10 : 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 13 }}>New order</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        ) : (
          (() => {
            const activeName = state.routes[state.index]?.name;
            const visibleRoutes = state.routes.filter((r) => r.name !== "Settings");

            return visibleRoutes.map((route) => {
              const { options } = descriptors[route.key];
              const label =
                typeof options.tabBarLabel === "string"
                  ? options.tabBarLabel
                  : typeof options.title === "string"
                    ? options.title
                    : route.name;

              const isFocused = activeName === route.name || (activeName === "Settings" && route.name === "More");
              const iconColor = isFocused ? theme.colors.primary : theme.colors.textMuted;
              const labelColor = isFocused ? theme.colors.text : theme.colors.textMuted;

              const onPress = () => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });

                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name as never);
                }
              };

              const onLongPress = () => {
                navigation.emit({
                  type: "tabLongPress",
                  target: route.key,
                });
              };

              const tabButton = (
                <Pressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={isFocused ? { selected: true } : {}}
                  accessibilityLabel={options.tabBarAccessibilityLabel}
                  testID={options.tabBarTestID}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 8,
                      borderRadius: 18,
                      backgroundColor: isFocused ? theme.colors.primarySoft : "transparent",
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={{ alignItems: "center", gap: 6 }}>
                    {options.tabBarIcon ? options.tabBarIcon({ focused: isFocused, color: iconColor, size: 22 }) : null}
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: isFocused ? theme.colors.primary : "transparent",
                        marginTop: -2,
                      }}
                    />
                    <Text
                      style={{
                        color: labelColor,
                        fontWeight: "700",
                        fontSize: 12,
                        lineHeight: 14,
                      }}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </View>
                </Pressable>
              );

              if (route.name === "Inventory") {
                return (
                  <React.Fragment key={`${route.key}-wrap`}>
                    {tabButton}
                    <Pressable
                      key="quick-create"
                      accessibilityRole="button"
                      accessibilityLabel="Quick create"
                      onPress={() => setQuickCreateOpen((v) => !v)}
                      style={({ pressed }) => [
                        {
                          flex: 1,
                          alignItems: "center",
                          justifyContent: "center",
                          paddingVertical: 8,
                          borderRadius: 18,
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <View
                        style={[
                          {
                            width: 46,
                            height: 46,
                            borderRadius: 16,
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            alignItems: "center",
                            justifyContent: "center",
                          },
                          shadow(1),
                        ]}
                      >
                        <Ionicons name="add" size={26} color={theme.colors.text} />
                      </View>
                    </Pressable>
                  </React.Fragment>
                );
              }

              return tabButton;
            });
          })()
        )}

        {isWideWeb ? null : null}
      </View>
    </View>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} options={{ title: "Login" }} />
      <AuthStack.Screen name="Register" component={RegisterScreen} options={{ title: "Register" }} />
    </AuthStack.Navigator>
  );
}

function InventoryNavigator() {
  return (
    <InventoryStack.Navigator screenOptions={{ headerShown: false }}>
      <InventoryStack.Screen name="InventoryList" component={InventoryListScreen} />
      <InventoryStack.Screen name="InventoryDetail" component={InventoryDetailScreen} />
      <InventoryStack.Screen name="InventoryCreate" component={InventoryEditScreen} />
      <InventoryStack.Screen name="InventoryEdit" component={InventoryEditScreen} />
      <InventoryStack.Screen name="InventoryAdjust" component={InventoryAdjustScreen} />
      <InventoryStack.Screen name="InventoryLogs" component={InventoryLogsScreen} />
    </InventoryStack.Navigator>
  );
}

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator screenOptions={{ headerShown: false }}>
      <OrdersStack.Screen name="OrdersList" component={OrdersListScreen} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <OrdersStack.Screen name="OrderCreate" component={OrderCreateScreen} />
    </OrdersStack.Navigator>
  );
}

function MoreNavigator() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false }}>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} />
      <MoreStack.Screen name="Branches" component={AdminBranchesScreen} />
      <MoreStack.Screen name="Alerts" component={AlertsScreen} />
      <MoreStack.Screen name="Reports" component={ReportsScreen} />
      <MoreStack.Screen name="Feedback" component={FeedbackScreen} />
      <MoreStack.Screen name="AdminFeedback" component={AdminFeedbackScreen} />
      <MoreStack.Screen name="Progress" component={ProgressScreen} />
      <MoreStack.Screen name="Vendors" component={VendorsScreen} />
      <MoreStack.Screen name="VendorsCreate" component={VendorsCreateScreen} />
      <MoreStack.Screen name="VendorsEdit" component={VendorsEditScreen} />
      <MoreStack.Screen name="Reorders" component={ReordersScreen} />
      <MoreStack.Screen name="ReordersCreate" component={ReorderCreateScreen} />
      <MoreStack.Screen name="RfidScanner" component={RfidScannerScreen} />
      <MoreStack.Screen name="Integrations" component={IntegrationsScreen} />
    </MoreStack.Navigator>
  );
}

function AppTabs() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <EnterpriseTabBar {...props} />}
      sceneContainerStyle={{
        backgroundColor: theme.colors.bg,
      }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 12, marginBottom: 2 },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarStyle: {
          display: "none",
        },
      }}
    >
      <Tabs.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="speedometer-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Inventory"
        component={InventoryNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Orders"
        component={OrdersNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="More"
        component={MoreNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}

export function AppNavigator() {
  const { loading, token, user, tenants, tenantsLoaded, tenantChosenThisSession, activeTenantId } = useContext(AuthContext);

  if (loading) {
    return <FullScreenLoader />;
  }

  const linking = {
    prefixes:
      Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin
        ? [window.location.origin]
        : [],
    config: {
      screens: {
        Dashboard: "",
        Inventory: {
          screens: {
            InventoryList: "inventory",
            InventoryDetail: "inventory/:id",
            InventoryCreate: "inventory/new",
            InventoryEdit: "inventory/:id/edit",
            InventoryAdjust: "inventory/:id/adjust",
            InventoryLogs: "inventory/:id/logs",
          },
        },
        Orders: {
          screens: {
            OrdersList: "orders",
            OrderDetail: "orders/:id",
            OrderCreate: "orders/new",
          },
        },
        More: {
          screens: {
            MoreMenu: "more",
            Branches: "more/branches",
            Alerts: "more/alerts",
            Reports: "more/reports",
            Feedback: "more/feedback",
            AdminFeedback: "more/feedback/admin",
            Progress: "more/progress",
            Vendors: "more/vendors",
            VendorsCreate: "more/vendors/new",
            VendorsEdit: "more/vendors/:id",
            Reorders: "more/reorders",
            ReordersCreate: "more/reorders/new",
            RfidScanner: "more/rfid",
            Integrations: "more/integrations",
          },
        },
        Settings: "settings",
      },
    },
  } as const;

  const needsTenantSelection =
    Boolean(token) &&
    tenantsLoaded &&
    (tenants.length === 0 || !activeTenantId);

  const mustChangePassword = Boolean(token && user?.mustChangePassword);

  return (
    <NavigationContainer linking={Platform.OS === "web" ? (linking as any) : undefined}>
      {token ? (
        mustChangePassword ? (
          <ForcePasswordChangeScreen />
        ) : !tenantsLoaded ? (
          <FullScreenLoader />
        ) : needsTenantSelection ? (
          <BranchSelectGateScreen />
        ) : (
          <AppTabs />
        )
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
