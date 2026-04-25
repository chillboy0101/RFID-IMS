import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "PeopleData">;

export function PeopleDataScreen({ navigation }: Props) {
  return (
    <Screen title="People & Data" scroll>
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
    </Screen>
  );
}
