import { describe, expect, it } from "vite-plus/test";

import { usageWindows } from "./SpriteHost.ts";

describe("usageWindows", () => {
  it("prices only the hours inside each window", () => {
    const now = Date.parse("2026-10-20T12:30:00Z");
    const [day, week, month] = usageWindows(
      {
        since: "2026-09-01T00:00:00.000Z",
        hours: {
          "2026-10-20T12": { cpuSeconds: 3600, gbSeconds: 3600 },
          "2026-10-15T00": { cpuSeconds: 7200, gbSeconds: 0 },
          "2026-09-01T00": { cpuSeconds: 3600, gbSeconds: 3600 },
        },
      },
      now,
    );
    expect(day).toMatchObject({ days: 1, cpuHours: 1, memoryGbHours: 1 });
    expect(day!.usd).toBeCloseTo(0.07 + 0.04375);
    expect(week).toMatchObject({ days: 7, cpuHours: 3, memoryGbHours: 1 });
    expect(month).toMatchObject({ days: 30, cpuHours: 3 });
  });
});
