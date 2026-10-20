import {
  MODE_SPRITE_PREFIX,
  type EnvironmentId,
  type ModeSprite,
  type SpriteActionInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { connectPairing } from "~/connection/onboarding";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { spriteEnvironment } from "~/state/sprites";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { EnvironmentRow } from "./EnvironmentRow";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  running: "Running",
  warm: "Asleep",
  cold: "Asleep",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return null;
  }
}

function failureMessage<A, E>(result: AtomCommandResult<A, E>, fallback: string): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

function toastError(title: string, description: string) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/** What a paired sprite says its compute has cost, asked of the sprite itself. */
function SpriteCost({ environmentId }: { environmentId: EnvironmentId }) {
  const usage = useEnvironmentQuery(spriteEnvironment.usage({ environmentId, input: {} }));
  const windows = usage.data?.windows ?? [];
  if (windows.length === 0) return null;
  const label = windows
    .filter((window) => window.days === 7 || window.days === 30)
    .map((window) => `$${window.usd.toFixed(2)} ${window.days}d`)
    .join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{label}</TooltipTrigger>
      <TooltipPopup side="top">
        Estimated from this sprite's CPU and memory use at Fly's rates; storage is extra.
      </TooltipPopup>
    </Tooltip>
  );
}

function SpriteRow({
  sprite,
  environment,
  busy,
  onAction,
}: {
  sprite: ModeSprite;
  environment: EnvironmentPresentation | undefined;
  busy: string | null;
  onAction: (action: SpriteActionInput) => void;
}) {
  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
  const shortName = sprite.name.slice(MODE_SPRITE_PREFIX.length);
  const status = STATUS_LABELS[sprite.status] ?? sprite.status;
  return (
    <EnvironmentRow
      kind="cloud"
      label={shortName}
      subtitle={
        <span className="flex min-w-0 items-center gap-1.5">
          <span>{busy ?? status}</span>
          {environment !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <SpriteCost environmentId={environment.environmentId} />
            </>
          ) : null}
        </span>
      }
    >
      <div className="flex items-center gap-1">
        {busy !== null ? <Spinner className="size-3.5" /> : null}
        {environment === undefined ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => onAction({ _tag: "pair", name: sprite.name })}
          >
            Connect
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`${shortName} actions`}
                disabled={busy !== null}
              />
            }
          >
            <EllipsisIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => onAction({ _tag: "update", name: sprite.name })}>
              Update Mode, Claude Code and Codex
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => setConfirmingDestroy(true)}>
              Delete sprite…
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <AlertDialog open={confirmingDestroy} onOpenChange={setConfirmingDestroy}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {shortName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This destroys the sprite on Fly.io with its files, threads and checkpoints. It cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmingDestroy(false);
                onAction({ _tag: "destroy", name: sprite.name });
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </EnvironmentRow>
  );
}

/**
 * Mode's Fly.io sprites, as this machine's `sprite` CLI login sees them. Nothing is saved about
 * them here: the list is Fly's, a sprite is paired on demand, and one already paired is matched
 * by its URL to the environment it became.
 */
export function SpritesSettings({
  primaryEnvironmentId,
  environments,
}: {
  primaryEnvironmentId: EnvironmentId | null;
  environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const list = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : spriteEnvironment.list({ environmentId: primaryEnvironmentId, input: {} }),
  );
  const runAction = useAtomCommand(spriteEnvironment.action, { reportFailure: false });
  const pair = useAtomCommand(connectPairing, { reportFailure: false });
  const [busy, setBusy] = useState<Readonly<Record<string, string>>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  if (primaryEnvironmentId === null) return null;

  const setBusyLabel = (name: string, label: string | null) =>
    setBusy((current) => {
      const next = { ...current };
      if (label === null) delete next[name];
      else next[name] = label;
      return next;
    });

  const perform = async (action: SpriteActionInput) => {
    const name = action._tag === "create" ? `${MODE_SPRITE_PREFIX}${action.name}` : action.name;
    setBusyLabel(
      name,
      action._tag === "create"
        ? "Creating…"
        : action._tag === "pair"
          ? "Connecting…"
          : action._tag === "update"
            ? "Updating…"
            : "Deleting…",
    );
    try {
      const result = await runAction({ environmentId: primaryEnvironmentId, input: action });
      const message = failureMessage(result, "The sprite action failed.");
      if (message !== null) {
        toastError(`Could not ${action._tag} ${name}`, message);
        return false;
      }
      const pairing = result._tag === "Success" ? result.value.pairing : null;
      if (pairing !== null) {
        const paired = await pair({ host: pairing.url, pairingCode: pairing.credential });
        const pairMessage = failureMessage(paired, "Could not pair with the sprite.");
        if (pairMessage !== null) {
          toastError(`Could not connect to ${name}`, pairMessage);
          return false;
        }
      }
      return true;
    } finally {
      setBusyLabel(name, null);
      list.refresh();
    }
  };

  const environmentForSprite = (sprite: ModeSprite) => {
    const host = hostOf(sprite.url);
    return environments.find(
      (environment) =>
        environment.displayUrl !== null &&
        environment.displayUrl !== undefined &&
        hostOf(environment.displayUrl) === host,
    );
  };

  const { id, title } = searchableSetting("sprites");
  const data = list.data;
  return (
    <SettingsSection
      id={id}
      title={title}
      headerAction={
        data?.available ? (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button size="xs" variant="ghost-muted">
                  <PlusIcon className="size-3" />
                  <span>New sprite</span>
                </Button>
              }
            />
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>New sprite</DialogTitle>
                <DialogDescription>
                  Creates a Fly.io sprite, installs Mode's server with the latest Claude Code and
                  Codex, and connects to it. It sleeps when unused and costs nothing while asleep.
                  Sign in to the agents on it from its provider settings.
                </DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-foreground">Name</span>
                  <Input
                    value={newName}
                    placeholder="work"
                    onChange={(event) => setNewName(event.target.value.toLowerCase())}
                  />
                </label>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Becomes {MODE_SPRITE_PREFIX}
                  {newName || "work"}. Lowercase letters, digits and dashes.
                </p>
              </DialogPanel>
              <DialogFooter variant="bare">
                <Button
                  disabled={creating || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(newName)}
                  onClick={() => {
                    setCreating(true);
                    void perform({ _tag: "create", name: newName }).then((created) => {
                      setCreating(false);
                      if (created) {
                        setCreateOpen(false);
                        setNewName("");
                      }
                    });
                  }}
                >
                  {creating ? "Creating, this takes a few minutes…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
        ) : null
      }
    >
      {data === null ? (
        <SettingsRow
          title={list.error ?? "Looking for sprites…"}
          description={list.error ? "This machine could not list sprites." : undefined}
        />
      ) : !data.available ? (
        <SettingsRow title="Fly.io sprites" description={data.reason ?? undefined} />
      ) : data.sprites.length === 0 ? (
        <SettingsRow
          title="No sprites yet"
          description="Create one to run agents in a Fly.io sandbox that sleeps when unused."
        />
      ) : (
        data.sprites.map((sprite) => (
          <SpriteRow
            key={sprite.name}
            sprite={sprite}
            environment={environmentForSprite(sprite)}
            busy={busy[sprite.name] ?? null}
            onAction={(action) => void perform(action)}
          />
        ))
      )}
    </SettingsSection>
  );
}
