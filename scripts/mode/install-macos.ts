#!/usr/bin/env node
// Build Mode for this Mac, sign it with a local Developer ID / Apple Development
// identity, and install it to /Applications/Mode.app.
//
// The stock build stays unsigned (official signing needs T3's team, passkey
// entitlements and provisioning profile). Signing afterwards with any identity in
// the login keychain gives the app a stable designated requirement, so keychain
// (safeStorage) and privacy (TCC) grants survive rebuilds. Locally built apps are
// never quarantined, so notarization is not needed on this machine.
//
// Usage: node scripts/mode/install-macos.ts [--skip-build] [--identity <name|sha1>] [--no-launch]
//                                           [--no-publish]
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - A plain Node script, outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { sign } from "@electron/osx-sign";

const repoRoot = NodePath.resolve(NodeURL.fileURLToPath(new URL("../..", import.meta.url)));
const outputDir = NodePath.join(repoRoot, "release", "mode");
const installPath = "/Applications/Mode.app";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function run(command: string, commandArgs: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) {
  const result = NodeChildProcess.spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
  }
}

function capture(command: string, commandArgs: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync(command, commandArgs, { encoding: "utf8" });
  return `${result.stdout}${result.stderr}`;
}

function resolveIdentity(): string {
  const requested = option("--identity");
  if (requested) return requested;
  const identities = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
  for (const prefix of ["Developer ID Application:", "Apple Development:"]) {
    const match = identities.match(new RegExp(`"(${prefix}[^"]+)"`));
    if (match) return match[1]!;
  }
  throw new Error("No Developer ID Application or Apple Development identity in the keychain.");
}

const identity = resolveIdentity();
console.log(`Signing identity: ${identity}`);

if (!flag("--skip-build")) {
  // T3 Connect needs the public Clerk/relay identifiers baked in at build time.
  if (!NodeFS.existsSync(NodePath.join(repoRoot, ".env"))) {
    NodeFS.copyFileSync(NodePath.join(repoRoot, ".env.example"), NodePath.join(repoRoot, ".env"));
    console.log("Created .env from .env.example (public T3 Connect identifiers).");
  }
  NodeFS.rmSync(outputDir, { recursive: true, force: true });
  // Package versions lag the release; upstream stamps the tag's version at release time. Match it
  // so clients and T3 Connect see the same version as the official build of this base.
  const upstreamTag = capture("git", [
    "-C",
    repoRoot,
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*.[0-9]*.[0-9]*",
    "--exclude",
    "*-*",
  ]).trim();
  const buildVersion = /^v(\d+\.\d+\.\d+)$/.exec(upstreamTag)?.[1];
  // The server and web bundles read their own package.json version, so align them the way the
  // release workflow does, and put the files back afterwards.
  const versionedPackages = [
    "apps/desktop/package.json",
    "apps/server/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
  ];
  if (buildVersion) run("node", ["scripts/update-release-package-versions.ts", buildVersion]);
  try {
    run(
      "node",
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "mac",
        "--target",
        "zip",
        "--output-dir",
        outputDir,
        ...(buildVersion ? ["--build-version", buildVersion] : []),
      ],
      {
        // No update feed: Mode must never auto-update to an official T3 Code release.
        GITHUB_REPOSITORY: "",
        T3CODE_DESKTOP_UPDATE_REPOSITORY: "",
        T3CODE_DESKTOP_SIGNED: "false",
      },
    );
  } finally {
    if (buildVersion) run("git", ["checkout", "--", ...versionedPackages]);
  }
}

const zip = NodeFS.readdirSync(outputDir).find((name) => name.endsWith(".zip"));
if (!zip) throw new Error(`No .zip artifact in ${outputDir}`);

const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mode-install-"));
run("ditto", ["-x", "-k", NodePath.join(outputDir, zip), workDir]);
const appPath = NodePath.join(workDir, "Mode.app");
if (!NodeFS.existsSync(appPath)) throw new Error(`Mode.app not found in ${zip}`);

const entitlementsPath = NodePath.join(workDir, "entitlements.plist");
NodeFS.writeFileSync(
  entitlementsPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
`,
);

console.log("Signing Mode.app...");
await sign({
  app: appPath,
  identity,
  platform: "darwin",
  preAutoEntitlements: false,
  batchCodesignCalls: true,
  optionsForFile: () => ({
    hardenedRuntime: true,
    entitlements: entitlementsPath,
  }),
});
run("codesign", ["--verify", "--deep", "--strict", "--verbose=1", appPath]);

if (capture("pgrep", ["-f", `${installPath}/Contents/MacOS/`]).trim()) {
  console.log("Quitting the running Mode...");
  NodeChildProcess.spawnSync("osascript", ["-e", 'tell application id "lol.mati.mode" to quit']);
  // Quitting can wait on a confirmation when tasks are running. Never replace a running bundle.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (!capture("pgrep", ["-f", `${installPath}/Contents/MacOS/`]).trim()) break;
    NodeChildProcess.spawnSync("sleep", ["0.2"]);
  }
  if (capture("pgrep", ["-f", `${installPath}/Contents/MacOS/`]).trim()) {
    throw new Error(`Mode did not quit; the new build is still at ${appPath}.`);
  }
}

NodeFS.rmSync(installPath, { recursive: true, force: true });
run("ditto", [appPath, installPath]);
NodeFS.rmSync(workDir, { recursive: true, force: true });
console.log(`Installed ${installPath}`);

// Sprites install the server this build just made, so a new build reaches them on their next
// update. A failed upload leaves the local install alone.
if (!flag("--skip-build") && !flag("--no-publish")) {
  try {
    run("node", ["scripts/mode/publish-server.ts"]);
  } catch (error) {
    console.warn(`Could not publish the server for sprites: ${String(error)}`);
  }
}

if (!flag("--no-launch")) {
  // A terminal inside T3 Code or Mode inherits ELECTRON_RUN_AS_NODE, which would start the app as
  // plain Node and exit at once.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const opened = NodeChildProcess.spawnSync("open", [installPath], { stdio: "inherit", env });
  if (opened.status !== 0) throw new Error(`open ${installPath} exited with ${opened.status}`);
}
