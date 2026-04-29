import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "AdminHub">;

export function AdminHubScreen({ navigation }: Props) {
  return (
    <Screen title="Admin" scroll>
      <ListRow
        title="Gate Keys"
        subtitle="Manage RFID gate API keys for hardware"
        onPress={() => navigation.navigate("GateKeys")}
      />
      <ListRow
        title="Import & Export"
        subtitle="Export inventory, orders, logs; import data"
        onPress={() => navigation.navigate("Integrations")}
      />
      <ListRow
        title="Audit Trail"
        subtitle="Track user, admin, and hardware actions across the branch"
        onPress={() => navigation.navigate("Audit")}
      />
      <ListRow
        title="All Feedback"
        subtitle="Review and manage user feedback"
        onPress={() => navigation.navigate("Feedback")}
      />
    </Screen>
  );
}
