import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { jiraEnvironment } from "../../state/jira";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * The environment's Jira Cloud login, used for folder tickets and the agents'
 * Jira tools. One login per server; the token never comes back to clients.
 */
export function JiraSettingsSection() {
  const { environment } = useSettingsScope();
  const environmentId =
    environment?.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.jira === true
      ? environment.environmentId
      : null;
  if (environmentId === null) return null;
  return <JiraConnectionRow key={environmentId} environmentId={environmentId} />;
}

function JiraConnectionRow({ environmentId }: { environmentId: EnvironmentId }) {
  const id = useId();
  const status = useEnvironmentQuery(jiraEnvironment.status({ environmentId, input: {} }));
  const configure = useAtomCommand(jiraEnvironment.configure);
  const [draft, setDraft] = useState<{ baseUrl: string; email: string } | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const connection = status.data;
  const baseUrl = draft?.baseUrl ?? connection?.baseUrl ?? "";
  const email = draft?.email ?? connection?.email ?? "";
  const canSave =
    baseUrl.trim() !== "" && email.trim() !== "" && (connection?.configured || apiToken.trim());

  const save = async () => {
    setSaving(true);
    const result = await configure({
      environmentId,
      input: {
        baseUrl: baseUrl.trim(),
        email: email.trim(),
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
      },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    setDraft(null);
    setApiToken("");
    toastManager.add({ type: "success", title: "Connected to Jira" });
  };

  return (
    <SettingsSection id="jira-connection" title="Jira">
      <SettingsRow
        {...searchableSetting("jira-connection")}
        description={
          connection?.configured
            ? `Connected to ${connection.baseUrl} as ${connection.email}. Folders can attach tickets, and agents in a folder can read them.`
            : "Connect Jira Cloud to attach tickets to folders and let agents read them. Create an API token at id.atlassian.com → Security → API tokens."
        }
      >
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-url`}>Site</Label>
            <Input
              id={`${id}-url`}
              size="sm"
              value={baseUrl}
              placeholder="https://acme.atlassian.net"
              spellCheck={false}
              onChange={(event) => setDraft({ baseUrl: event.target.value, email })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-email`}>Account email</Label>
            <Input
              id={`${id}-email`}
              size="sm"
              type="email"
              value={email}
              spellCheck={false}
              onChange={(event) => setDraft({ baseUrl, email: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-token`}>API token</Label>
            <Input
              id={`${id}-token`}
              size="sm"
              type="password"
              autoComplete="off"
              value={apiToken}
              placeholder={connection?.configured ? "Saved; enter to replace" : ""}
              onChange={(event) => setApiToken(event.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={!canSave || saving}>
              {saving ? "Checking…" : connection?.configured ? "Save and test" : "Connect"}
            </Button>
          </div>
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}
