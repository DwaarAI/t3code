import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { skillEnvironment } from "../../state/skills";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/**
 * Skills on one environment, with a switch for each custom skill. Creating,
 * editing, and importing skills stays on web and desktop.
 */
export function EnvironmentSkillsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
}) {
  const { environmentId } = props;
  const listed = Option.getOrNull(
    AsyncResult.value(useAtomValue(skillEnvironment.list({ environmentId, input: {} }))),
  );
  const setEnabled = useAtomCommand(skillEnvironment.setEnabled);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(name: string, enabled: boolean) {
    setPending(name);
    setError(null);
    const result = await setEnabled({ environmentId, input: { name, enabled } });
    setPending(null);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update the skill.");
    }
  }

  return (
    <SettingsSection title="Skills">
      {listed === null ? (
        <Text className="p-4 text-sm text-foreground-muted">Loading skills…</Text>
      ) : listed.skills.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">No skills yet.</Text>
      ) : (
        listed.skills.map((skill) => (
          <SettingsSwitchRow
            key={skill.name}
            icon="doc.text"
            label={`$${skill.commandName}`}
            subtitle={[skill.source === "builtin" ? "Built-in" : null, skill.description]
              .filter(Boolean)
              .join(" · ")}
            disabled={props.disabled || skill.source === "builtin" || pending !== null}
            value={skill.enabled}
            onValueChange={(enabled) => void toggle(skill.name, enabled)}
          />
        ))
      )}
      {error ? (
        <View className="px-4 pb-4">
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        </View>
      ) : null}
    </SettingsSection>
  );
}
