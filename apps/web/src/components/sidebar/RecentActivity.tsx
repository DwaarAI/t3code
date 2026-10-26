/**
 * Recent activity: the last threads this user opened, across every connected
 * environment, with when each was updated, last prompted and last viewed.
 * Opened from the sidebar header, the command palette or its shortcut.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { create } from "zustand";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentFolders } from "../../state/folders";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import {
  Popover,
  PopoverCreateHandle,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  buildRecentActivityRows,
  isRecentActivitySort,
  RECENT_ACTIVITY_SORT_OPTIONS,
  type RecentActivityRow,
} from "./RecentActivity.logic";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const RECENT_ACTIVITY_TRIGGER_ID = "sidebar-recent-activity-trigger";
const recentActivityPopoverHandle = PopoverCreateHandle();

const useRecentActivityStore = create<{ open: boolean; anchor: Element | null }>(() => ({
  open: false,
  anchor: null,
}));

// The sidebar can be collapsed off-canvas or closed on small screens, so the
// header button is only an anchor while it is actually on screen.
function visibleTrigger(): Element | null {
  const trigger = document.getElementById(RECENT_ACTIVITY_TRIGGER_ID);
  if (trigger === null) return null;
  const rect = trigger.getBoundingClientRect();
  return rect.width > 0 && rect.right > 0 && rect.left < window.innerWidth ? trigger : null;
}

const VIEWPORT_ANCHOR = {
  getBoundingClientRect: () => new DOMRect(window.innerWidth / 2, 48, 0, 0),
};

export function openRecentActivity(anchorToTrigger = true): void {
  useRecentActivityStore.setState({
    open: true,
    anchor: anchorToTrigger ? visibleTrigger() : null,
  });
}

export function closeRecentActivity(): void {
  useRecentActivityStore.setState({ open: false });
}

export function toggleRecentActivity(): void {
  if (useRecentActivityStore.getState().open) closeRecentActivity();
  else openRecentActivity();
}

export function isRecentActivityOpen(): boolean {
  return useRecentActivityStore.getState().open;
}

export function RecentActivityTrigger() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "recentActivity.toggle");
  return (
    <PopoverTrigger
      handle={recentActivityPopoverHandle}
      id={RECENT_ACTIVITY_TRIGGER_ID}
      render={
        <SidebarHeaderIconButton
          label="Recent activity"
          tooltip={shortcutLabel ? `Recent activity (${shortcutLabel})` : "Recent activity"}
        />
      }
    >
      <HistoryIcon />
    </PopoverTrigger>
  );
}

/** Mounted once inside the sidebar provider; the panel only subscribes while open. */
export function RecentActivityHost() {
  const open = useRecentActivityStore((state) => state.open);
  const anchor = useRecentActivityStore((state) => state.anchor);
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const firstRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => closeRecentActivity(), []);

  return (
    <Popover
      handle={recentActivityPopoverHandle}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeRecentActivity();
          return;
        }
        // The small-screen sidebar is a modal sheet, which would treat taps in
        // the popover as outside presses; close it and centre the popover.
        if (isMobile && openMobile) setOpenMobile(false);
        openRecentActivity(!isMobile);
      }}
    >
      <PopoverPopup
        anchor={anchor ?? VIEWPORT_ANCHOR}
        align={anchor === null ? "center" : "start"}
        side="bottom"
        width="lg"
        padding="compact"
        initialFocus={firstRowRef}
      >
        <RecentActivityPanel
          firstRowRef={firstRowRef}
          onSelect={() => {
            closeRecentActivity();
            if (isMobile) setOpenMobile(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

function moveRowFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-recent-activity-row]")];
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.findIndex((row) => row === document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = current === -1 ? 0 : (current + step + rows.length) % rows.length;
  rows[next]?.focus();
}

function RecentActivityPanel(props: {
  readonly firstRowRef: RefObject<HTMLButtonElement | null>;
  readonly onSelect: () => void;
}) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const folders = useEnvironmentFolders();
  const localLastVisitedAtByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  const sort = useClientSettings((settings) => settings.recentActivitySort);
  const nowMinute = useNowMinute();
  const rows = buildRecentActivityRows({
    threads,
    localLastVisitedAtByKey,
    projectTitleByKey: new Map(
      projects.map((project) => [
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        project.title,
      ]),
    ),
    folders,
    sort,
    nowMs: Date.parse(`${nowMinute}:00.000Z`),
  });

  const selectRow = (row: RecentActivityRow) => {
    props.onSelect();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(row.threadRef),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 ps-2">
        <PopoverTitle>Recent activity</PopoverTitle>
        <ToggleGroup
          aria-label="Sort recent activity"
          value={[sort]}
          onValueChange={(next) => {
            const value = next[0];
            if (isRecentActivitySort(value))
              void updateClientSettings({ recentActivitySort: value });
          }}
        >
          {RECENT_ACTIVITY_SORT_OPTIONS.map((option) => (
            <Toggle key={option.sort} value={option.sort}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-6 text-center text-muted-foreground text-xs">
          Threads you open appear here.
        </p>
      ) : (
        <ul className="flex flex-col" onKeyDown={moveRowFocus}>
          {rows.map((row, index) => (
            <li key={row.key}>
              <button
                ref={index === 0 ? props.firstRowRef : undefined}
                type="button"
                data-recent-activity-row=""
                className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => selectRow(row)}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm">{row.title}</span>
                  {row.context ? (
                    <span className="ms-auto max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
                      {row.context}
                    </span>
                  ) : null}
                </span>
                <span className="flex gap-3 text-muted-foreground text-xs tabular-nums">
                  {row.times.map((time) => (
                    <span
                      key={time.sort}
                      className={cn(time.active && "font-medium text-foreground")}
                    >
                      {time.label} {time.value}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
