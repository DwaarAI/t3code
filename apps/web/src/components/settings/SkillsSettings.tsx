import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  SKILL_ENTRY_FILE,
  SKILL_MAX_TOTAL_BYTES,
  type Skill,
  type SkillFile,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import JSZip from "jszip";
import { MoreVertical, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { msg, T, useGT, Var } from "gt-react";
import { useRef, useState } from "react";

import { m } from "../../i18n/messages";
import { skillEnvironment } from "../../state/skills";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  importedSkillName,
  isBinaryText,
  newSkillTemplate,
  normalizeImportedFiles,
  withFrontmatterName,
} from "./SkillsSettings.logic";

interface SkillDraft {
  readonly title: string;
  readonly name: string;
  /** Set when editing an existing custom skill. */
  readonly previousName?: string;
  readonly files: ReadonlyArray<SkillFile>;
}

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : m(msg("Something went wrong."));
};

export function SkillsSettingsPanel() {
  const gt = useGT();
  const { connectedEnvironments } = useSettingsScope();
  const environments = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.skills === true,
  );
  return (
    <SettingsPageContainer>
      <SettingsSection id="skills" title={gt("Skills")}>
        {environments.length === 0 ? (
          <SettingsRow
            title={gt("Skills")}
            description={gt(
              "Connect an environment running an updated server to manage its skills.",
            )}
          />
        ) : (
          environments.map((environment) => (
            <EnvironmentSkills
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environments.length > 1 ? environment.label : null}
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function EnvironmentSkills(props: { environmentId: EnvironmentId; label: string | null }) {
  const { environmentId } = props;
  const gt = useGT();
  const listed = Option.getOrNull(
    AsyncResult.value(useAtomValue(skillEnvironment.list({ environmentId, input: {} }))),
  );
  const getSkill = useAtomCommand(skillEnvironment.get, { reportFailure: false });
  const setEnabled = useAtomCommand(skillEnvironment.setEnabled, { reportFailure: false });
  const deleteSkill = useAtomCommand(skillEnvironment.delete, { reportFailure: false });
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [removing, setRemoving] = useState<Skill | null>(null);
  const [busy, setBusy] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const openExisting = async (skill: Skill, mode: "edit" | "duplicate") => {
    setBusy(true);
    const result = await getSkill({ environmentId, input: { name: skill.name } });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: gt("Could not open skill"),
          description: failureMessage(result),
        });
      }
      return;
    }
    setDraft(
      mode === "edit"
        ? {
            title: gt("Edit {skill}", { skill: skill.commandName }),
            name: skill.name,
            previousName: skill.name,
            files: result.value.files,
          }
        : {
            title: gt("Duplicate {skill}", { skill: skill.commandName }),
            name: `${skill.name}-copy`,
            files: result.value.files,
          },
    );
  };

  const openImport = (files: ReadonlyArray<SkillFile>, sourceName: string, skipped: number) => {
    const normalized = normalizeImportedFiles(files);
    if (!normalized.some((file) => file.path === SKILL_ENTRY_FILE)) {
      toastManager.add({
        type: "error",
        title: gt("No {file} found", { file: SKILL_ENTRY_FILE }),
        description: gt("A skill folder needs a {file} file.", { file: SKILL_ENTRY_FILE }),
      });
      return;
    }
    const totalBytes = normalized.reduce((sum, file) => sum + new Blob([file.contents]).size, 0);
    if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
      toastManager.add({
        type: "error",
        title: gt("Skill is too large"),
        description: gt("Skills can hold up to {size} KB of text files.", {
          size: Math.floor(SKILL_MAX_TOTAL_BYTES / 1000),
        }),
      });
      return;
    }
    if (skipped > 0) {
      toastManager.add({
        type: "info",
        title: gt(
          "{count, plural, one {Skipped {count} binary file} other {Skipped {count} binary files}}",
          { count: skipped },
        ),
        description: gt("Skills carry text files only."),
      });
    }
    setDraft({
      title: gt("Import skill"),
      name: importedSkillName(normalized, sourceName),
      files: normalized,
    });
  };

  const importFolder = async (list: FileList) => {
    const files: SkillFile[] = [];
    let skipped = 0;
    for (const file of Array.from(list)) {
      const contents = await file.text();
      if (isBinaryText(contents)) {
        skipped += 1;
        continue;
      }
      files.push({ path: file.webkitRelativePath || file.name, contents, executable: false });
    }
    const folderName = list[0]?.webkitRelativePath.split("/")[0] ?? "imported-skill";
    openImport(files, folderName, skipped);
  };

  const importZip = async (file: File) => {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      toastManager.add({ type: "error", title: gt("Could not read the zip file") });
      return;
    }
    const files: SkillFile[] = [];
    let skipped = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const contents = await entry.async("string");
      if (isBinaryText(contents)) {
        skipped += 1;
        continue;
      }
      const mode = entry.unixPermissions;
      files.push({
        path: entry.name,
        contents,
        executable: typeof mode === "number" && (mode & 0o111) !== 0,
      });
    }
    openImport(files, file.name, skipped);
  };

  const toggle = async (skill: Skill, enabled: boolean) => {
    const result = await setEnabled({ environmentId, input: { name: skill.name, enabled } });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: gt("Could not update skill"),
        description: failureMessage(result),
      });
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const result = await deleteSkill({ environmentId, input: { name: removing.name } });
    setRemoving(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: gt("Could not delete skill"),
        description: failureMessage(result),
      });
    }
  };

  return (
    <SettingsRow
      title={
        props.label ? gt("Skills on {environment}", { environment: props.label }) : gt("Skills")
      }
      description={gt(
        "Claude and Codex chats run these as {command}. Changes apply to chats started afterwards.",
        { command: "$t3:<name>" },
      )}
      control={
        <div className="flex items-center gap-2">
          <input
            ref={(node) => {
              folderInput.current = node;
              node?.setAttribute("webkitdirectory", "");
            }}
            className="sr-only"
            type="file"
            multiple
            onChange={(event) => {
              const list = event.currentTarget.files;
              if (list && list.length > 0) void importFolder(list);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={zipInput}
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importZip(file);
              event.currentTarget.value = "";
            }}
          />
          <Menu>
            <MenuTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
              <UploadIcon className="size-3.5" /> <T context="button, import a skill">Import</T>
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => folderInput.current?.click()}>
                <T>Folder…</T>
              </MenuItem>
              <MenuItem onClick={() => zipInput.current?.click()}>
                <T>.zip file…</T>
              </MenuItem>
            </MenuPopup>
          </Menu>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setDraft({
                title: gt("New skill"),
                name: "my-skill",
                files: [
                  {
                    path: SKILL_ENTRY_FILE,
                    contents: newSkillTemplate("my-skill"),
                    executable: false,
                  },
                ],
              })
            }
          >
            <PlusIcon className="size-3.5" /> <T>New skill</T>
          </Button>
        </div>
      }
    >
      <div className="pt-3 pb-2">
        {listed === null ? (
          <p className="inline-flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Spinner size="xs" /> <T>Loading skills…</T>
          </p>
        ) : listed.skills.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            <T>No skills yet.</T>
          </p>
        ) : (
          listed.skills.map((skill) => (
            <SkillListItem
              key={skill.name}
              skill={skill}
              busy={busy}
              onToggle={(enabled) => void toggle(skill, enabled)}
              onEdit={() => void openExisting(skill, "edit")}
              onDuplicate={() => void openExisting(skill, "duplicate")}
              onDelete={() => setRemoving(skill)}
            />
          ))
        )}
      </div>
      {draft ? (
        <SkillEditorDialog
          environmentId={environmentId}
          draft={draft}
          onClose={() => setDraft(null)}
        />
      ) : null}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Delete <Var>{removing?.commandName}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                Its folder and every file in it are removed from this environment. New chats can no
                longer use it.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button variant="destructive" onClick={() => void confirmRemove()}>
              <T>Delete skill</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsRow>
  );
}

function SkillListItem(props: {
  skill: Skill;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { skill } = props;
  const gt = useGT();
  const custom = skill.source === "custom";
  return (
    <div className="flex items-center gap-3 border-t border-border/50 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-mono text-sm">{skill.commandName}</p>
          {custom ? null : (
            <Badge size="sm" variant="outline">
              <T>Built-in</T>
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {skill.description ?? gt("No description")}
          {skill.files.length > 1
            ? ` · ${gt("{count, plural, one {{count} file} other {{count} files}}", { count: skill.files.length })}`
            : ""}
        </p>
      </div>
      {custom ? (
        <Switch
          size="sm"
          checked={skill.enabled}
          disabled={props.busy}
          onCheckedChange={props.onToggle}
          aria-label={
            skill.enabled
              ? gt("Disable {skill}", { skill: skill.commandName })
              : gt("Enable {skill}", { skill: skill.commandName })
          }
        />
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost-muted"
              disabled={props.busy}
              aria-label={gt("{skill} options", { skill: skill.commandName })}
            />
          }
        >
          <MoreVertical />
        </MenuTrigger>
        <MenuPopup align="end">
          {custom ? (
            <MenuItem onClick={props.onEdit}>
              <T context="menu item, edit a skill">Edit</T>
            </MenuItem>
          ) : null}
          <MenuItem onClick={props.onDuplicate}>
            <T context="menu item, duplicate a skill">Duplicate</T>
          </MenuItem>
          {custom ? (
            <MenuItem variant="destructive" onClick={props.onDelete}>
              <T context="menu item, delete a skill">Delete</T>
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
}

function SkillEditorDialog(props: {
  environmentId: EnvironmentId;
  draft: SkillDraft;
  onClose: () => void;
}) {
  const { draft } = props;
  const gt = useGT();
  const save = useAtomCommand(skillEnvironment.save, { reportFailure: false });
  const [name, setName] = useState(draft.name);
  const [entry, setEntry] = useState(
    draft.files.find((file) => file.path === SKILL_ENTRY_FILE)?.contents ?? "",
  );
  const [others, setOthers] = useState(
    draft.files.filter((file) => file.path !== SKILL_ENTRY_FILE),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await save({
      environmentId: props.environmentId,
      input: {
        name,
        ...(draft.previousName ? { previousName: draft.previousName } : {}),
        files: [
          { path: SKILL_ENTRY_FILE, contents: withFrontmatterName(entry, name), executable: false },
          ...others,
        ],
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Saved {skill}", { skill: result.value.skill.commandName }),
      });
      props.onClose();
    } else if (!isAtomCommandInterrupted(result)) {
      setError(failureMessage(result));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft.title}</DialogTitle>
          <DialogDescription>
            <T>
              Agents read <Var>{SKILL_ENTRY_FILE}</Var> when the skill runs. Its description tells
              them when to use it.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="skill-name">
                <T>Name</T>
              </Label>
              <Input
                id="skill-name"
                font="mono"
                value={name}
                onChange={(event) => setName(event.target.value.toLowerCase())}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                <T>
                  Lowercase letters, numbers, and dashes. Invoked as{" "}
                  <Var>{`$t3:${name || "<name>"}`}</Var>.
                </T>
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="skill-entry">{SKILL_ENTRY_FILE}</Label>
              <Textarea
                id="skill-entry"
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
                spellCheck={false}
              />
            </div>
            {others.length > 0 ? (
              <div className="grid gap-1.5">
                <Label>
                  <T>Other files</T>
                </Label>
                <ul className="grid gap-1">
                  {others.map((file) => (
                    <li key={file.path} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                      {file.executable || file.contents.startsWith("#!") ? (
                        <Badge size="sm" variant="outline">
                          <T context="file mode badge">executable</T>
                        </Badge>
                      ) : null}
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={gt("Remove {path}", { path: file.path })}
                        onClick={() =>
                          setOthers((current) =>
                            current.filter((other) => other.path !== file.path),
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            <T>Cancel</T>
          </Button>
          <Button onClick={() => void submit()} disabled={saving || name.length === 0}>
            {saving ? gt("Saving…") : gt("Save skill")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
