import React, { useContext, useEffect } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import type { MoreStackParamList } from "../navigation/types";
import { ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "MoreMenu">;

export function MoreMenuScreen({ navigation }: Props) {
  const { effectiveRole } = useContext(AuthContext);
  const isAdmin = effectiveRole === "admin";

  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;

  useEffect(() => {
    if (!isWideWeb) return;

    const parent = navigation.getParent();
    parent?.navigate("Dashboard" as never);
  }, [isWideWeb, navigation]);

  return (
    <Screen title="More" scroll>
      <ListRow title="Branches and Users" subtitle="Switch active branch" onPress={() => navigation.navigate("Branches")} />
      <ListRow title="Alerts" subtitle="Low stock, expiring soon, unusual movements" onPress={() => navigation.navigate("Alerts")} />
      <ListRow title="Reports" subtitle="Stock levels and fulfillment" onPress={() => navigation.navigate("Reports")} />
      <ListRow title="Feedback" subtitle="Send feedback and track status" onPress={() => navigation.navigate("Feedback")} />
      <ListRow title="Progress" subtitle="Sessions and performance summary" onPress={() => navigation.navigate("Progress")} />
      <ListRow title="Vendors" subtitle="Create, update, manage suppliers" onPress={() => navigation.navigate("Vendors")} />
      <ListRow title="Reorders" subtitle="Create and manage reorder requests" onPress={() => navigation.navigate("Reorders")} />
      <ListRow title="RFID Scanner" subtitle="Scanner hardware integration and test" onPress={() => navigation.navigate("RfidScanner")} />
      {isAdmin ? <ListRow title="Integrations" subtitle="Export/import data" onPress={() => navigation.navigate("Integrations")} /> : null}
      <ListRow
        title="Settings"
        subtitle="Account and app settings"
        onPress={() => {
          const parent = navigation.getParent();
          (parent as any)?.navigate?.("Settings");
        }}
      />
    </Screen>
  );
}
