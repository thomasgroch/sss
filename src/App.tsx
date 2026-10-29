import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Chart } from "./Chart";
import { DEFAULTS, LIMITS, type SimInput, clamp, simulate, sliderToUsers, usersToSlider } from "./sim";

// ---------- formatting ----------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(".", ",")}k`;
  return int.format(n);
}

// ---------- motion hooks ----------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/** Tweens a number toward `target` so results visibly "roll" into place. */
function useAnimatedNumber(target: number, duration = 480): number {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    cancelAnimationFrame(frame.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const value = from + (target - from) * eased;
      fromRef.current = value;
      setDisplay(value);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration, reduced]);

  return display;
}

/** Returns "up" | "down" | null for ~600ms after `value` changes, to tint the card. */
function useChangeDirection(value: number): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    setDir(value > prev.current ? "up" : "down");
    prev.current = value;
    const id = setTimeout(() => setDir(null), 650);
    return () => clearTimeout(id);
  }, [value]);
  return dir;
}

// ---------- two-way bound control ----------

interface ControlProps {
  label: string;
  emoji: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  /** maps slider position <-> value (for log scale) */
  toSlider?: (v: number) => number;
  fromSlider?: (p: number) => number;
  sliderMax?: number;
}

function Control(p: ControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const sliderValue = p.toSlider ? p.toSlider(p.value) : p.value;
  const sliderMax = p.sliderMax ?? p.max;
  const sliderMin = p.toSlider ? 0 : p.min;
  const fill = ((sliderValue - sliderMin) / (sliderMax - sliderMin)) * 100;

  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(n)) p.onChange(clamp(n, p.min, p.max));
    setDraft(null);
  };

  return (
    <label className="group block rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 transition-colors duration-300 hover:border-slate-700 focus-within:border-emerald-500/60 focus-within:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-base font-semibold text-slate-200">
          <span aria-hidden="true">{p.emoji}</span>
          {p.label}
        </span>
        <span className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-base font-semibold text-emerald-300 transition-colors duration-200 focus-within:border-emerald-500">
          {p.prefix ? <span className="text-slate-500">{p.prefix}</span> : null}
          <input
            aria-label={`${p.label} (valor)`}
            className="w-28 bg-transparent text-right tabular-nums outline-none"
            inputMode="decimal"
            type="text"
            value={draft ?? p.format(p.value)}
            onFocus={() => setDraft(String(p.value))}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          {p.suffix ? <span className="text-slate-500">{p.suffix}</span> : null}
        </span>
      </div>
      <input
        aria-label={p.label}
        className="range w-full"
        max={sliderMax}
        min={sliderMin}
        step={p.toSlider ? 1 : p.step}
        style={{ "--fill": `${fill}%` } as JSX.CSSProperties}
        type="range"
        value={sliderValue}
        onInput={(e) => {
          const pos = parseFloat((e.currentTarget as HTMLInputElement).value);
          p.onChange(p.fromSlider ? p.fromSlider(pos) : pos);
        }}
      />
      {p.hint ? <p className="mt-2.5 text-sm leading-snug text-slate-500">{p.hint}</p> : null}
    </label>
  );
}

// ---------- result cards ----------

interface MetricProps {
  label: string;
  emoji: string;
  value: number; // BRL
  usd?: number; // optional secondary value
  format?: (v: number) => string;
  sub?: string;
  big?: boolean;
  signed?: boolean;
  delay?: number;
}

function Metric(m: MetricProps) {
  const animated = useAnimatedNumber(m.value);
  const animatedUsd = useAnimatedNumber(m.usd ?? 0);
  const dir = useChangeDirection(m.value);
  const negative = m.signed && m.value < 0;
  const fmt = m.format ?? ((v: number) => brl.format(v));
  const tint =
    dir === "up" ? "border-emerald-500/60 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
    : dir === "down" ? "border-rose-500/60 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
    : "border-slate-800";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-slate-900/70 p-4 sm:p-5 transition-[border-color,box-shadow] duration-500 ease-out ${tint} ${m.big ? "sm:col-span-2" : ""}`}
      style={{ transitionDelay: `${m.delay ?? 0}ms` }}
    >
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        <span aria-hidden="true">{m.emoji}</span>
        {m.label}
        {dir ? (
          <span aria-hidden="true" className={`ml-auto text-sm ${dir === "up" ? "text-emerald-400" : "text-rose-400"}`}>
            {dir === "up" ? "▲" : "▼"}
          </span>
        ) : null}
      </div>
      <div
        aria-live="polite"
        className={`min-w-0 break-words font-mono tabular-nums tracking-tight leading-tight transition-colors duration-500 ${m.big ? "text-[clamp(2.25rem,3.4vw,3.75rem)]" : "text-[clamp(1.6rem,2vw,2.25rem)]"} ${negative ? "text-rose-300" : "text-white"}`}
      >
        {fmt(animated)}
      </div>
      {m.usd !== undefined ? (
        <div className="mt-1.5 font-mono text-sm tabular-nums text-slate-500">{usd.format(animatedUsd)}</div>
      ) : null}
      {m.sub ? <div className="mt-1.5 text-sm text-slate-500">{m.sub}</div> : null}
    </div>
  );
}

/** Stacked bar: where each real of revenue goes. Widths animate with CSS. */
function Breakdown({ mrr, fixed, variable, net }: { mrr: number; fixed: number; variable: number; net: number }) {
  const total = Math.max(mrr, fixed + variable, 1);
  const w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const seg = "h-full transition-[width] duration-500 ease-out";
  const overspend = net < 0;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        <span>🧮 Para onde vai cada real</span>
        <span className={`transition-colors duration-500 ${overspend ? "text-rose-400" : "text-emerald-400"}`}>
          {overspend ? "custos acima da receita" : "operação rentável"}
        </span>
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`${seg} bg-amber-400`} style={{ width: w(fixed) }} title="Custos fixos" />
        <div className={`${seg} bg-sky-400`} style={{ width: w(variable) }} title="Custos variáveis" />
        <div className={`${seg} ${overspend ? "bg-rose-500" : "bg-emerald-400"}`} style={{ width: w(Math.max(0, net)) }} title="Lucro" />
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm text-slate-400 sm:grid-cols-3">
        <Legend color="bg-amber-400" label="Fixos" value={fixed} />
        <Legend color="bg-sky-400" label="Variáveis" value={variable} />
        <Legend color={overspend ? "bg-rose-500" : "bg-emerald-400"} label="Lucro" value={net} />
      </ul>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  const animated = useAnimatedNumber(value);
  return (
    <li className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color} transition-colors duration-500`} />
      <span>{label}</span>
      <span className="ml-auto font-mono tabular-nums text-slate-300">{brl.format(animated)}</span>
    </li>
  );
}

// ---------- presets ----------

const PRESETS: { name: string; emoji: string; patch: Partial<SimInput> }[] = [
  { name: "Indie", emoji: "🌱", patch: { users: 1_000, conversion: 4, priceUsd: 9, fixedCostsBrl: 2_000, variablePct: 10 } },
  { name: "Startup", emoji: "🚀", patch: { users: 25_000, conversion: 5, priceUsd: 19, fixedCostsBrl: 60_000, variablePct: 12 } },
  { name: "Scale-up", emoji: "🏢", patch: { users: 300_000, conversion: 3, priceUsd: 29, fixedCostsBrl: 400_000, variablePct: 15 } }
];

// ---------- app ----------

/** Small inline editor for the exchange rate: secondary setting, rarely changed. */
function FxChip({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(n)) onChange(clamp(n, LIMITS.fx.min, LIMITS.fx.max));
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-400 transition-colors duration-200 focus-within:border-emerald-500/60 hover:border-slate-600">
      <span aria-hidden="true">💱</span>
      <span>US$ 1 =</span>
      <span className="text-slate-500">R$</span>
      <input
        aria-label="Câmbio (reais por dólar)"
        className="w-14 bg-transparent font-mono tabular-nums text-slate-200 outline-none"
        inputMode="decimal"
        type="text"
        value={draft ?? value.toFixed(2).replace(".", ",")}
        onFocus={() => setDraft(String(value))}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </label>
  );
}

export function App() {
  const [input, setInput] = useState<SimInput>(DEFAULTS);
  const set = <K extends keyof SimInput>(key: K) => (v: SimInput[K]) => setInput((prev) => ({ ...prev, [key]: v }));

  // Computed properties: every result derives from `input`, recomputed instantly.
  const out = useMemo(() => simulate(input), [input]);
  const status = useMemo(() => {
    if (out.net >= 0) return { tone: "text-emerald-400", text: `✅ Rentável: margem de ${pct(out.margin)} sobre a receita` };
    if (out.breakEvenUsers) return { tone: "text-amber-400", text: `⚠️ Prejuízo. Break-even com ${int.format(out.breakEvenUsers)} usuários (${compact(out.breakEvenUsers)})` };
    return { tone: "text-rose-400", text: "🚫 Sem break-even: custos variáveis consomem toda a receita" };
  }, [out.net, out.margin, out.breakEvenUsers]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-6 lg:px-10 lg:py-10 2xl:px-14">

      <div className="w-full">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">💰 SaaS Subscription Simulator</h1>
            <p className="mt-2 max-w-2xl text-base text-slate-400 sm:text-lg">
              Cinco parâmetros, resultado em reais na hora. Tudo roda no seu navegador, nada é salvo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((pr) => (
              <button
                className="rounded-full border border-slate-700 px-4 py-2 text-base text-slate-300 transition-all duration-200 hover:border-emerald-500 hover:text-white active:scale-95"
                key={pr.name}
                type="button"
                onClick={() => setInput((prev) => ({ ...prev, ...pr.patch }))}
              >
                {pr.emoji} {pr.name}
              </button>
            ))}
            <button
              className="rounded-full border border-slate-800 px-4 py-2 text-base text-slate-500 transition-all duration-200 hover:border-slate-600 hover:text-slate-300 active:scale-95"
              type="button"
              onClick={() => setInput(DEFAULTS)}
            >
              ↺ Reset
            </button>
            <FxChip value={input.fx} onChange={set("fx")} />
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {/* ---- controls ---- */}
          <section aria-label="Parâmetros" className="space-y-3">
            <h2 className="px-1 text-sm font-bold uppercase tracking-widest text-slate-500">Receita</h2>
            <Control
              emoji="👥" label="Usuários" value={input.users} onChange={set("users")}
              min={LIMITS.users.min} max={LIMITS.users.max} step={1}
              toSlider={usersToSlider} fromSlider={sliderToUsers} sliderMax={1000}
              format={(v) => int.format(v)} hint="Base total, de 100 a 1 milhão (escala logarítmica)."
            />
            <Control
              emoji="💳" label="Conversão" value={input.conversion} onChange={set("conversion")}
              min={LIMITS.conversion.min} max={LIMITS.conversion.max} step={LIMITS.conversion.step}
              format={(v) => v.toFixed(1)} suffix="%" hint="Quantos da base pagam. Freemium costuma ficar entre 2% e 5%."
            />
            <Control
              emoji="💵" label="Preço mensal" value={input.priceUsd} onChange={set("priceUsd")}
              min={LIMITS.priceUsd.min} max={LIMITS.priceUsd.max} step={LIMITS.priceUsd.step}
              format={(v) => v.toFixed(0)} prefix="US$" hint={`Equivale a ${brl.format(out.priceBrl)} por assinante.`}
            />

            <h2 className="px-1 pt-3 text-sm font-bold uppercase tracking-widest text-slate-500">Custos</h2>
            <Control
              emoji="🏗️" label="Custos fixos" value={input.fixedCostsBrl} onChange={set("fixedCostsBrl")}
              min={LIMITS.fixedCostsBrl.min} max={LIMITS.fixedCostsBrl.max} step={LIMITS.fixedCostsBrl.step}
              format={(v) => int.format(v)} prefix="R$" suffix="/mês" hint="Equipe, ferramentas e marketing: não mudam com o número de usuários."
            />
            <Control
              emoji="☁️" label="Custos variáveis (da receita)" value={input.variablePct} onChange={set("variablePct")}
              min={LIMITS.variablePct.min} max={LIMITS.variablePct.max} step={LIMITS.variablePct.step}
              format={(v) => v.toFixed(0)} suffix="%" hint="Taxas de pagamento, infra e suporte que crescem junto com a receita. Típico: 10% a 20%."
            />
          </section>

          {/* ---- results ---- */}
          <section aria-label="Resultados" className="space-y-3">
            <h2 className="px-1 text-sm font-bold uppercase tracking-widest text-slate-500">Resultados</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric big emoji="📈" label="Receita mensal" value={out.mrr} usd={out.mrrUsd} sub={`${int.format(out.payingUsers)} clientes pagantes × ${brl.format(out.priceBrl)}`} />
              <Metric emoji="🗓️" label="Receita anual" value={out.arr} usd={out.arrUsd} delay={40} />
              <Metric emoji="💸" label="Custos mensais" value={out.totalCosts} delay={80} sub={`${brl.format(input.fixedCostsBrl)} fixos + ${brl.format(out.variableCosts)} variáveis`} />
            </div>

            <Chart input={input} onPickUsers={set("users")} />

            <Breakdown mrr={out.mrr} fixed={input.fixedCostsBrl} variable={out.variableCosts} net={out.net} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric emoji="🧾" label="Lucro mensal" value={out.net} usd={out.netUsd} signed delay={120} />
              <Metric emoji="🏆" label="Lucro anual" value={out.netAnnual} usd={out.netAnnualUsd} signed delay={160} />
            </div>

            <p aria-live="polite" className={`px-1 pt-1 text-base font-semibold transition-colors duration-500 ${status.tone}`}>{status.text}</p>
            <p className="px-1 text-sm text-slate-600">
              Estimativa simplificada: sem churn, impostos ou crescimento mês a mês. Ponto de partida, não plano financeiro.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
