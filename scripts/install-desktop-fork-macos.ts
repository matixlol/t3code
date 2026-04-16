#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  accessSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { constants as FsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type BuildArch = "arm64" | "x64" | "universal";

interface CliOptions {
  readonly zipPath: string | undefined;
  readonly arch: BuildArch;
  readonly appName: string;
  readonly bundleId: string;
  readonly installDir: string | undefined;
  readonly outputDir: string | undefined;
}

const DEFAULT_APP_NAME = "T3 Code (fork)";
const BUILD_ARCHES = new Set<BuildArch>(["arm64", "x64", "universal"]);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function printUsage(): void {
  console.log(`Usage: node scripts/install-desktop-fork-macos.ts [options]

Build or reuse a local macOS desktop zip artifact, patch the Electron app bundle
and helper bundles so it can be installed as a separate forked app, then install it.

Options:
  --zip <path>          Reuse an existing macOS zip artifact instead of building one
  --arch <arch>         Build arch when --zip is omitted (arm64, x64, universal)
  --app-name <name>     Installed app name (default: ${DEFAULT_APP_NAME})
  --bundle-id <id>      Bundle id override (default derived from app name)
  --install-dir <path>  Install target directory (default: /Applications or ~/Applications)
  --output-dir <path>   Artifact output directory when building (default: temporary dir)
  --help                Show this message
`);
}

function fail(message: string): never {
  throw new Error(message);
}

function resolveDefaultBuildArch(): BuildArch {
  if (process.arch === "arm64") {
    return "arm64";
  }

  if (process.arch === "x64") {
    return "x64";
  }

  return fail(
    `Unsupported host arch '${process.arch}'. Pass --arch arm64, --arch x64, or --arch universal explicitly.`,
  );
}

function toBundleIdSegment(appName: string): string {
  const trimmed = appName.replace(/^T3 Code/i, "").trim();
  const normalized = trimmed
    .replace(/[()]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "fork";
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let zipPath: string | undefined;
  let arch: BuildArch = resolveDefaultBuildArch();
  let appName = DEFAULT_APP_NAME;
  let bundleId: string | undefined;
  let installDir: string | undefined;
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const next = (): string => {
      const value = argv[index + 1];
      if (!value) {
        return fail(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h": {
        printUsage();
        process.exit(0);
      }
      case "--zip": {
        zipPath = resolve(next());
        break;
      }
      case "--arch": {
        const candidate = next() as BuildArch;
        if (!BUILD_ARCHES.has(candidate)) {
          fail(`Unsupported build arch '${candidate}'. Expected one of: arm64, x64, universal.`);
        }
        arch = candidate;
        break;
      }
      case "--app-name": {
        appName = next().trim();
        if (!appName) {
          fail("--app-name must not be empty.");
        }
        break;
      }
      case "--bundle-id": {
        bundleId = next().trim();
        if (!bundleId) {
          fail("--bundle-id must not be empty.");
        }
        break;
      }
      case "--install-dir": {
        installDir = resolve(next());
        break;
      }
      case "--output-dir": {
        outputDir = resolve(next());
        break;
      }
      default: {
        fail(`Unknown argument '${arg}'. Use --help for usage.`);
      }
    }
  }

  return {
    zipPath,
    arch,
    appName,
    bundleId: bundleId ?? `com.t3tools.t3code.${toBundleIdSegment(appName)}`,
    installDir,
    outputDir,
  };
}

function runChecked(command: string, args: ReadonlyArray<string>, cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function tryRun(command: string, args: ReadonlyArray<string>): void {
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: "ignore",
  });
}

function getPlistString(plistPath: string, key: string): string {
  return runChecked("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
}

function setPlistString(plistPath: string, key: string, value: string): void {
  const replace = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replace.status === 0) {
    return;
  }

  const insert = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insert.status === 0) {
    return;
  }

  const details = [replace.stderr, insert.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key '${key}' at ${plistPath}: ${details}`.trim());
}

function resolveHelperBundleId(bundleId: string, suffix: string): string {
  const normalizedSuffix = suffix
    .replace(/[()]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedSuffix ? `${bundleId}.helper.${normalizedSuffix}` : `${bundleId}.helper`;
}

function renameIfNeeded(sourcePath: string, targetPath: string): void {
  if (sourcePath === targetPath || !existsSync(sourcePath)) {
    return;
  }

  renameSync(sourcePath, targetPath);
}

function patchMacAppBundle(appBundlePath: string, appName: string, bundleId: string): void {
  const mainPlistPath = join(appBundlePath, "Contents", "Info.plist");
  const mainMacOsDir = join(appBundlePath, "Contents", "MacOS");
  const oldMainExecutable = getPlistString(mainPlistPath, "CFBundleExecutable");
  const newMainExecutable = appName;

  renameIfNeeded(join(mainMacOsDir, oldMainExecutable), join(mainMacOsDir, newMainExecutable));
  setPlistString(mainPlistPath, "CFBundleDisplayName", appName);
  setPlistString(mainPlistPath, "CFBundleName", appName);
  setPlistString(mainPlistPath, "CFBundleIdentifier", bundleId);
  setPlistString(mainPlistPath, "CFBundleExecutable", newMainExecutable);

  const helperPrefix = `${oldMainExecutable} Helper`;
  const frameworksDir = join(appBundlePath, "Contents", "Frameworks");
  const helperAppPaths = readdirSync(frameworksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => join(frameworksDir, entry.name));

  for (const helperAppPath of helperAppPaths) {
    const helperPlistPath = join(helperAppPath, "Contents", "Info.plist");
    const helperExecutable = getPlistString(helperPlistPath, "CFBundleExecutable");
    if (!helperExecutable.startsWith(helperPrefix)) {
      continue;
    }

    // Electron derives helper bundle paths from the main executable name. Renaming only the
    // outer app bundle causes a launch-time crash: "Unable to find helper app".
    const suffix = helperExecutable.slice(helperPrefix.length);
    const newHelperExecutable = `${appName} Helper${suffix}`;
    const newHelperBundlePath = join(frameworksDir, `${newHelperExecutable}.app`);
    const helperMacOsDir = join(helperAppPath, "Contents", "MacOS");

    renameIfNeeded(
      join(helperMacOsDir, helperExecutable),
      join(helperMacOsDir, newHelperExecutable),
    );
    setPlistString(helperPlistPath, "CFBundleDisplayName", newHelperExecutable);
    setPlistString(helperPlistPath, "CFBundleName", newHelperExecutable);
    setPlistString(helperPlistPath, "CFBundleIdentifier", resolveHelperBundleId(bundleId, suffix));
    setPlistString(helperPlistPath, "CFBundleExecutable", newHelperExecutable);
    renameIfNeeded(helperAppPath, newHelperBundlePath);
  }
}

function resolveInstallDirectory(installDirOverride: string | undefined): string {
  if (installDirOverride) {
    mkdirSync(installDirOverride, { recursive: true });
    return installDirOverride;
  }

  const systemApplications = "/Applications";
  try {
    accessSync(systemApplications, FsConstants.W_OK);
    return systemApplications;
  } catch {
    const userApplications = join(homedir(), "Applications");
    mkdirSync(userApplications, { recursive: true });
    return userApplications;
  }
}

function findNewestZip(outputDir: string): string {
  const zipEntries = readdirSync(outputDir)
    .filter((entry) => entry.endsWith(".zip"))
    .map((entry) => ({
      path: join(outputDir, entry),
      mtimeMs: statSync(join(outputDir, entry)).mtimeMs,
    }))
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = zipEntries[0]?.path;
  if (!latest) {
    fail(`No .zip artifact found in ${outputDir}`);
  }

  return latest;
}

function extractFirstAppBundle(stageDir: string): string {
  const appPath = readdirSync(stageDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => join(stageDir, entry.name))[0];

  if (!appPath) {
    fail(`No .app bundle found in extracted artifact at ${stageDir}`);
  }

  return appPath;
}

function buildArtifactZip(options: CliOptions, tempDirs: Array<string>): string {
  const outputDir =
    options.outputDir ?? mkdtempSync(join(tmpdir(), "t3code-desktop-fork-build-output-"));

  if (!options.outputDir) {
    tempDirs.push(outputDir);
  } else {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`[desktop-fork] Building macOS zip artifact (arch=${options.arch})...`);
  runChecked(
    process.execPath,
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "zip",
      "--arch",
      options.arch,
      "--output-dir",
      outputDir,
    ],
    repoRoot,
  );

  return findNewestZip(outputDir);
}

function installForkedApp(options: CliOptions): string {
  const tempDirs: Array<string> = [];
  let completed = false;

  try {
    const zipPath = options.zipPath ?? buildArtifactZip(options, tempDirs);
    if (!existsSync(zipPath)) {
      fail(`Zip artifact not found: ${zipPath}`);
    }

    const stageDir = mkdtempSync(join(tmpdir(), "t3code-desktop-fork-stage-"));
    tempDirs.push(stageDir);

    console.log(`[desktop-fork] Extracting ${zipPath}...`);
    runChecked("ditto", ["-x", "-k", zipPath, stageDir]);

    const extractedAppPath = extractFirstAppBundle(stageDir);
    const targetStageAppPath = join(stageDir, `${options.appName}.app`);
    renameIfNeeded(extractedAppPath, targetStageAppPath);

    console.log(`[desktop-fork] Patching bundle metadata for ${options.appName}...`);
    patchMacAppBundle(targetStageAppPath, options.appName, options.bundleId);

    console.log(`[desktop-fork] Ad-hoc signing ${options.appName}.app...`);
    runChecked("codesign", ["--force", "--deep", "--sign", "-", targetStageAppPath]);

    const installDir = resolveInstallDirectory(options.installDir);
    const installPath = join(installDir, `${options.appName}.app`);

    console.log(`[desktop-fork] Installing to ${installPath}...`);
    rmSync(installPath, { recursive: true, force: true });
    runChecked("ditto", [targetStageAppPath, installPath]);
    tryRun("xattr", ["-dr", "com.apple.quarantine", installPath]);

    completed = true;
    return installPath;
  } catch (error) {
    const tempDetails =
      tempDirs.length > 0
        ? `\nTemporary paths kept for inspection:\n- ${tempDirs.join("\n- ")}`
        : "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${tempDetails}`, {
      cause: error,
    });
  } finally {
    if (completed) {
      for (const tempDir of tempDirs) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}

function main(): void {
  if (process.platform !== "darwin") {
    fail("This installer only supports macOS.");
  }

  const options = parseArgs(process.argv.slice(2));
  const installPath = installForkedApp(options);

  console.log(`
[desktop-fork] Installed:
- ${installPath}
- bundle id: ${options.bundleId}

This is a post-build patched install. It keeps the existing runtime branding and
user-data behavior from source unless you explicitly change the desktop app code.
`);
}

main();
