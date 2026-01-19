import React, { useCallback, useContext, useEffect, useState } from "react";
import { Platform, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { AppButton, Badge, Card, ErrorText, ListRow, MutedText, Screen, theme } from "../ui";

type Summary = {
  ok: true;
  inventory: {
    totalItems: number;
    lowStockCount: number;
    expiringSoonCount: number;
    expiryDays: number;
  };
  orders: {
    openOrdersCount: number;
    recent: Array<{ _id: string; status: string; createdAt: string }>;
  };
};

export function DashboardScreen({ navigation }: any) {
  const { token, user, effectiveRole, refreshTenants } = useContext(AuthContext);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 900;
  const isNarrowHeader = width < 380;

  const roleLabel = user?.role === "admin" ? "super_admin" : effectiveRole ?? user?.role ?? "-";

  function RolePill({ role }: { role: string }) {
    const tone: "default" | "primary" | "warning" = role === "admin" || role === "super_admin" ? "warning" : role === "manager" ? "primary" : "default";
    const bg =
      tone === "primary"
        ? theme.colors.primarySoft
        : tone === "warning"
          ? "rgba(245, 158, 11, 0.16)"
          : theme.colors.surface2;
    const fg =
      tone === "primary" ? theme.colors.text : tone === "warning" ? theme.colors.warning : theme.colors.textMuted;

    return (
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          justifyContent: "center",
        }}
      >
        <Text style={[theme.typography.label, { color: fg, fontWeight: "800" }]}>{role}</Text>
      </View>
    );
  }

  type PieSlice = {
    label: string;
    value: number;
    color: string;
  };

  function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
    const largeArc = end - start > Math.PI ? 1 : 0;
    const sx = cx + r * Math.cos(start);
    const sy = cy + r * Math.sin(start);
    const ex = cx + r * Math.cos(end);
    const ey = cy + r * Math.sin(end);
    return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
  }

  function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number) {
    const largeArc = end - start > Math.PI ? 1 : 0;
    const sx0 = cx + rOuter * Math.cos(start);
    const sy0 = cy + rOuter * Math.sin(start);
    const ex0 = cx + rOuter * Math.cos(end);
    const ey0 = cy + rOuter * Math.sin(end);

    const sx1 = cx + rInner * Math.cos(end);
    const sy1 = cy + rInner * Math.sin(end);
    const ex1 = cx + rInner * Math.cos(start);
    const ey1 = cy + rInner * Math.sin(start);

    return [
      `M ${sx0} ${sy0}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${ex0} ${ey0}`,
      `L ${sx1} ${sy1}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ex1} ${ey1}`,
      "Z",
    ].join(" ");
  }

  function DonutChart({ slices, size = 140 }: { slices: PieSlice[]; size?: number }) {
    const total = Math.max(0, slices.reduce((a, s) => a + Math.max(0, s.value), 0));
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = (size / 2) * 0.92;
    const rInner = rOuter * 0.62;

    if (!total) {
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Path d={arcPath(cx, cy, rOuter, 0, Math.PI * 2)} stroke={theme.colors.border} strokeWidth={rOuter - rInner} fill="none" />
        </Svg>
      );
    }

    let a0 = -Math.PI / 2;

    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices
          .filter((s) => s.value > 0)
          .map((s, idx) => {
            const frac = s.value / total;
            const a1 = a0 + frac * Math.PI * 2;
            const d = donutSlicePath(cx, cy, rOuter, rInner, a0, a1);
            a0 = a1;
            return <Path key={idx} d={d} fill={s.color} />;
          })}
      </Svg>
    );
  }

  function ChartLegend({ slices }: { slices: PieSlice[] }) {
    const total = Math.max(0, slices.reduce((a, s) => a + Math.max(0, s.value), 0));
    return (
      <View style={{ gap: 8 }}>
        {slices.map((s) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          return (
            <View key={s.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: s.color }} />
                <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
                  {s.label}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textMuted, fontWeight: "800" }}>
                {s.value}{total ? ` (${pct}%)` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  type Tone = "default" | "primary" | "warning" | "success" | "danger";

  function Sparkline({ values, tone }: { values: number[]; tone?: Tone }) {
    const max = Math.max(1, ...values);
    const color =
      tone === "warning"
        ? theme.colors.warning
        : tone === "success"
          ? theme.colors.success
          : tone === "danger"
            ? theme.colors.danger
            : theme.colors.primary;

    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          height: 28,
          gap: 3,
          width: "100%",
        }}
      >
        {values.map((v, idx) => (
          <View
            key={idx}
            style={{
              flex: 1,
              height: Math.max(4, Math.round((v / max) * 28)),
              borderRadius: 6,
              backgroundColor: color,
              opacity: 0.9,
            }}
          />
        ))}
      </View>
    );
  }

  function KpiCard({
    title,
    value,
    subtitle,
    tone,
    spark,
  }: {
    title: string;
    value: string;
    subtitle?: string;
    tone?: Tone;
    spark?: number[];
  }) {
    const badgeTone = tone ?? "default";

    return (
      <Card style={{ padding: theme.spacing.md, flexGrow: 1, minWidth: isWide ? 240 : 160, flexBasis: isWide ? "32%" : "48%" } as any}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 6 }]} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Badge label={value} tone={badgeTone} />
        </View>
        {spark && spark.length ? (
          <View style={{ marginTop: 12 }}>
            <Sparkline values={spark} tone={tone} />
          </View>
        ) : null}
      </Card>
    );
  }

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const res = await apiRequest<Summary>("/dashboard/summary", { method: "GET", token });
    setData(res);
  }, [token]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      refreshTenants().catch(() => undefined);
      setRefreshing(true);
      load()
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setRefreshing(false));
    }, [load, refreshTenants])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      title="Dashboard"
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />
      }
      right={
        isWide && user ? (
          <View
            style={{
              flexDirection: isNarrowHeader ? "column" : "row",
              alignItems: isNarrowHeader ? "flex-end" : "center",
              justifyContent: "flex-end",
              gap: isNarrowHeader ? 6 : 10,
              flexShrink: 1,
              maxWidth: isNarrowHeader ? Math.max(160, Math.floor(width * 0.6)) : undefined,
            }}
          >
            <Text
              style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16, textAlign: "right", flexShrink: 1 }}
              numberOfLines={isNarrowHeader ? 2 : 1}
            >
              Welcome back {user.name}
            </Text>
            <RolePill role={roleLabel} />
          </View>
        ) : null
      }
    >
      {!isWide && user ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16, flex: 1 }} numberOfLines={2}>
            Welcome back {user.name}
          </Text>
          <RolePill role={roleLabel} />
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <KpiCard
          title="Total inventory"
          value={typeof data?.inventory.totalItems === "number" ? String(data.inventory.totalItems) : "-"}
          subtitle="All tracked items"
          tone="primary"
          spark={typeof data?.inventory.totalItems === "number" ? [2, 4, 6, 4, 7, 8, 7, 9, 8, 10] : undefined}
        />
        <KpiCard
          title="Low stock"
          value={typeof data?.inventory.lowStockCount === "number" ? String(data.inventory.lowStockCount) : "-"}
          subtitle="Requires replenishment"
          tone={typeof data?.inventory.lowStockCount === "number" && data.inventory.lowStockCount > 0 ? "warning" : "primary"}
          spark={typeof data?.inventory.lowStockCount === "number" ? [1, 2, 3, 2, 3, 5, 4, 6, 5, data.inventory.lowStockCount] : undefined}
        />
        <KpiCard
          title={`Expiring (${data?.inventory.expiryDays ?? "-"}d)`}
          value={typeof data?.inventory.expiringSoonCount === "number" ? String(data.inventory.expiringSoonCount) : "-"}
          subtitle="Near expiry window"
          tone={typeof data?.inventory.expiringSoonCount === "number" && data.inventory.expiringSoonCount > 0 ? "warning" : "primary"}
          spark={typeof data?.inventory.expiringSoonCount === "number" ? [0, 1, 1, 2, 2, 3, 3, 2, 4, data.inventory.expiringSoonCount] : undefined}
        />
        <KpiCard
          title="Open orders"
          value={typeof data?.orders.openOrdersCount === "number" ? String(data.orders.openOrdersCount) : "-"}
          subtitle="Awaiting fulfillment"
          tone={typeof data?.orders.openOrdersCount === "number" && data.orders.openOrdersCount > 0 ? "primary" : "default"}
          spark={typeof data?.orders.openOrdersCount === "number" ? [1, 2, 2, 3, 2, 4, 3, 5, 4, data.orders.openOrdersCount] : undefined}
        />
      </View>

      {isWide ? (
        <>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "stretch" }}>
            <Card style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                  Inventory
                </Text>
                <Badge label={`Total ${data?.inventory.totalItems ?? "-"}`} tone="primary" />
              </View>

              {typeof data?.inventory.totalItems === "number" ? (
                (() => {
                  const total = data.inventory.totalItems;
                  const low = data.inventory.lowStockCount;
                  const exp = data.inventory.expiringSoonCount;
                  const healthy = Math.max(0, total - low - exp);
                  const slices: PieSlice[] = [
                    { label: "Healthy", value: healthy, color: theme.colors.success },
                    { label: "Low stock", value: low, color: theme.colors.warning },
                    { label: `Expiring (${data.inventory.expiryDays}d)`, value: exp, color: theme.colors.primary },
                  ];

                  return (
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <DonutChart slices={slices} size={150} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ChartLegend slices={slices} />
                      </View>
                    </View>
                  );
                })()
              ) : (
                <MutedText>Loading inventory summary...</MutedText>
              )}
            </Card>

            <Card style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                  Orders
                </Text>
                <Badge
                  label={`Open ${String(data?.orders.openOrdersCount ?? "-")}`}
                  tone={typeof data?.orders.openOrdersCount === "number" && data.orders.openOrdersCount > 0 ? "primary" : "default"}
                />
              </View>

              {data?.orders.recent?.length ? (
                (() => {
                  const recent = data.orders.recent.slice(0, 50);
                  const counts = recent.reduce(
                    (acc, o) => {
                      acc[o.status] = (acc[o.status] ?? 0) + 1;
                      return acc;
                    },
                    {} as Record<string, number>
                  );

                  const slices: PieSlice[] = [
                    { label: "Created", value: counts.created ?? 0, color: theme.colors.primary },
                    { label: "Picking", value: counts.picking ?? 0, color: theme.colors.warning },
                    { label: "Fulfilled", value: counts.fulfilled ?? 0, color: theme.colors.success },
                    { label: "Cancelled", value: counts.cancelled ?? 0, color: theme.colors.danger },
                  ];

                  return (
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <DonutChart slices={slices} size={150} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ChartLegend slices={slices} />
                      </View>
                    </View>
                  );
                })()
              ) : (
                <MutedText>No recent orders</MutedText>
              )}
            </Card>
          </View>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                Recent orders
              </Text>
              <AppButton title="View all" variant="secondary" onPress={() => (navigation as any).navigate("Orders", { screen: "OrdersList" })} />
            </View>
            {data?.orders.recent?.length ? (
              data.orders.recent.slice(0, 5).map((o) => (
                <ListRow
                  key={o._id}
                  title={`Order #${o._id.slice(-6)}`}
                  subtitle={new Date(o.createdAt).toLocaleString()}
                  right={<Badge label={o.status} tone={o.status === "fulfilled" ? "success" : o.status === "cancelled" ? "danger" : o.status === "picking" ? "warning" : "primary"} />}
                  onPress={() => (navigation as any).navigate("Orders", { screen: "OrderDetail", params: { id: o._id } })}
                />
              ))
            ) : (
              <MutedText>No recent orders</MutedText>
            )}
          </Card>
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                Inventory
              </Text>
              <Badge label={`Total ${data?.inventory.totalItems ?? "-"}`} tone="primary" />
            </View>

            {typeof data?.inventory.totalItems === "number" ? (
              (() => {
                const total = data.inventory.totalItems;
                const low = data.inventory.lowStockCount;
                const exp = data.inventory.expiringSoonCount;
                const healthy = Math.max(0, total - low - exp);
                const slices: PieSlice[] = [
                  { label: "Healthy", value: healthy, color: theme.colors.success },
                  { label: "Low stock", value: low, color: theme.colors.warning },
                  { label: `Expiring (${data.inventory.expiryDays}d)`, value: exp, color: theme.colors.primary },
                ];

                return (
                  <View style={{ flexDirection: "column", gap: 12, alignItems: "center" }}>
                    <DonutChart slices={slices} size={170} />
                    <View style={{ width: "100%" }}>
                      <ChartLegend slices={slices} />
                    </View>
                  </View>
                );
              })()
            ) : (
              <MutedText>Loading inventory summary...</MutedText>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                Orders
              </Text>
              <Badge
                label={`Open ${String(data?.orders.openOrdersCount ?? "-")}`}
                tone={typeof data?.orders.openOrdersCount === "number" && data.orders.openOrdersCount > 0 ? "primary" : "default"}
              />
            </View>

            {data?.orders.recent?.length ? (
              (() => {
                const recent = data.orders.recent.slice(0, 50);
                const counts = recent.reduce(
                  (acc, o) => {
                    acc[o.status] = (acc[o.status] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>
                );

                const slices: PieSlice[] = [
                  { label: "Created", value: counts.created ?? 0, color: theme.colors.primary },
                  { label: "Picking", value: counts.picking ?? 0, color: theme.colors.warning },
                  { label: "Fulfilled", value: counts.fulfilled ?? 0, color: theme.colors.success },
                  { label: "Cancelled", value: counts.cancelled ?? 0, color: theme.colors.danger },
                ];

                return (
                  <View style={{ flexDirection: "column", gap: 12, alignItems: "center" }}>
                    <DonutChart slices={slices} size={170} />
                    <View style={{ width: "100%" }}>
                      <ChartLegend slices={slices} />
                    </View>
                  </View>
                );
              })()
            ) : (
              <MutedText>No recent orders</MutedText>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
                Recent orders
              </Text>
              <AppButton title="View all" variant="secondary" onPress={() => (navigation as any).navigate("Orders", { screen: "OrdersList" })} />
            </View>
            {data?.orders.recent?.length ? (
              data.orders.recent.slice(0, 5).map((o) => (
                <ListRow
                  key={o._id}
                  title={`Order #${o._id.slice(-6)}`}
                  subtitle={new Date(o.createdAt).toLocaleString()}
                  right={<Badge label={o.status} tone={o.status === "fulfilled" ? "success" : o.status === "cancelled" ? "danger" : o.status === "picking" ? "warning" : "primary"} />}
                  onPress={() => (navigation as any).navigate("Orders", { screen: "OrderDetail", params: { id: o._id } })}
                />
              ))
            ) : (
              <MutedText>No recent orders</MutedText>
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
