import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";

import { DraftInput } from "../ui/draft-input";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** Opt-in GitHub polling that turns labeled issues into folders. */
export function FolderIssueSettingsSection() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedLabel = useScopedSettingsMixed(["githubIssueFolderLabel"]);
  return (
    <SettingsSection id="github-issue-folders" title={gt("GitHub issues")}>
      <SettingsRow
        serverScoped
        settingKeys={["githubIssueFolders"]}
        {...searchableSetting("github-issue-folders")}
        description={gt(
          "Every two minutes, open issues with the label below become folders in this environment's GitHub projects. Only issues whose author can push to the repository are used.",
        )}
        resetAction={
          settings.githubIssueFolders !== DEFAULT_UNIFIED_SETTINGS.githubIssueFolders ? (
            <SettingResetButton
              ariaLabel={gt("Reset create folders from GitHub issues")}
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
            aria-label={gt("Create folders from GitHub issues")}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["githubIssueFolderLabel"]}
        {...searchableSetting("github-issue-folder-label")}
        description={gt(
          "Issues move to this label with :active once their folder exists, or :error if it could not be created.",
        )}
        resetAction={
          settings.githubIssueFolderLabel !== DEFAULT_UNIFIED_SETTINGS.githubIssueFolderLabel ? (
            <SettingResetButton
              ariaLabel={gt("Reset GitHub issue label")}
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
            placeholder={
              mixedLabel ? gt("Mixed", { $context: "settings differ across scopes" }) : "t3"
            }
            spellCheck={false}
            aria-label={gt("GitHub issue label")}
          />
        }
      />
    </SettingsSection>
  );
}
