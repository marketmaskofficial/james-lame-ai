import { bestMatchingPlot } from "../helpers.mjs";

export const category = "language-features";
export const description =
  "table.new/table.cell and bgcolor() are explicitly documented as NOT reproduced by the renderer (SGSCRIPT_REFERENCE says so, and runtime.ts has warn() stubs for both). This fixture verifies that degradation is actually graceful end to end: the script must still run and the unrelated SMA plot must still be correct, not just that table()/bgcolor() individually don't throw in isolation. Also compounds with barstate.islast (how tables are realistically gated in real Pine), so if this fails alongside 25-barstate-usage, check that fixture first.";
export const settings = { Length: 20 };

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const expectedSma = ref.sma(closes, 20);

  const match = bestMatchingPlot(result.plots, bars, expectedSma, SAMPLES, 2);
  if (!match) issues.push("no plot matches SMA(20) within 2% at sample bars — table/bgcolor may have taken the whole script down instead of degrading gracefully");

  return issues;
}
