import React, { useCallback, useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AuthContext } from "../auth/AuthContext";
import { goBackOrNavigate } from "../navigation/moreBack";
import type { MoreStackParamList } from "../navigation/types";
import { AppButton, Badge, ListRow, MutedText, Screen } from "../ui";

type Props = NativeStackScreenProps<MoreStackParamList, "AdminHub">;

export function AdminHubScreen({ navigation }: Props) {
  const { effectiveRole } = useContext(AuthContext);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const onBack = useCallback(() => {
    goBackOrNavigate(navigation, "MoreMenu");
  }, [navigation]);

  if (effectiveRole !== "admin") {
    return (
      <Screen
        title="Admin"
        center
        right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
      >
        <Badge label="Admin access required" tone="danger" />
        <MutedText style={{ marginTop: 10 }}>This area is restricted to administrators.</MutedText>
      </Screen>
    );
  }

  return (
    <Screen
      title="Admin"
      scroll
      right={!isDesktopWeb ? <AppButton title="Back" onPress={onBack} variant="secondary" iconName="arrow-back" iconOnly /> : undefined}
    >
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
        title="Feedback Management"
        subtitle="Review and manage user feedback"
        onPress={() => navigation.navigate("AdminFeedback")}
      />
    </Screen>
  );
}
