import React, { useCallback } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "../navigation/types";
import { AppButton, MutedText, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "CycleCount">;

export function CycleCountScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  const onBack = useCallback(() => {
    const state = navigation.getState();
    const first = state.routes?.[0]?.name;
    if (first === "MoreMenu") {
      navigation.popToTop();
      return;
    }
    navigation.navigate("MoreMenu");
  }, [navigation]);

  return (
    <Screen
      title="Cycle Count"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : null}
    >
      <MutedText>Coming soon</MutedText>
    </Screen>
  );
}
