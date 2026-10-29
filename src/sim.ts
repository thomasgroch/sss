// Pure simulation model. No DOM, no runtime imports. All money in the output is BRL unless suffixed Usd.

export interface SimInput {
  users: number; // 100 .. 1_000_000
  conversion: number; // % of paying users
  priceBrl: number; // BRL per month per subscriber
  fx: number; // BRL per USD, only for the secondary USD figures
  fixedCostsBrl: number; // BRL per month: team, tools, marketing
  variablePct: number; // % of revenue: payment fees + infra that scales with usage
  growthPct: number; // monthly user growth, % (drives the time projection)
  buildMonths: number; // months building before launch: zero users, fixed costs still due
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
  priceBrl: { min: 10, max: 500, step: 5 },
  fx: { min: 1, max: 10, step: 0.01 },
  fixedCostsBrl: { min: 0, max: 1_000_000, step: 500 },
  variablePct: { min: 0, max: 60, step: 1 },
  growthPct: { min: 0, max: 30, step: 0.5 },
  buildMonths: { min: 0, max: 18, step: 1 }
} as const;

/** Months shown in the time projection: two years after launch. */
export function horizon(i: SimInput): number {
  return i.buildMonths + 24;
}

export const DEFAULTS: SimInput = {
  users: 10_000,
  conversion: 5,
  priceBrl: 80,
  fx: 5.4,
  fixedCostsBrl: 15_000,
  variablePct: 12,
  growthPct: 8,
  buildMonths: 3
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
  const priceBrl = i.priceBrl;
  const mrr = payingUsers * priceBrl;
  const mrrUsd = mrr / i.fx;
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
    arrUsd: (mrr * 12) / i.fx,
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

/** Users at `month`: zero while building, then compound growth from the launch base, capped at the limit. */
export function usersAt(i: SimInput, month: number): number {
  if (month < i.buildMonths) return 0;
  return Math.min(LIMITS.users.max, Math.round(i.users * Math.pow(1 + i.growthPct / 100, month - i.buildMonths)));
}

/** Fractional month at which the base reaches `users`, or null when unreachable (no growth or below the launch base). */
export function monthFor(i: SimInput, users: number): number | null {
  if (users <= 0) return null;
  if (users === i.users) return i.buildMonths;
  if (i.growthPct <= 0 || users < i.users) return null;
  return i.buildMonths + Math.log(users / i.users) / Math.log(1 + i.growthPct / 100);
}

export interface TimelinePoint { m: number; users: number; net: number; cash: number }

/** Month-by-month projection with cumulative cash. Building months burn fixed costs with no revenue. */
export function timeline(i: SimInput): { points: TimelinePoint[]; investment: number; paybackMonth: number | null } {
  const points: TimelinePoint[] = [];
  let cash = 0, paybackMonth: number | null = null;
  for (let m = 0; m <= horizon(i); m++) {
    const users = usersAt(i, m);
    const net = users > 0 ? simulate({ ...i, users }).net : -i.fixedCostsBrl;
    cash += net;
    points.push({ m, users, net, cash });
    if (paybackMonth === null && m > 0 && cash >= 0 && points[m - 1].cash < 0) paybackMonth = m;
  }
  return { points, investment: i.buildMonths * i.fixedCostsBrl, paybackMonth };
}
