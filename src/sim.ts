// Pure simulation model. No DOM, no runtime imports. All money in the output is BRL unless suffixed Usd.

export interface SimInput {
  users: number; // 100 .. 1_000_000
  conversion: number; // % of paying users
  priceUsd: number; // USD per month, 5 .. 50
  fx: number; // BRL per USD
  fixedCostsBrl: number; // BRL per month: team, tools, marketing
  variablePct: number; // % of revenue: payment fees + infra that scales with usage
}

export interface SimOutput {
  payingUsers: number;
  priceBrl: number;
  mrr: number;
  mrrUsd: number;
  arr: number;
  arrUsd: number;
  variableCosts: number;
  totalCosts: number;
  net: number;
  netUsd: number;
  netAnnual: number;
  netAnnualUsd: number;
  margin: number; // % of revenue
  breakEvenUsers: number | null;
}

export const LIMITS = {
  users: { min: 100, max: 1_000_000 },
  conversion: { min: 0.1, max: 100, step: 0.1 },
  priceUsd: { min: 5, max: 50, step: 1 },
  fx: { min: 1, max: 10, step: 0.01 },
  fixedCostsBrl: { min: 0, max: 1_000_000, step: 500 },
  variablePct: { min: 0, max: 60, step: 1 }
} as const;

export const DEFAULTS: SimInput = {
  users: 10_000,
  conversion: 5,
  priceUsd: 15,
  fx: 5.4,
  fixedCostsBrl: 15_000,
  variablePct: 12
};

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

const LOG_MIN = Math.log10(LIMITS.users.min);
const LOG_MAX = Math.log10(LIMITS.users.max);

export function usersToSlider(users: number): number {
  const t = (Math.log10(clamp(users, LIMITS.users.min, LIMITS.users.max)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return Math.round(t * 1000);
}

export function sliderToUsers(pos: number): number {
  const t = clamp(pos, 0, 1000) / 1000;
  const raw = Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return clamp(Math.round(raw / magnitude) * magnitude, LIMITS.users.min, LIMITS.users.max);
}

export function simulate(i: SimInput): SimOutput {
  const payingUsers = Math.round(i.users * (i.conversion / 100));
  const priceBrl = i.priceUsd * i.fx;
  const mrrUsd = payingUsers * i.priceUsd;
  const mrr = mrrUsd * i.fx;
  const variableCosts = mrr * (i.variablePct / 100);
  const totalCosts = i.fixedCostsBrl + variableCosts;
  const net = mrr - totalCosts;
  const margin = mrr > 0 ? (net / mrr) * 100 : 0;

  // net(u) = u * c * priceBrl * (1 - v) - fixed  =>  u = fixed / (c * priceBrl * (1 - v))
  const perUserNet = (i.conversion / 100) * priceBrl * (1 - i.variablePct / 100);
  const breakEvenUsers = perUserNet > 0 ? Math.ceil(i.fixedCostsBrl / perUserNet) : null;

  return {
    payingUsers,
    priceBrl,
    mrr,
    mrrUsd,
    arr: mrr * 12,
    arrUsd: mrrUsd * 12,
    variableCosts,
    totalCosts,
    net,
    netUsd: net / i.fx,
    netAnnual: net * 12,
    netAnnualUsd: (net * 12) / i.fx,
    margin,
    breakEvenUsers
  };
}
