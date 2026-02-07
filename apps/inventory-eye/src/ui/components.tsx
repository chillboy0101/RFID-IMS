import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type RefreshControlProps,
  type TextStyle,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { shadow, theme, useTheme } from "./theme";

export const GLOBAL_AUTO_REFRESH_MS = 45_000;
export const AUTO_REFRESH_PAUSE_MS = 1_500;

let textFieldIdCounter = 0;

function nextTextFieldNativeId() {
  textFieldIdCounter += 1;
  return `textfield-${textFieldIdCounter}`;
}

type ScreenProps = {
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
  right?: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  busy?: boolean;
  center?: boolean;
  tabBarPadding?: boolean;
  sidebarInset?: boolean;
};

export function Screen({ title, children, scroll, right, refreshControl, busy, center, tabBarPadding = true, sidebarInset = true }: ScreenProps) {
  useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === "web" && width >= 900;
  const sidebarWidth = 240;
  const sidebarInsetWidth = sidebarWidth + theme.spacing.md * 2;

  const floatingTabBarPadding = tabBarPadding ? (isWideWeb ? theme.spacing.lg : 112) : 0;
  const bottomPad = center ? theme.spacing.md : theme.spacing.lg + insets.bottom + floatingTabBarPadding;
  const topPad = center ? theme.spacing.md : undefined;

  const webMaxWidth = isWideWeb ? 1240 : 980;
  const webContainerStyle = Platform.OS === "web" ? ({ width: "100%", maxWidth: webMaxWidth, alignSelf: "center" } as const) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={[{ flex: 1, position: "relative" }, isWideWeb && sidebarInset ? { paddingLeft: sidebarInsetWidth } : null]}>
        {title ? (
          <View
            style={[
              {
                paddingHorizontal: theme.spacing.md,
                paddingTop: theme.spacing.md,
                paddingBottom: theme.spacing.sm,
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              },
              webContainerStyle,
            ]}
          >
            <Text style={[theme.typography.title, { color: theme.colors.text }]}>{title}</Text>
            {right ? <View style={{ marginLeft: theme.spacing.sm }}>{right}</View> : null}
          </View>
        ) : null}

        {scroll ? (
          <ScrollView
            style={[{ flex: 1 }, webContainerStyle]}
            contentContainerStyle={{
              padding: theme.spacing.md,
              paddingTop: title ? theme.spacing.sm : topPad ?? theme.spacing.md,
              paddingBottom: bottomPad,
              gap: theme.spacing.md,
              ...(center
                ? ({ flexGrow: 1, alignItems: "center", justifyContent: "center" } as const)
                : null),
            }}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              {
                flex: 1,
                padding: theme.spacing.md,
                paddingTop: title ? theme.spacing.sm : topPad ?? theme.spacing.md,
                paddingBottom: bottomPad,
                gap: theme.spacing.md,
                ...(center ? ({ alignItems: "center", justifyContent: "center" } as const) : null),
              },
              webContainerStyle,
            ]}
          >
            {children}
          </View>
        )}

        {busy ? (
          <View
            style={{
              pointerEvents: "none",
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View style={[{ flex: 1, width: "100%" }, webContainerStyle]}>
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceGlass,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: 16,
                    borderRadius: theme.radius.lg,
                  }}
                >
                  <ActivityIndicator
                    color={theme.colors.text}
                    size="large"
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel="Loading"
                    style={{ transform: [{ scale: 1.25 }] }}
                  />
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export function FullScreenLoader() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg }}>
      <ActivityIndicator
        size="large"
        color={theme.colors.text}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
        style={{ transform: [{ scale: 1.5 }] }}
      />
    </View>
  );
}

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

export function Card({ children, style }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          overflow: "hidden",
        },
        shadow(1),
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function MutedText({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[theme.typography.body, { color: theme.colors.textMuted }, style]}>{children}</Text>;
}

export function ErrorText({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[theme.typography.body, { color: theme.colors.danger }, style]}>{children}</Text>;
}

type ButtonVariant = "primary" | "secondary" | "danger";

type AppButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  iconName?: React.ComponentProps<typeof Ionicons>["name"];
  iconOnly?: boolean;
  iconSize?: number;
};

export function AppButton({ title, onPress, disabled, loading, variant = "primary", iconName, iconOnly, iconSize }: AppButtonProps) {
  const bg = useMemo(() => {
    if (variant === "danger") return theme.colors.danger;
    if (variant === "secondary") return theme.colors.surface2;
    return "#0B0F17";
  }, [variant]);

  const bgPressed = useMemo(() => {
    if (variant === "danger") return theme.colors.dangerPressed;
    if (variant === "secondary") return theme.colors.surface;
    return "#111827";
  }, [variant]);

  const bgHover = useMemo(() => {
    if (variant === "danger") return theme.colors.dangerPressed;
    if (variant === "secondary") return theme.colors.surface;
    return "#111827";
  }, [variant]);

  const textColor = useMemo(() => {
    if (variant === "secondary") return theme.colors.text;
    return "#fff";
  }, [variant]);

  const isIconOnly = !!iconOnly;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={title}
      style={(state) => {
        const pressed = state.pressed;
        const hovered = !!(state as any).hovered;
        return [
          {
            backgroundColor: pressed ? bgPressed : hovered ? bgHover : bg,
            opacity: disabled || loading ? 0.55 : 1,
            paddingVertical: 13,
            paddingHorizontal: isIconOnly ? 12 : 14,
            minHeight: 46,
            minWidth: isIconOnly ? 46 : undefined,
            borderRadius: theme.radius.sm,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 10,
            borderWidth: variant === "secondary" ? 1 : 0,
            borderColor: variant === "secondary" ? theme.colors.border : "transparent",
            ...(Platform.OS === "web" ? ({ cursor: disabled || loading ? "default" : "pointer" } as any) : null),
          },
          hovered && !pressed && !(disabled || loading) ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
          pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
          variant === "secondary" ? null : shadow(1),
        ];
      }}
    >
      {loading ? (
        <ActivityIndicator
          color={textColor}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${title} loading`}
        />
      ) : null}
      {!loading && iconName ? <Ionicons name={iconName} size={iconSize ?? 20} color={textColor} /> : null}
      {isIconOnly ? null : <Text style={{ color: textColor, fontWeight: "800" }}>{title}</Text>}
    </Pressable>
  );
}

type TextFieldProps = {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  helperText?: string;
  errorText?: string;
  containerStyle?: ViewStyle;
} & Omit<TextInputProps, "value" | "onChangeText">;

export const TextField = React.forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, value, onChangeText, helperText, errorText, containerStyle, nativeID, ...props },
  ref
) {
  const textColor = theme.colors.text;
  const [focused, setFocused] = useState(false);

  const autoNativeId = useMemo(() => (Platform.OS === "web" ? nextTextFieldNativeId() : undefined), []);
  const resolvedNativeId = nativeID ?? autoNativeId;
  const labelNativeId = useMemo(() => {
    if (!label || !resolvedNativeId) return undefined;
    return `${resolvedNativeId}-label`;
  }, [label, resolvedNativeId]);

  const resolvedA11yLabel = useMemo(() => {
    return props.accessibilityLabel ?? label ?? props.placeholder;
  }, [label, props.accessibilityLabel, props.placeholder]);

  const handleFocus: TextInputProps["onFocus"] = (e) => {
    setFocused(true);
    props.onFocus?.(e);
  };

  const handleBlur: TextInputProps["onBlur"] = (e) => {
    setFocused(false);
    props.onBlur?.(e);
  };

  const borderColor = errorText ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={[{ gap: 8 }, containerStyle]}>
      {label ? (
        <Text nativeID={labelNativeId} style={[theme.typography.label, { color: textColor, letterSpacing: 0.2 }]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        nativeID={resolvedNativeId}
        accessibilityLabel={resolvedA11yLabel}
        accessibilityLabelledBy={Platform.OS === "web" && labelNativeId ? labelNativeId : undefined}
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholderTextColor={theme.colors.textMuted}
        style={{
          borderWidth: 1,
          borderColor,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.sm,
          padding: 12,
          minHeight: props.multiline ? undefined : 46,
          color: textColor,
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
        }}
        {...props}
      />
      {errorText ? <ErrorText>{errorText}</ErrorText> : null}
      {!errorText && helperText ? <MutedText>{helperText}</MutedText> : null}
    </View>
  );
});

type BadgeProps = {
  label: string;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
  size?: "default" | "header";
  responsive?: boolean;
  fullWidth?: boolean;
};

export function Badge({ label, tone = "default", size = "default", responsive = true, fullWidth = false }: BadgeProps) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const effectiveSize = isDesktopWeb || !responsive ? size : "default";
  const bg =
    tone === "primary"
      ? theme.colors.primarySoft
      : tone === "success"
        ? "rgba(34, 197, 94, 0.16)"
        : tone === "warning"
          ? "rgba(245, 158, 11, 0.16)"
          : tone === "danger"
            ? "rgba(239, 68, 68, 0.16)"
            : theme.colors.surface2;

  const fg =
    tone === "primary"
      ? theme.colors.text
      : tone === "success"
        ? theme.colors.success
        : tone === "warning"
          ? theme.colors.warning
          : tone === "danger"
            ? theme.colors.danger
            : theme.colors.textMuted;

  return (
    <View
      style={{
        alignSelf: fullWidth ? "stretch" : "flex-start",
        width: fullWidth ? "100%" : undefined,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingHorizontal: effectiveSize === "header" ? 14 : 10,
        paddingVertical: effectiveSize === "header" ? 13 : 6,
        minHeight: effectiveSize === "header" ? 46 : undefined,
        borderRadius: 999,
        justifyContent: "center",
        alignItems: fullWidth ? "center" : undefined,
      }}
    >
      <Text style={[theme.typography.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  right?: React.ReactNode;
  topRight?: React.ReactNode;
  onPress?: () => void;
};

export function ListRow({ title, subtitle, meta, right, topRight, onPress }: ListRowProps) {
  const interactive = !!onPress;

  return (
    <Pressable
      disabled={!interactive}
      onPress={onPress}
      style={(state) => {
        const pressed = state.pressed;
        const hovered = !!(state as any).hovered;
        return [
          {
            backgroundColor: pressed ? theme.colors.surface2 : hovered && interactive ? theme.colors.surface2 : theme.colors.surface,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: theme.spacing.md,
            position: "relative",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.md,
            opacity: pressed ? 0.95 : 1,
            ...(Platform.OS === "web" ? ({ cursor: interactive ? "pointer" : "default" } as any) : null),
          },
          hovered && !pressed && interactive ? ({ transform: [{ translateY: -0.5 }] } as any) : null,
          pressed ? ({ transform: [{ translateY: 1 }] } as any) : null,
          shadow(1),
        ];
      }}
    >
      {topRight ? (
        <View style={{ pointerEvents: "none", position: "absolute", top: 10, right: 10, zIndex: 2 }}>
          {topRight}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 6 }]} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: "flex-end", gap: 8 }}>
        {meta ? <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{meta}</Text> : null}
        {right ? right : interactive ? <Text style={{ color: theme.colors.textMuted, fontSize: 18 }}>›</Text> : null}
      </View>
    </Pressable>
  );
}
