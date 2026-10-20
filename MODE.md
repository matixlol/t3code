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
- **Diff guides** (`apps/server/src/diffGuide`, `apps/web/src/components/diffGuide`): a Linear-style
  guide for pull request and thread diffs, written in one shot by DeepSeek Flash through OpenRouter.
  Requests are routed to zero-data-retention providers only (`provider.zdr`).
  Toggle it with the sparkles button in any diff toolbar. The OpenRouter key is entered in the guide
  pane (stored in `~/.t3/userdata/secrets`) or read from `OPENROUTER_API_KEY`.
- **Linear issues** (`apps/server/src/linear`, `apps/web/src/components/linear`): agents link the
  Linear issue a thread works on with the `link_linear_issue` MCP tool (URL and title, no Linear auth),
  and it shows beside the thread's pull requests. Stored in `mode_thread_linear_issues`, a table the
  server creates itself in the shared database; T3 Code never reads it.
- **No database migrations.** Never add one in the fork: upstream's next migration would reuse the id
  and be skipped silently. Diff guides cache on disk under `~/.t3/caches/diff-guides` instead, and Mode-only
  tables are created with `CREATE TABLE IF NOT EXISTS` under a `mode_` prefix.

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
