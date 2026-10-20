/**
 * Puts Mode's server on a sprite (run as `bash -lc` on create and update). The bundle is plain
 * JavaScript; its native modules come from upstream's npm package of the same version, which
 * carries them prebuilt for Linux.
 */

/** Where `scripts/mode/publish-server.ts` uploads the bundle and its manifest. */
const MODE_SERVER_RELEASE_URL = "https://github.com/matixlol/t3code/releases/download/mode-server";

/** The sprite service that runs Mode's server; Fly routes the sprite's URL to its port. */
const MODE_SPRITE_SERVICE = "mode";

export const MODE_SPRITE_SETUP_SCRIPT = String.raw`
set -euo pipefail
step() { echo "mode-setup: $*"; }
# The real Node directory, not the sprite's shim: npm installs global CLIs beside it, so it goes
# first and the Codex updated below wins over the sprite's preinstalled standalone one.
NODE_BIN="$(dirname "$(node -p process.execPath)")"
export PATH="$NODE_BIN:$HOME/.local/bin:$PATH"
BASE="${MODE_SERVER_RELEASE_URL}"
R="$HOME/.mode/runtime"
mkdir -p "$R" "$HOME/.mode/bin"

step "Updating Claude Code"
claude update >/dev/null 2>&1 || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 || true
step "Updating Codex"
npm i -g @openai/codex@latest >/dev/null 2>&1 || true

step "Downloading Mode's server"
curl -fsSL "$BASE/mode-server.json" -o "$R/mode-server.json"
VER="$(node -p 'require(process.argv[1]).serverVersion' "$R/mode-server.json")"
COMMIT="$(node -p 'require(process.argv[1]).commit' "$R/mode-server.json")"
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
NATIVES="$R/natives-$VER-$ARCH"
PKG="$NATIVES/node_modules/@t3code/t3-linux-$ARCH"
if [ ! -d "$PKG" ]; then
  step "Installing native modules for $VER"
  mkdir -p "$NATIVES"
  (cd "$NATIVES" && npm i --no-save --no-audit --no-fund --no-package-lock "@t3code/t3-linux-$ARCH@$VER" >/dev/null 2>&1)
fi
STAGE="$R/stage-$COMMIT"
rm -rf "$STAGE" && mkdir -p "$STAGE"
curl -fsSL "$BASE/mode-server.tar.gz" | tar -xz -C "$STAGE" 2>/dev/null
rm -rf "$R/server-$COMMIT" && mv "$STAGE/server" "$R/server-$COMMIT" && rm -rf "$STAGE"
ln -sfn "$PKG/node_modules" "$R/server-$COMMIT/node_modules"
ln -sfn "$PKG/resource-monitor" "$R/server-$COMMIT/dist/resource-monitor"
ln -sfn "$R/server-$COMMIT" "$R/current"
cat > "$HOME/.mode/bin/mode-server" <<LAUNCHER
#!/bin/sh
exec "$NODE_BIN/node" "$R/current/dist/bin.mjs" "\$@"
LAUNCHER
chmod +x "$HOME/.mode/bin/mode-server"
# Keep only the server just installed.
find "$R" -maxdepth 1 -name 'server-*' ! -name "server-$COMMIT" -exec rm -rf {} + 2>/dev/null || true

step "Starting Mode's server"
sprite-env services delete ${MODE_SPRITE_SERVICE} >/dev/null 2>&1 || true
sprite-env services create ${MODE_SPRITE_SERVICE} \
  --cmd "$HOME/.mode/bin/mode-server" \
  --args serve,--host,0.0.0.0,--port,8080,--no-browser \
  --env "PATH=$NODE_BIN:$HOME/.local/bin:/.sprite/bin:/usr/local/bin:/usr/bin:/bin,HOME=$HOME" \
  --dir "$HOME" --http-port 8080 --no-stream >/dev/null
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/.well-known/t3/environment >/dev/null 2>&1; then
    step "Ready ($COMMIT)"
    exit 0
  fi
  sleep 1
done
echo "Mode's server did not start; see /.sprite/logs/services/${MODE_SPRITE_SERVICE}.log" >&2
exit 1
`;

/** Mints a pairing credential on the sprite, offline against its database. */
export const MODE_SPRITE_PAIR_SCRIPT = String.raw`
"$HOME/.mode/bin/mode-server" auth pairing create --base-dir "$HOME/.t3" --label "Mode" --ttl 10m --json
`;
