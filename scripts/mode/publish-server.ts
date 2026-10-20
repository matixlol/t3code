#!/usr/bin/env node
// Publish Mode's server bundle for sprites: the built apps/server/dist (plain JavaScript, the
// web client included) and a manifest naming the upstream version whose prebuilt native modules
// it runs with, uploaded to the fork's rolling `mode-server` release. Sprites install it from
// there (apps/server/src/sprite/spriteSetupScript.ts). install-macos.ts runs this after a build.
//
// Usage: node scripts/mode/publish-server.ts
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - A plain Node script, outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const REPOSITORY = "matixlol/t3code";
const TAG = "mode-server";

const repoRoot = NodePath.resolve(NodeURL.fileURLToPath(new URL("../..", import.meta.url)));
const distDir = NodePath.join(repoRoot, "apps", "server", "dist");

function run(command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

function capture(command: string, args: ReadonlyArray<string>): { ok: boolean; out: string } {
  const result = NodeChildProcess.spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout.trim() };
}

if (!NodeFS.existsSync(NodePath.join(distDir, "bin.mjs"))) {
  throw new Error("apps/server/dist is not built; run scripts/mode/install-macos.ts first.");
}
const upstreamTag = capture("git", [
  "describe",
  "--tags",
  "--abbrev=0",
  "--match",
  "v[0-9]*.[0-9]*.[0-9]*",
  "--exclude",
  "*-*",
]).out;
const serverVersion = /^v(\d+\.\d+\.\d+)$/.exec(upstreamTag)?.[1];
if (!serverVersion) throw new Error(`No upstream release tag found (got "${upstreamTag}").`);
const commit = capture("git", ["rev-parse", "--short", "HEAD"]).out;

const stage = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mode-server-"));
const serverDir = NodePath.join(stage, "server");
NodeFS.mkdirSync(serverDir);
NodeFS.cpSync(distDir, NodePath.join(serverDir, "dist"), {
  recursive: true,
  // Source maps double the download and nothing on a sprite reads them.
  filter: (source) => !source.endsWith(".map"),
});
NodeFS.copyFileSync(
  NodePath.join(repoRoot, "apps", "server", "package.json"),
  NodePath.join(serverDir, "package.json"),
);
const archive = NodePath.join(stage, "mode-server.tar.gz");
// No macOS extended attributes in the archive; GNU tar on the sprite warns about each one.
run("tar", ["-C", stage, "-czf", archive, "server"], { COPYFILE_DISABLE: "1" });
const manifest = NodePath.join(stage, "mode-server.json");
NodeFS.writeFileSync(
  manifest,
  `${JSON.stringify({ serverVersion, commit, publishedAt: new Date().toISOString() }, null, 2)}\n`,
);

if (!capture("gh", ["release", "view", TAG, "--repo", REPOSITORY]).ok) {
  run("gh", [
    "release",
    "create",
    TAG,
    "--repo",
    REPOSITORY,
    "--target",
    "main",
    "--prerelease",
    "--title",
    "Mode server",
    "--notes",
    "Mode's server bundle for sprites, replaced on every build. See MODE.md.",
  ]);
}
run("gh", ["release", "upload", TAG, archive, manifest, "--repo", REPOSITORY, "--clobber"]);
console.log(`Published Mode server ${commit} (natives from ${serverVersion}).`);
