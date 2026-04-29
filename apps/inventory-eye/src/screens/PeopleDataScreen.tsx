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
  const isAdmin = effectiveRole === "admin";
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
        title="Branches & Users"
        subtitle="Switch active branch and manage team members"
        onPress={() => navigation.navigate("Branches")}
      />
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
      {isAdmin ? (
        <ListRow
          title="Audit Trail"
          subtitle="Track who changed what, when, and from where"
          onPress={() => navigation.navigate("Audit")}
        />
      ) : null}
    </Screen>
  );
}
