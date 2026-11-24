import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useNavigationThreadShells, useProjects } from "../../state/entities";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsScreenContent } from "../settings/components/SettingsScreen";
import {
  buildRecentActivityRows,
  recentActivitySortOptions,
  type RecentActivityRow,
} from "./recentActivityRows";

export function RecentActivityRouteScreen() {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const threads = useNavigationThreadShells();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
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

  const rows = buildRecentActivityRows({ threads, projects, sort, nowMs, resolve: messages });
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
      onPress={() =>
        navigation.dispatch(
          StackActions.push("Thread", {
            environmentId: item.thread.environmentId,
            threadId: item.thread.id,
          }),
        )
      }
    />
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar title={gt("Recent activity")} onBack={() => navigation.goBack()} />
      <SettingsScreenContent>
        <LegendList
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 }}
          contentInsetAdjustmentBehavior="automatic"
          data={rows}
          estimatedItemSize={76}
          renderScrollComponent={NativeScrollView}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={
            <SegmentedControl
              className="mb-3"
              options={recentActivitySortOptions(messages)}
              selected={sort}
              onSelect={(recentActivitySort) => void savePreferences({ recentActivitySort })}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={gt("No recent threads")}
              detail={gt("Threads you open appear here.")}
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
  const gt = useGT();
  const { thread, projectTitle, times } = props.row;
  const context = [projectTitle, props.environmentLabel].filter(Boolean).join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("Open thread {title}", { title: thread.title })}
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
