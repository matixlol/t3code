/**
 * A sprite pauses ~15s after its last HTTP request, freezing agents, so this holds a sprite task
 * while runs are active. It also meters compute from the cgroup counters Fly bills by (CPU time,
 * memory per awake minute); paused time is neither billed nor counted.
 */
// @effect-diagnostics nodeBuiltinImport:off
// The sprite's API is HTTP over a unix socket, which Effect's HTTP client does not dial.
import type { SpriteUsage, SpriteUsageWindow } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeHttp from "node:http";

import * as ServerConfig from "../config.ts";

const SPRITE_API_SOCKET = "/.sprite/api.sock";
const KEEP_AWAKE_TASK = "mode-agents";
const CGROUP = "/sys/fs/cgroup";

/** Fly's published sprite rates. */
const USD_PER_CPU_HOUR = 0.07;
const USD_PER_GB_HOUR = 0.04375;

/** Hourly buckets older than this are dropped. */
const RETAIN_DAYS = 31;
const USAGE_WINDOWS = [1, 7, 30] as const;

export class SpriteHost extends Context.Service<
  SpriteHost,
  { readonly usage: Effect.Effect<SpriteUsage> }
>()("t3/sprite/SpriteHost") {}

const UsageBucket = Schema.Struct({ cpuSeconds: Schema.Number, gbSeconds: Schema.Number });
const UsageFile = Schema.Struct({
  since: Schema.String,
  /** Keyed by ISO hour, `2026-10-20T21`. */
  hours: Schema.Record(Schema.String, UsageBucket),
});
type UsageFile = typeof UsageFile.Type;
const UsageFileJson = Schema.fromJsonString(UsageFile);
const decodeUsageFile = Schema.decodeUnknownEffect(UsageFileJson);
const encodeUsageFile = Schema.encodeEffect(UsageFileJson);

/** The ISO hour an instant falls in, which keys the usage buckets. */
const isoHour = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis)).slice(0, 13);

function spriteApi(method: string, path: string, body?: unknown): Promise<number> {
  return new Promise((resolve) => {
    const req = NodeHttp.request(
      {
        socketPath: SPRITE_API_SOCKET,
        method,
        path,
        headers: { "Content-Type": "application/json", Host: "sprite" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", () => resolve(0));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

export function usageWindows(file: UsageFile, nowMillis: number): ReadonlyArray<SpriteUsageWindow> {
  return USAGE_WINDOWS.map((days) => {
    const cutoff = isoHour(nowMillis - days * 86_400_000);
    let cpuSeconds = 0;
    let gbSeconds = 0;
    for (const [hour, bucket] of Object.entries(file.hours)) {
      if (hour < cutoff) continue;
      cpuSeconds += bucket.cpuSeconds;
      gbSeconds += bucket.gbSeconds;
    }
    const cpuHours = cpuSeconds / 3600;
    const memoryGbHours = gbSeconds / 3600;
    return {
      days,
      cpuHours,
      memoryGbHours,
      usd: cpuHours * USD_PER_CPU_HOUR + memoryGbHours * USD_PER_GB_HOUR,
    };
  });
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const onSprite = yield* fileSystem
    .exists(SPRITE_API_SOCKET)
    .pipe(Effect.orElseSucceed(() => false));
  const usagePath = path.join(config.stateDir, "mode-sprite-usage.json");
  const loadUsage = fileSystem.readFileString(usagePath).pipe(
    Effect.flatMap(decodeUsageFile),
    Effect.orElseSucceed(() => null),
  );
  const readCpuMicros = fileSystem.readFileString(path.join(CGROUP, "cpu.stat")).pipe(
    Effect.map((text) => {
      const line = text.split("\n").find((entry) => entry.startsWith("usage_usec "));
      return line === undefined ? null : Number(line.split(" ")[1]);
    }),
    Effect.orElseSucceed(() => null),
  );
  const readMemoryBytes = fileSystem.readFileString(path.join(CGROUP, "memory.current")).pipe(
    Effect.map((text) => Number(text.trim())),
    Effect.orElseSucceed(() => null),
  );

  if (onSprite) {
    const sql = yield* SqlClient.SqlClient;
    const holding = yield* Ref.make(false);

    // Every ten seconds, so a run started just before the last client leaves is still covered
    // before the sprite's own idle timer pauses it.
    const keepAwake = Effect.gen(function* () {
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_v2_projection_runs
        WHERE status IN ('preparing', 'starting', 'running')
      `.pipe(Effect.orElseSucceed(() => [{ n: 0 }]));
      const active = (rows[0]?.n ?? 0) > 0;
      const held = yield* Ref.get(holding);
      if (active) {
        yield* Effect.promise(() =>
          spriteApi("PUT", "/v1/tasks", { name: KEEP_AWAKE_TASK, expire: "2m" }),
        );
        yield* Ref.set(holding, true);
      } else if (held) {
        yield* Effect.promise(() => spriteApi("DELETE", `/v1/tasks/${KEEP_AWAKE_TASK}`));
        yield* Ref.set(holding, false);
      }
    });
    yield* keepAwake.pipe(Effect.repeat(Schedule.spaced("10 seconds")), Effect.forkScoped);

    const last = yield* Ref.make<{ readonly cpuMicros: number; readonly at: number } | null>(null);
    const sample = Effect.gen(function* () {
      const cpuMicros = yield* readCpuMicros;
      const memory = yield* readMemoryBytes;
      if (cpuMicros === null || memory === null) return;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const previous = yield* Ref.getAndSet(last, { cpuMicros, at: now });
      if (previous === null) return;
      // A gap longer than a sample is time spent paused, which Fly does not bill.
      const awakeSeconds = Math.min((now - previous.at) / 1000, 90);
      const file = (yield* loadUsage) ?? {
        since: DateTime.formatIso(DateTime.makeUnsafe(now)),
        hours: {},
      };
      const hour = isoHour(now);
      const bucket = file.hours[hour] ?? { cpuSeconds: 0, gbSeconds: 0 };
      const oldest = isoHour(now - RETAIN_DAYS * 86_400_000);
      const hours = Object.fromEntries(
        Object.entries({
          ...file.hours,
          [hour]: {
            cpuSeconds: bucket.cpuSeconds + Math.max(0, cpuMicros - previous.cpuMicros) / 1e6,
            gbSeconds: bucket.gbSeconds + (memory / 1024 ** 3) * awakeSeconds,
          },
        }).filter(([key]) => key >= oldest),
      );
      const encoded = yield* encodeUsageFile({ since: file.since, hours });
      yield* fileSystem.writeFileString(usagePath, encoded);
    }).pipe(Effect.ignoreCause);
    yield* sample.pipe(Effect.repeat(Schedule.spaced("60 seconds")), Effect.forkScoped);
  }

  return SpriteHost.of({
    usage: Effect.gen(function* () {
      if (!onSprite) return { available: false, since: null, windows: [] };
      const file = yield* loadUsage;
      if (file === null) return { available: true, since: null, windows: [] };
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      return { available: true, since: file.since, windows: usageWindows(file, now) };
    }),
  });
});

export const layer = Layer.effect(SpriteHost, make);
