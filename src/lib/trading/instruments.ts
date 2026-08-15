/**
 * Canonical instrument definitions.
 *
 * Chart symbols and broker symbols are not the same thing, so every tradable
 * instrument is described once here: the market-data symbol used for candles,
 * the broker symbol used for execution, and the contract maths (tick size,
 * tick value, multiplier) needed for risk and P&L.
 *
 * Crypto (Binance) is the only provider with real data today. Futures roots are
 * declared so the OMS/risk maths already work, but they are marked
 * `dataAvailable: false` — nothing fabricates prices for them.
 */

export type AssetClass = "crypto" | "futures" | "equity" | "fx";

export type Instrument = {
  /** Signal Goat canonical id, e.g. "BINANCE:BTCUSDT" or "CME:NQ". */
  id: string;
  root: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  /** Symbol used against the market-data provider. */
  dataSymbol: string;
  dataProvider: "binance" | "none";
  /** Symbol used against the broker adapter (may differ from dataSymbol). */
  brokerSymbol: string | null;
  contract?: string;
  expiration?: string;
  tickSize: number;
  tickValue: number;
  multiplier: number;
  currency: string;
  qtyStep: number;
  dataAvailable: boolean;
};

const crypto = (
  root: string,
  name: string,
  tickSize: number,
  qtyStep: number,
): Instrument => ({
  id: `BINANCE:${root}`,
  root,
  name,
  assetClass: "crypto",
  exchange: "BINANCE",
  dataSymbol: root,
  dataProvider: "binance",
  brokerSymbol: root,
  tickSize,
  tickValue: tickSize,
  multiplier: 1,
  currency: "USD",
  qtyStep,
  dataAvailable: true,
});

const future = (
  root: string,
  name: string,
  exchange: string,
  tickSize: number,
  tickValue: number,
): Instrument => ({
  id: `${exchange}:${root}`,
  root,
  name,
  assetClass: "futures",
  exchange,
  dataSymbol: root,
  dataProvider: "none",
  brokerSymbol: root,
  tickSize,
  tickValue,
  multiplier: tickValue / tickSize,
  currency: "USD",
  qtyStep: 1,
  dataAvailable: false,
});

export const INSTRUMENTS: Instrument[] = [
  crypto("BTCUSDT", "Bitcoin / TetherUS", 0.1, 0.0001),
  crypto("ETHUSDT", "Ethereum / TetherUS", 0.01, 0.001),
  crypto("SOLUSDT", "Solana / TetherUS", 0.01, 0.01),
  crypto("BNBUSDT", "BNB / TetherUS", 0.01, 0.01),
  crypto("XRPUSDT", "XRP / TetherUS", 0.0001, 1),
  future("NQ", "E-mini Nasdaq 100", "CME", 0.25, 5),
  future("ES", "E-mini S&P 500", "CME", 0.25, 12.5),
  future("MNQ", "Micro E-mini Nasdaq 100", "CME", 0.25, 0.5),
  future("MES", "Micro E-mini S&P 500", "CME", 0.25, 1.25),
  future("CL", "Crude Oil", "NYMEX", 0.01, 10),
  future("GC", "Gold", "COMEX", 0.1, 10),
];

/** Fallback instrument for any crypto pair not explicitly listed. */
function genericCrypto(symbol: string): Instrument {
  return crypto(symbol, symbol, 0.01, 0.0001);
}

export function getInstrument(symbol: string): Instrument {
  const s = symbol.toUpperCase();
  return (
    INSTRUMENTS.find((i) => i.root === s || i.id === s || i.dataSymbol === s) ??
    genericCrypto(s)
  );
}

/** Money value of a price move for one unit/contract. */
export function pnlPerUnit(inst: Instrument, priceDelta: number): number {
  if (inst.assetClass === "futures") {
    return (priceDelta / inst.tickSize) * inst.tickValue;
  }
  return priceDelta * inst.multiplier;
}

export function ticksToPrice(inst: Instrument, ticks: number): number {
  return ticks * inst.tickSize;
}

export function roundToTick(inst: Instrument, price: number): number {
  const t = inst.tickSize || 0.01;
  return Math.round(price / t) * t;
}
