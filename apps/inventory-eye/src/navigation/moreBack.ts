import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { MoreStackParamList } from "./types";

export function goBackOrNavigate(
  navigation: Pick<NativeStackNavigationProp<MoreStackParamList>, "canGoBack" | "goBack" | "navigate">,
  fallback: keyof MoreStackParamList
) {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }

  navigation.navigate(fallback as never);
}
