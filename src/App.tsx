import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Chart } from "./Chart";
import { GrowthChart } from "./GrowthChart";
import { DEFAULTS, LIMITS, type SimInput, clamp, simulate, sliderToUsers, usersToSlider } from "./sim";

// ---------- formatting ----------
export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
export function compact(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",")}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(".", ",")}k`;
  return int.format(n);
}

// ---------- motion ----------
/** Tweens toward `target` so numbers visibly roll into place. */
function useAnimatedNumber(target: number, duration = 450): number {
  const [display, setDisplay] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = target; setDisplay(target); return; }
    const start = performance.now(), begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration), e = 1 - Math.pow(1 - t, 3);
      from.current = begin + (target - begin) * e;
      setDisplay(from.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return display;
}

/** "up" | "down" for ~600ms after a change, to tint the card. */
function useChangeDirection(value: number): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    setDir(value > prev.current ? "up" : "down");
    prev.current = value;
    const id = setTimeout(() => setDir(null), 600);
    return () => clearTimeout(id);
  }, [value]);
  return dir;
}

// ---------- editable number (shared by controls and the fx chip) ----------
function NumberField({ value, onChange, min, max, format, label, className = "" }: {
  value: number; onChange: (v: number) => void; min: number; max: number; format: (v: number) => string; label: string; className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(n)) onChange(clamp(n, min, max));
    setDraft(null);
  };
  return (
    <input
      aria-label={label}
      className={`min-w-0 bg-transparent text-right font-mono font-semibold tabular-nums outline-none ${className}`}
      inputMode="decimal"
      type="text"
      value={draft ?? format(value)}
      onFocus={() => setDraft(String(value))}
      onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
      onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
    />
  );
}

// ---------- slider + field, two-way bound ----------
type Tone = "revenue" | "costs";
const ACCENT: Record<Tone, string> = { revenue: "#059669", costs: "#d97706" };

function Control(p: {
  tone: Tone; emoji: string; label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; format: (v: number) => string; hint: string; prefix?: string; suffix?: string;
  toSlider?: (v: number) => number; fromSlider?: (p: number) => number; sliderMax?: number;
}) {
  const sv = p.toSlider ? p.toSlider(p.value) : p.value;
  const smin = p.toSlider ? 0 : p.min, smax = p.sliderMax ?? p.max;
  const fill = ((sv - smin) / (smax - smin)) * 100;
  return (
    <label className="block rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-current/20" style={{ color: ACCENT[p.tone] }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-zinc-800">
        <span className="font-semibold"><span aria-hidden="true">{p.emoji}</span> {p.label}</span>
        <span className="flex items-center gap-1 rounded-md bg-white px-2 py-0.5 shadow-sm ring-1 ring-zinc-200">
          {p.prefix ? <span className="text-sm text-zinc-400">{p.prefix}</span> : null}
          <NumberField className="w-20" format={p.format} label={`${p.label} (valor)`} max={p.max} min={p.min} value={p.value} onChange={p.onChange} />
          {p.suffix ? <span className="text-sm text-zinc-400">{p.suffix}</span> : null}
        </span>
      </div>
      <input
        aria-label={p.label} className="range w-full" max={smax} min={smin} step={p.toSlider ? 1 : p.step} type="range" value={sv}
        style={{ "--fill": `${fill}%` } as JSX.CSSProperties}
        onInput={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); p.onChange(p.fromSlider ? p.fromSlider(v) : v); }}
      />
      <p className="mt-1 text-xs leading-snug text-zinc-500">{p.hint}</p>
    </label>
  );
}

// ---------- result card ----------
function Metric(m: { emoji: string; label: string; value: number; usd?: number; sub?: string; signed?: boolean }) {
  const v = useAnimatedNumber(m.value), u = useAnimatedNumber(m.usd ?? 0), dir = useChangeDirection(m.value);
  const ring = dir === "up" ? "border-emerald-400" : dir === "down" ? "border-rose-400" : "border-transparent";
  return (
    <div className={`rounded-lg border-2 px-2 py-1 transition-colors duration-500 ${ring}`}>
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span aria-hidden="true">{m.emoji}</span>{m.label}
        {dir ? <span className={`ml-auto ${dir === "up" ? "text-emerald-600" : "text-rose-600"}`}>{dir === "up" ? "▲" : "▼"}</span> : null}
      </div>
      <div className={`whitespace-nowrap font-mono text-[clamp(1.4rem,2vw,2.2rem)] font-bold leading-tight tabular-nums ${m.signed && m.value < 0 ? "text-rose-600" : "text-zinc-900"}`}>{brl.format(v)}</div>
      {m.usd !== undefined ? <div className="font-mono text-xs tabular-nums text-zinc-400">{usd.format(u)}</div> : null}
      {m.sub ? <div className="text-xs text-zinc-500">{m.sub}</div> : null}
    </div>
  );
}

// ---------- where each real goes ----------
function Breakdown({ mrr, fixed, variable, net }: { mrr: number; fixed: number; variable: number; net: number }) {
  const total = Math.max(mrr, fixed + variable, 1), w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const loss = net < 0;
  const parts = [
    { label: "Fixos", value: fixed, color: "#d97706" },
    { label: "Variáveis", value: variable, color: "#7c3aed" },
    { label: "Lucro", value: net, color: loss ? "#e11d48" : "#059669" }
  ];
  return (
    <div className="px-2 py-1">
      <div className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span>🧮 Para onde vai cada real</span>
        <span className={loss ? "text-rose-600" : "text-emerald-600"}>{loss ? "custos acima da receita" : "rentável"}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-200">
        {parts.map((p) => <div className="transition-[width] duration-500" key={p.label} style={{ width: w(Math.max(0, p.value)), background: p.color }} />)}
      </div>
      <ul className="mt-1 grid grid-cols-3 gap-x-3 text-xs text-zinc-600">
        {parts.map((p) => (
          <li className="flex items-center gap-1" key={p.label}>
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label}
            <span className="ml-auto font-mono font-semibold tabular-nums text-zinc-800">R$ {compact(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- presets ----------
const PRESETS: { name: string; emoji: string; patch: Partial<SimInput> }[] = [
  { name: "Indie Solo", emoji: "🌱", patch: { users: 800, conversion: 4, priceBrl: 49, fixedCostsBrl: 1_500, variablePct: 10, growthPct: 5 } },
  { name: "Indie Pro", emoji: "🧑‍💻", patch: { users: 5_000, conversion: 5, priceBrl: 79, fixedCostsBrl: 8_000, variablePct: 10, growthPct: 7 } },
  { name: "Startup", emoji: "🚀", patch: { users: 25_000, conversion: 5, priceBrl: 99, fixedCostsBrl: 60_000, variablePct: 12, growthPct: 12 } },
  { name: "Multitenancy", emoji: "🏢", patch: { users: 500_000, conversion: 2.5, priceBrl: 149, fixedCostsBrl: 600_000, variablePct: 8, growthPct: 4 } }
];

const btn = "rounded-full border border-transparent bg-white px-3 py-1 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 focus-visible:border-zinc-400 focus-visible:outline-none";
const panel = "rounded-xl p-1.5 sm:p-2";
const h2 = "flex items-center gap-1.5 px-2 text-xs font-bold uppercase tracking-widest";

// ---------- app ----------
export function App() {
  const [input, setInput] = useState<SimInput>(DEFAULTS);
  const set = <K extends keyof SimInput>(k: K) => (v: SimInput[K]) => setInput((p) => ({ ...p, [k]: v }));
  const out = useMemo(() => simulate(input), [input]);
  const [hover, setHover] = useState<number | null>(null); // users under the cursor, shared by both charts
  const status = out.net >= 0
    ? { cls: "text-emerald-700", text: `✅ Rentável: margem de ${out.margin.toFixed(1).replace(".", ",")}% sobre a receita` }
    : out.breakEvenUsers
      ? { cls: "text-amber-700", text: `⚠️ Prejuízo. Break-even com ${int.format(out.breakEvenUsers)} usuários` }
      : { cls: "text-rose-700", text: "🚫 Sem break-even: custos variáveis consomem toda a receita" };

  return (
    <main className="flex flex-col gap-1.5 bg-zinc-100 p-1.5 text-zinc-900 sm:p-2 lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">💰 SaaS Subscription Simulator</h1>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => <button className={btn} key={p.name} type="button" onClick={() => setInput((prev) => ({ ...prev, ...p.patch }))}>{p.emoji} {p.name}</button>)}
          <button className={`${btn} text-zinc-400`} type="button" onClick={() => setInput(DEFAULTS)}>↺ Reset</button>
          <label className={`${btn} flex items-center gap-1 text-zinc-500`}>
            <span aria-hidden="true">💱</span> US$ 1 = R$
            <NumberField className="w-10 text-zinc-800" format={(v) => v.toFixed(2).replace(".", ",")} label="Câmbio (reais por dólar)" max={LIMITS.fx.max} min={LIMITS.fx.min} value={input.fx} onChange={set("fx")} />
          </label>
        </div>
      </header>

      <section aria-label="Resultados" className={`${panel} flex flex-col gap-1 bg-white shadow-sm lg:min-h-0 lg:flex-1`}>
        <h2 className={`${h2} text-zinc-500`}><span className="h-2 w-2 rounded-full bg-zinc-400" />Resultados</h2>
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
          <Metric emoji="📈" label="Receita mensal" value={out.mrr} usd={out.mrrUsd} sub={`${int.format(out.payingUsers)} pagantes × ${brl.format(out.priceBrl)}`} />
          <Metric emoji="🗓️" label="Receita anual" value={out.arr} usd={out.arrUsd} />
          <Metric emoji="💸" label="Custos mensais" value={out.totalCosts} sub={`${brl.format(input.fixedCostsBrl)} fixos + ${brl.format(out.variableCosts)} variáveis`} />
          <Metric emoji="🧾" label="Lucro mensal" value={out.net} usd={out.netUsd} signed />
          <Metric emoji="🏆" label="Lucro anual" value={out.netAnnual} usd={out.netAnnualUsd} signed />
        </div>
        <div className="grid gap-1 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)]">
          <Chart hover={hover} input={input} onHover={setHover} onPickUsers={set("users")} />
          <GrowthChart hover={hover} input={input} onHover={setHover} onPickUsers={set("users")} />
          <div className="flex flex-col justify-center gap-1 lg:min-h-0">
            <Breakdown fixed={input.fixedCostsBrl} mrr={out.mrr} net={out.net} variable={out.variableCosts} />
            <p aria-live="polite" className={`px-2 text-sm font-semibold transition-colors ${status.cls}`}>{status.text}</p>
            <p className="px-2 text-xs text-zinc-400">Estimativa simplificada: sem churn, impostos ou crescimento mês a mês.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-1.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Receita" className={`${panel} bg-emerald-50`}>
          <h2 className={`${h2} text-emerald-700`}><span className="h-2 w-2 rounded-full bg-emerald-500" />Receita</h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-4">
            <Control tone="revenue" emoji="👥" label="Usuários" value={input.users} onChange={set("users")} min={LIMITS.users.min} max={LIMITS.users.max} step={1}
              toSlider={usersToSlider} fromSlider={sliderToUsers} sliderMax={1000} format={(v) => int.format(v)} hint="Base total, de 100 a 1 milhão (escala logarítmica)." />
            <Control tone="revenue" emoji="💳" label="Conversão" value={input.conversion} onChange={set("conversion")} min={LIMITS.conversion.min} max={LIMITS.conversion.max} step={LIMITS.conversion.step}
              format={(v) => v.toFixed(1).replace(".", ",")} suffix="%" hint="Quantos da base pagam. Freemium costuma ficar entre 2% e 5%." />
            <Control tone="revenue" emoji="💵" label="Preço mensal" value={input.priceBrl} onChange={set("priceBrl")} min={LIMITS.priceBrl.min} max={LIMITS.priceBrl.max} step={LIMITS.priceBrl.step}
              format={(v) => int.format(v)} prefix="R$" suffix="/mês" hint={`Por assinante. Equivale a ${usd.format(input.priceBrl / input.fx)}.`} />
            <Control tone="revenue" emoji="📈" label="Crescimento" value={input.growthPct} onChange={set("growthPct")} min={LIMITS.growthPct.min} max={LIMITS.growthPct.max} step={LIMITS.growthPct.step}
              format={(v) => v.toFixed(1).replace(".", ",")} suffix="% ao mês" hint="Novos usuários por mês, composto. SaaS saudável: 5% a 10%." />
          </div>
        </section>
        <section aria-label="Custos" className={`${panel} bg-amber-50`}>
          <h2 className={`${h2} text-amber-700`}><span className="h-2 w-2 rounded-full bg-amber-500" />Custos</h2>
          <div className="grid md:grid-cols-2">
            <Control tone="costs" emoji="🏗️" label="Custos fixos" value={input.fixedCostsBrl} onChange={set("fixedCostsBrl")} min={LIMITS.fixedCostsBrl.min} max={LIMITS.fixedCostsBrl.max} step={LIMITS.fixedCostsBrl.step}
              format={(v) => int.format(v)} prefix="R$" suffix="/mês" hint="Equipe, ferramentas e marketing: não mudam com o número de usuários." />
            <Control tone="costs" emoji="☁️" label="Custos variáveis" value={input.variablePct} onChange={set("variablePct")} min={LIMITS.variablePct.min} max={LIMITS.variablePct.max} step={LIMITS.variablePct.step}
              format={(v) => v.toFixed(0)} suffix="% da receita" hint="Taxas de pagamento, infra e suporte que crescem com a receita. Típico: 10% a 20%." />
          </div>
        </section>
      </div>
    </main>
  );
}
