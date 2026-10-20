import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useNavigationThreadShells, useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { SettingsScreenContent } from "../settings/components/SettingsScreen";
import {
  buildRecentActivityRows,
  RECENT_ACTIVITY_SORT_OPTIONS,
  type RecentActivityRow,
} from "./recentActivityRows";

export function RecentActivityRouteScreen() {
  const navigation = useNavigation();
  const { selectThread } = useAdaptiveWorkspaceLayout();
  const threads = useNavigationThreadShells();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const sort = AsyncResult.isSuccess(preferences)
    ? (preferences.value.recentActivitySort ?? "updated")
    : "updated";

  // The clock is state so compiled renders recompute the ages; it only ticks while focused.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useFocusEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  });

  const rows = buildRecentActivityRows({ threads, projects, sort, nowMs });
  const showEnvironment = Object.keys(savedConnectionsById).length > 1;

  const renderItem = ({ item }: { readonly item: RecentActivityRow }) => (
    <RecentActivityRowView
      row={item}
      sort={sort}
      environmentLabel={
        showEnvironment
          ? (savedConnectionsById[item.thread.environmentId]?.environmentLabel ?? null)
          : null
      }
      onPress={() => selectThread(item.thread)}
    />
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar title="Recent activity" sidebar={false} onBack={() => navigation.goBack()} />
      <SettingsScreenContent>
        <LegendList
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 }}
          contentInsetAdjustmentBehavior="automatic"
          data={rows}
          estimatedItemSize={76}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={
            <SegmentedControl
              className="mb-3"
              options={RECENT_ACTIVITY_SORT_OPTIONS}
              selected={sort}
              onSelect={(recentActivitySort) => savePreferences({ recentActivitySort })}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No recent threads"
              detail="Threads you open appear here."
              variant="plain"
            />
          }
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      </SettingsScreenContent>
    </View>
  );
}

function RecentActivityRowView(props: {
  readonly row: RecentActivityRow;
  readonly sort: RecentActivityRow["times"][number]["sort"];
  readonly environmentLabel: string | null;
  readonly onPress: () => void;
}) {
  const { thread, projectTitle, times } = props.row;
  const context = [projectTitle, props.environmentLabel].filter(Boolean).join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open thread ${thread.title}`}
      accessibilityHint={times.map((time) => `${time.label} ${time.age}`).join(", ")}
      className="mb-2 gap-1 rounded-[20px] bg-card px-4 py-3 active:opacity-70"
      onPress={props.onPress}
    >
      <Text className="text-base font-t3-bold leading-snug text-foreground" numberOfLines={1}>
        {thread.title}
      </Text>
      {context ? (
        <Text className="text-xs text-foreground-tertiary" numberOfLines={1}>
          {context}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-x-1.5">
        {times.map((time, index) => (
          <View key={time.sort} className="flex-row items-center gap-x-1.5">
            {index > 0 ? <Text className="text-2xs text-foreground-tertiary">·</Text> : null}
            <Text
              className={
                time.sort === props.sort
                  ? "text-2xs font-t3-bold tabular-nums text-foreground"
                  : "text-2xs tabular-nums text-foreground-tertiary"
              }
            >
              {`${time.label} ${time.age}`}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
