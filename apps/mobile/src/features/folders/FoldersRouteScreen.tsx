import { LegendList } from "@legendapp/list/react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ScreenHeader } from "../../components/ScreenHeader";
import { relativeTime } from "../../lib/time";
import { useThreadShells } from "../../state/entities";
import { refreshFolders, useEnvironmentFolders } from "../../state/folders";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsScreenContent } from "../settings/components/SettingsScreen";
import { buildFolderList, type FolderListEntry } from "./folderList";

export function FoldersRouteScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const environments = useEnvironmentFolders();
  const threads = useThreadShells();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [searchQuery, setSearchQuery] = useState("");

  const entries = useMemo(
    () => buildFolderList({ environments, threads, searchQuery }),
    [environments, searchQuery, threads],
  );
  const showEnvironment = Object.keys(savedConnectionsById).length > 1;

  // Folders are read with a query, not streamed; pick up changes made on other clients.
  useFocusEffect(useCallback(() => refreshFolders(), []));

  const renderItem = useCallback(
    ({ item }: { readonly item: FolderListEntry }) => (
      <FolderRow
        entry={item}
        environmentLabel={
          showEnvironment
            ? (savedConnectionsById[item.environmentId]?.environmentLabel ?? null)
            : null
        }
        onPress={() =>
          navigation.navigate("Folder", {
            environmentId: String(item.environmentId),
            slug: item.folder.slug,
          })
        }
      />
    ),
    [navigation, savedConnectionsById, showEnvironment],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScreenHeader
        title="Folders"
        sidebar={false}
        onBack={() => navigation.goBack()}
        search={{
          value: searchQuery,
          onChangeText: setSearchQuery,
          placeholder: "Search folders",
          compactPlaceholder: "Search",
          mode: "inline",
          compactToolbar: width < 700,
        }}
      />
      <SettingsScreenContent>
        <LegendList
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 }}
          contentInsetAdjustmentBehavior="automatic"
          data={entries}
          estimatedItemSize={76}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.key}
          ListEmptyComponent={
            <EmptyState
              title={searchQuery.trim() ? "No matching folders" : "No folders yet"}
              detail={
                searchQuery.trim()
                  ? "Try another search."
                  : "Create a folder from T3 Code on desktop or web to group one feature's worktrees across repositories."
              }
            />
          }
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      </SettingsScreenContent>
    </View>
  );
}

function FolderRow(props: {
  readonly entry: FolderListEntry;
  readonly environmentLabel: string | null;
  readonly onPress: () => void;
}) {
  const { folder, threadCount, lastActivityAt } = props.entry;
  const repos = folder.members
    .filter((member) => member.archivedAt === null)
    .map((member) => member.repoName);
  const details = [
    folder.issue ? `#${folder.issue.number}` : null,
    repos.join(", ") || "No repositories",
    props.environmentLabel,
  ].filter((part): part is string => Boolean(part));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${folder.name}`}
      className="mb-2 flex-row items-center gap-3 rounded-[20px] bg-card px-4 py-3 active:opacity-70"
      onPress={props.onPress}
    >
      <View className="h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-subtle">
        <SymbolView
          name="folder"
          size={15}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 flex-1 text-base font-t3-bold leading-snug text-foreground"
            numberOfLines={1}
          >
            {folder.name}
          </Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">
            {relativeTime(lastActivityAt)}
          </Text>
        </View>
        <Text className="text-xs text-foreground-tertiary" numberOfLines={1}>
          {details.join(" · ")}
        </Text>
        <Text className="text-2xs text-foreground-tertiary">
          {threadCount === 1 ? "1 thread" : `${threadCount} threads`}
        </Text>
      </View>
    </Pressable>
  );
}
