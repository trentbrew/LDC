import Decimal from "decimal.js";

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

export function D(x: number | string | Decimal): Decimal {
  return x instanceof Decimal ? x : new Decimal(x as any);
}

export function truncateTo(x: Decimal, places = 5): Decimal {
  const f = new Decimal(10).pow(places);
  return x.mul(f).floor().div(f);
}

export { Decimal };

