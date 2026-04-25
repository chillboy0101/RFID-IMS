import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "SupplyChain">;

export function SupplyChainScreen({ navigation }: Props) {
  return (
    <Screen title="Supply Chain" scroll>
      <ListRow
        title="Vendors"
        subtitle="Manage suppliers and contacts"
        onPress={() => navigation.navigate("Vendors")}
      />
      <ListRow
        title="Reorders"
        subtitle="Create and track replenishment requests"
        onPress={() => navigation.navigate("Reorders")}
      />
    </Screen>
  );
}
