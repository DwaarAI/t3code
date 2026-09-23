import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { DraftInput } from "../ui/draft-input";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** Opt-in GitHub polling that turns labeled issues into folders. */
export function FolderIssueSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedLabel = useScopedSettingsMixed(["githubIssueFolderLabel"]);
  return (
    <SettingsSection id="github-issue-folders" title="GitHub issues">
      <SettingsRow
        serverScoped
        settingKeys={["githubIssueFolders"]}
        {...searchableSetting("github-issue-folders")}
        description="Every two minutes, open issues with the label below become folders in this environment's GitHub projects. Only issues whose author can push to the repository are used."
        resetAction={
          settings.githubIssueFolders !== DEFAULT_UNIFIED_SETTINGS.githubIssueFolders ? (
            <SettingResetButton
              label="create folders from GitHub issues"
              onClick={() =>
                updateSettings({ githubIssueFolders: DEFAULT_UNIFIED_SETTINGS.githubIssueFolders })
              }
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["githubIssueFolders"]}
            checked={settings.githubIssueFolders}
            onCheckedChange={(checked) => updateSettings({ githubIssueFolders: Boolean(checked) })}
            aria-label="Create folders from GitHub issues"
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["githubIssueFolderLabel"]}
        {...searchableSetting("github-issue-folder-label")}
        description="Issues move to this label with :active once their folder exists, or :error if it could not be created."
        resetAction={
          settings.githubIssueFolderLabel !== DEFAULT_UNIFIED_SETTINGS.githubIssueFolderLabel ? (
            <SettingResetButton
              label="GitHub issue label"
              onClick={() =>
                updateSettings({
                  githubIssueFolderLabel: DEFAULT_UNIFIED_SETTINGS.githubIssueFolderLabel,
                })
              }
            />
          ) : null
        }
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-48"
            value={mixedLabel ? "" : settings.githubIssueFolderLabel}
            onCommit={(next) => {
              if (next.trim()) updateSettings({ githubIssueFolderLabel: next.trim() });
            }}
            placeholder={mixedLabel ? "Mixed" : "t3"}
            spellCheck={false}
            aria-label="GitHub issue label"
          />
        }
      />
    </SettingsSection>
  );
}
