import { bestMatchingPlot } from "../helpers.mjs";

export const category = "language-features";
export const description =
  "Uses barstate.isconfirmed and barstate.islast — actively taught to the AI by pine-playbooks.ts's generation prompt (e.g. 'gate drawing on barstate.isconfirmed'), but there is zero support for `barstate` anywhere in the SGScript runtime's sandboxed scope. Same shape of risk as the alertcondition bug: if a translation ever emits a literal barstate.* reference, the script throws ReferenceError instead of degrading gracefully. This fixture's main value is the runtimeOk stage (does it crash at all) — the checks below just confirm the surviving output still looks reasonable, since barstate.isconfirmed is trivially true for every bar in a historical replay anyway (there is no live/forming bar here), so dropping it is a legitimate, not just graceful, translation.";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const expectedSma = ref.sma(closes, 20);

  const match = bestMatchingPlot(result.plots, bars, expectedSma, SAMPLES, 2);
  if (!match) issues.push("no plot matches SMA(20) within 2% at sample bars");

  return issues;
}
