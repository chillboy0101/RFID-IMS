import React, { useCallback, useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "PeopleData">;

export function PeopleDataScreen({ navigation }: Props) {
  const { effectiveRole } = useContext(AuthContext);
  const canManageUsers = effectiveRole === "admin";
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "MoreMenu");
  }, [navigation]);

  return (
    <Screen
      title="People & Data"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
    >
      <ListRow
        title={canManageUsers ? "Branches & Users" : "Branches"}
        subtitle={canManageUsers ? "Switch active branch and manage team members" : "Switch your active branch"}
        onPress={() => navigation.navigate("Branches")}
      />
      {canManageUsers ? (
        <ListRow
          title="Staff RFID Cards"
          subtitle="Assign, change, or remove staff scan cards"
          onPress={() => navigation.navigate("Branches", { initialTab: "staffCards" })}
        />
      ) : null}
      <ListRow
        title="Feedback"
        subtitle="Send feedback and track its status"
        onPress={() => navigation.navigate("Feedback")}
      />
      <ListRow
        title="Alerts"
        subtitle="Low stock, expiring items, unusual movements"
        onPress={() => navigation.navigate("Alerts")}
      />
      <ListRow
        title="Reports"
        subtitle="Stock levels and order fulfillment"
        onPress={() => navigation.navigate("Reports")}
      />
      <ListRow
        title="Progress"
        subtitle="Sessions and performance summary"
        onPress={() => navigation.navigate("Progress")}
      />
    </Screen>
  );
}
