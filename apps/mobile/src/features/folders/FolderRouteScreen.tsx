import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type Folder, type FolderMember } from "@t3tools/contracts";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ScreenHeader } from "../../components/ScreenHeader";
import { relativeTime } from "../../lib/time";
import { useThreadShells, waitForProject } from "../../state/entities";
import { folderEnvironment, refreshFolders, useFolder } from "../../state/folders";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreenContent } from "../settings/components/SettingsScreen";
import { buildFolderThreads, type FolderThreadEntry } from "./folderList";

type FolderRouteParams = {
  readonly environmentId: string;
  readonly slug: string;
};

export function FolderRouteScreen({ route }: StaticScreenProps<FolderRouteParams>) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const folder = useFolder(environmentId, route.params.slug);
  const threads = useThreadShells();
  const openRoot = useAtomCommand(folderEnvironment.openRoot, { reportFailure: false });
  const [openingSession, setOpeningSession] = useState(false);

  useFocusEffect(useCallback(() => refreshFolders(), []));

  const folderThreads = useMemo(
    () => (folder ? buildFolderThreads({ environmentId, folder, threads }) : []),
    [environmentId, folder, threads],
  );

  // A repository thread reuses the member's worktree; the draft route skips
  // any checkout when it is handed an existing worktree path.
  const startMemberThread = useCallback(
    (member: FolderMember) => {
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(environmentId),
          projectId: String(member.projectId),
          branch: member.branch,
          worktreePath: member.worktreePath,
          title: member.repoName,
        },
      });
    },
    [environmentId, navigation],
  );

  // A folder session runs in the folder directory, spanning every repository.
  // The server creates that directory's project the first time it is opened.
  const startFolderSession = useCallback(
    async (target: Folder) => {
      setOpeningSession(true);
      const opened = await openRoot({ environmentId, input: { slug: target.slug } });
      const rootProjectId = opened._tag === "Success" ? opened.value.folder.rootProjectId : null;
      // A project created just now reaches this client through the event stream.
      const project = rootProjectId
        ? await waitForProject(scopeProjectRef(environmentId, rootProjectId), 5_000)
        : null;
      setOpeningSession(false);
      if (opened._tag === "Failure") {
        if (!isAtomCommandInterrupted(opened)) {
          const error = squashAtomCommandFailure(opened);
          Alert.alert(
            "Could not open a folder session",
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        return;
      }
      if (!rootProjectId || !project) {
        Alert.alert("Could not open a folder session", "The folder's project did not load.");
        return;
      }
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(environmentId),
          projectId: String(rootProjectId),
          title: target.name,
        },
      });
    },
    [environmentId, navigation, openRoot],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScreenHeader
        title={folder?.name ?? "Folder"}
        sidebar={false}
        onBack={() => navigation.goBack()}
      />
      <SettingsScreenContent>
        {folder === null ? (
          <View className="p-4">
            <EmptyState
              title="Folder unavailable"
              detail="It may have been deleted, or its environment is not connected."
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 }}
            contentInsetAdjustmentBehavior="automatic"
          >
            {folder.issue ? (
              <Text className="mb-3 px-1 text-sm text-foreground-muted" numberOfLines={2}>
                #{folder.issue.number} {folder.issue.title}
              </Text>
            ) : null}

            <SectionLabel title="Start a thread" />
            <View className="overflow-hidden rounded-[20px] bg-card">
              <ActionRow
                icon="folder"
                title="Folder session"
                detail="Works across every repository"
                trailing={
                  openingSession ? <ActivityIndicator colorClassName="accent-icon" /> : null
                }
                disabled={openingSession}
                onPress={() => void startFolderSession(folder)}
                showDivider={folder.members.length > 0}
              />
              {folder.members.map((member, index) => (
                <ActionRow
                  key={member.projectId}
                  icon="arrow.triangle.branch"
                  title={member.repoName}
                  detail={
                    member.archivedAt === null ? member.branch : `${member.branch} · archived`
                  }
                  // An archived member's worktree is gone from disk; restore it on desktop first.
                  disabled={member.archivedAt !== null}
                  onPress={() => startMemberThread(member)}
                  showDivider={index < folder.members.length - 1}
                />
              ))}
            </View>

            <SectionLabel title="Threads" />
            {folderThreads.length === 0 ? (
              <Text className="px-1 text-sm text-foreground-muted">No threads yet.</Text>
            ) : (
              <View className="overflow-hidden rounded-[20px] bg-card">
                {folderThreads.map((entry, index) => (
                  <FolderThreadRow
                    key={`${entry.thread.environmentId}:${entry.thread.id}`}
                    entry={entry}
                    onPress={() =>
                      navigation.navigate("Thread", {
                        environmentId: entry.thread.environmentId,
                        threadId: entry.thread.id,
                      })
                    }
                    showDivider={index < folderThreads.length - 1}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </SettingsScreenContent>
    </View>
  );
}

function SectionLabel(props: { readonly title: string }) {
  return (
    <Text className="px-1 pt-4 pb-2 text-xs font-t3-medium tracking-[0.5px] uppercase text-foreground-muted">
      {props.title}
    </Text>
  );
}

function ActionRow(props: {
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly detail: string;
  readonly disabled?: boolean;
  readonly trailing?: ReactNode;
  readonly showDivider: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`New thread in ${props.title}`}
      accessibilityState={{ disabled: props.disabled === true }}
      className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${props.disabled ? "opacity-50" : ""} ${props.showDivider ? "border-b border-separator" : ""}`}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <SymbolView
        name={props.icon}
        size={15}
        tintColorClassName="accent-icon-subtle"
        type="monochrome"
      />
      <View className="min-w-0 flex-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
          {props.title}
        </Text>
        <Text className="font-mono text-2xs text-foreground-tertiary" numberOfLines={1}>
          {props.detail}
        </Text>
      </View>
      {props.trailing ?? (
        <SymbolView
          name="plus"
          size={14}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      )}
    </Pressable>
  );
}

function FolderThreadRow(props: {
  readonly entry: FolderThreadEntry;
  readonly showDivider: boolean;
  readonly onPress: () => void;
}) {
  const { thread, repoName } = props.entry;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open thread ${thread.title}`}
      className={`gap-1 px-4 py-3 active:opacity-70 ${props.showDivider ? "border-b border-separator" : ""}`}
      onPress={props.onPress}
    >
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-base font-t3-bold text-foreground" numberOfLines={1}>
          {thread.title}
        </Text>
        <Text className="text-xs tabular-nums text-foreground-tertiary">
          {relativeTime(thread.updatedAt)}
        </Text>
      </View>
      <Text className="text-2xs text-foreground-tertiary" numberOfLines={1}>
        {repoName ?? "Folder session"}
      </Text>
    </Pressable>
  );
}
