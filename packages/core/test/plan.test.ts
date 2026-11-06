import { describe, expect, it } from "vitest";
import { planRail, welcomeStepsFor } from "../src/shared/plan";
import { copyFor } from "../src/copy";

// Review CMP-01: the dashboard rail and /welkom follow the plan and its status.
describe("what a plan promises", () => {
  it("shows the monthly date and Controleer nu only for a running Vidalo Monthly", () => {
    expect(planRail({ plan: "monitor", status: "active" })).toBe("monthly");
    expect(planRail({ plan: "monitor", status: "trial" })).toBe("monthly");
    expect(planRail({ plan: "monitor", status: "paused" })).toBe("paused");
    expect(planRail({ plan: "monitor", status: "churned" })).toBe("none");
    expect(planRail({ plan: "setup", status: "active" })).toBe("scan");
    expect(planRail({ plan: "setup", status: "trial" })).toBe("scan");
    expect(planRail({ plan: "none", status: "scanned" })).toBe("none");
  });

  it("swaps /welkom's last step for Vidalo Scan", () => {
    const w = copyFor("nl").welcome;
    expect(welcomeStepsFor(w.steps, w.lastStepScan, true)).toEqual(w.steps);
    const scan = welcomeStepsFor(w.steps, w.lastStepScan, false);
    expect(scan).toHaveLength(4);
    expect(scan[3]).toBe(w.lastStepScan);
    expect(scan.map((s) => s.body).join(" ")).not.toContain("elke maand een rapport");
  });
});
