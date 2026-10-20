# Mode

Mode is a soft fork of [T3 Code](https://github.com/pingdotgg/t3code), rebased onto each upstream
stable ("Beta") release. Fork changes are kept small and in separate commits so rebases stay cheap.

## What the fork changes

- **Identity**: app name "Mode", bundle id `lol.mati.mode`, Electron profile
  `~/Library/Application Support/mode`, boot-service label `lol.mati.mode.service`, and its own icon
  (`assets/mode/`). The `t3code://` URL scheme is kept so Clerk sign-in redirects keep working.
- **Shared data**: Mode uses T3 Code's data home (`~/.t3`): same threads, projects, settings and
  T3 Connect environment. Only one server can own it at a time, so Mode refuses to start while T3 Code
  (or its background service) runs, and the server refuses a database migrated by a newer build, so
  an older Mode never writes to a schema it does not know. Rebase onto a release only once T3 Code has
  updated to it. What is encrypted with Mode's own keychain key (Connect sign-in, saved connections)
  and Mode's `t3` launcher live in `~/.mode` instead, so the two apps never overwrite each other's.
- **Linear issues** (`apps/server/src/linear`, `apps/web/src/components/linear`): agents link the
  Linear issue a thread works on with the `link_linear_issue` MCP tool (URL and title, no Linear auth),
  and it shows beside the thread's pull requests. Stored in `mode_thread_linear_issues`, a table the
  server creates itself in the shared database; T3 Code never reads it.
- **Window title** (`apps/web/src/hooks/useThreadWindowTitle.ts`): the window is titled after the
  thread on screen (Linear issues, title, branch, project, worktree, last prompt) so time trackers
  like Timing can tell threads apart.
- **Sprites** (`apps/server/src/sprite`, Settings → Connections → Sprites): Fly.io sandboxes running
  Mode's server behind a public URL, protected by pairing. Mode lists them from the local `sprite` CLI
  login (names prefixed `mode-`, never waking them) and stores nothing about them. Creating or updating
  one installs the latest Claude Code, Codex and Mode server bundle, which `scripts/mode/publish-server.ts`
  uploads to the fork's `mode-server` release after every `install-macos.ts` build; native modules come
  from upstream's `@t3code/t3-linux-*` package of the same version. On a sprite the server holds a
  sprite task while agent runs are active (a sprite otherwise pauses with no client connected) and
  estimates its own cost from cgroup CPU and memory at Fly's rates.
- **No database migrations.** Never add one in the fork: upstream's next migration would reuse the id
  and be skipped silently. Mode-only tables are created with `CREATE TABLE IF NOT EXISTS` under a `mode_` prefix.

## Rebasing onto a new upstream release

```sh
git fetch origin --no-tags && git fetch origin tag vX.Y.Z --no-tags
git rebase --onto vX.Y.Z <previous-upstream-tag> main
npx pnpm@<packageManager version> install
vp check && vp run typecheck
git push --force-with-lease fork main
```

Releases are listed with `gh release list -R pingdotgg/t3code` (stable ones are not pre-releases).

## Building and installing on this Mac

```sh
node scripts/mode/install-macos.ts            # build, sign, install to /Applications/Mode.app, open
node scripts/mode/install-macos.ts --skip-build  # re-sign and reinstall the last build
```

The build is signed with the first Developer ID Application (or Apple Development) identity in the
login keychain. That keeps keychain and privacy permissions across rebuilds. It is not notarized,
which is fine for apps built on the same machine. No update feed is configured, so Mode never
auto-updates to an official release.

T3 Connect needs the public Clerk/relay identifiers at build time; the script copies `.env.example` to
`.env` when there is none.
