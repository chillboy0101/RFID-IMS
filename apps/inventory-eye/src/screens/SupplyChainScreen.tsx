import React, { useCallback } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, ListRow, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "SupplyChain">;

export function SupplyChainScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "MoreMenu");
  }, [navigation]);

  return (
    <Screen
      title="Supply Chain"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
    >
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
