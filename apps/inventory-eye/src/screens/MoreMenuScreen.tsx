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
      <ListRow title="RFID Hub" subtitle="Receive, putaway, tag, count, exit scan" onPress={() => navigation.navigate("RfidHub")} />
      <ListRow title="Supply Chain" subtitle="Vendors and reorder requests" onPress={() => navigation.navigate("SupplyChain")} />
      <ListRow title="People & Data" subtitle="Branches, users, alerts, reports, feedback, progress" onPress={() => navigation.navigate("PeopleData")} />
      {isAdmin ? <ListRow title="Admin" subtitle="Gate keys, import/export, all feedback" onPress={() => navigation.navigate("AdminHub")} /> : null}
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
