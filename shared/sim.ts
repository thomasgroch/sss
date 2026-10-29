// Pure simulation model. No DOM, no runtime imports.

export interface SimInput {
  users: number; // 100 .. 1_000_000
  conversion: number; // % of paying users, 0.1 .. 100
  price: number; // USD per month, 5 .. 50
  fx: number; // BRL per USD
  fixedCosts: number; // USD per month (team, tools)
  costPerUser: number; // USD per month per user (infra)
  feePct: number; // payment processing %, applied to gross
}

export interface SimOutput {
  payingUsers: number;
  mrrUsd: number;
  mrrBrl: number;
  arrUsd: number;
  arrBrl: number;
  infraCost: number;
  feeCost: number;
  totalCosts: number;
  netUsd: number;
  netBrl: number;
  netAnnualUsd: number;
  netAnnualBrl: number;
  margin: number; // %
  breakEvenUsers: number | null; // users needed for net >= 0 at current params
}

export const LIMITS = {
  users: { min: 100, max: 1_000_000 },
  conversion: { min: 0.1, max: 100, step: 0.1 },
  price: { min: 5, max: 50, step: 1 },
  fx: { min: 1, max: 10, step: 0.01 },
  fixedCosts: { min: 0, max: 200_000, step: 100 },
  costPerUser: { min: 0, max: 5, step: 0.01 },
  feePct: { min: 0, max: 15, step: 0.1 }
} as const;

export const DEFAULTS: SimInput = {
  users: 10_000,
  conversion: 5,
  price: 15,
  fx: 5.4,
  fixedCosts: 3_000,
  costPerUser: 0.05,
  feePct: 3.5
};

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

// Log scale helpers so the user slider feels even from 100 to 1M.
const LOG_MIN = Math.log10(LIMITS.users.min);
const LOG_MAX = Math.log10(LIMITS.users.max);

export function usersToSlider(users: number): number {
  const t = (Math.log10(clamp(users, LIMITS.users.min, LIMITS.users.max)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return Math.round(t * 1000);
}

export function sliderToUsers(pos: number): number {
  const t = clamp(pos, 0, 1000) / 1000;
  const raw = Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
  // Round to a "nice" number of significant digits for readability.
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return clamp(Math.round(raw / magnitude) * magnitude, LIMITS.users.min, LIMITS.users.max);
}

export function simulate(i: SimInput): SimOutput {
  const payingUsers = Math.round(i.users * (i.conversion / 100));
  const mrrUsd = payingUsers * i.price;
  const arrUsd = mrrUsd * 12;
  const infraCost = i.users * i.costPerUser;
  const feeCost = mrrUsd * (i.feePct / 100);
  const totalCosts = i.fixedCosts + infraCost + feeCost;
  const netUsd = mrrUsd - totalCosts;
  const margin = mrrUsd > 0 ? (netUsd / mrrUsd) * 100 : 0;

  // net(u) = u*c*p*(1-f) - fixed - u*cpu  => u = fixed / (c*p*(1-f) - cpu)
  const perUserNet = (i.conversion / 100) * i.price * (1 - i.feePct / 100) - i.costPerUser;
  const breakEvenUsers = perUserNet > 0 ? Math.ceil(i.fixedCosts / perUserNet) : null;

  return {
    payingUsers,
    mrrUsd,
    mrrBrl: mrrUsd * i.fx,
    arrUsd,
    arrBrl: arrUsd * i.fx,
    infraCost,
    feeCost,
    totalCosts,
    netUsd,
    netBrl: netUsd * i.fx,
    netAnnualUsd: netUsd * 12,
    netAnnualBrl: netUsd * 12 * i.fx,
    margin,
    breakEvenUsers
  };
}
