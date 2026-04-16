# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

### Local macOS fork install

If you want this repo installed as a separate local macOS app bundle without changing the desktop branding in source, run:

```bash
bun run install:desktop:fork:macos
```

That command builds a macOS zip artifact, patches the outer app bundle plus Electron helper bundle names so the fork launches correctly, ad-hoc signs it, and installs `T3 Code (fork).app` into `/Applications` (or `~/Applications` if `/Applications` is not writable).

To reuse an existing macOS zip artifact instead of rebuilding:

```bash
bun run install:desktop:fork:macos -- --zip path/to/T3-Code-<version>-<arch>.zip
```

This is intentionally a post-build patch. It keeps the runtime branding and Application Support behavior from source unless you explicitly change the desktop app code too.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
