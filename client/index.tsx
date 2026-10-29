import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { DEFAULTS, LIMITS, type SimInput, clamp, simulate, sliderToUsers, usersToSlider } from "../shared/sim";

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
    <label className="group block rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition-colors duration-300 hover:border-slate-700 focus-within:border-emerald-500/60 focus-within:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <span aria-hidden="true">{p.emoji}</span>
          {p.label}
        </span>
        <span className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-emerald-300 transition-colors duration-200 focus-within:border-emerald-500">
          {p.prefix ? <span className="text-slate-500">{p.prefix}</span> : null}
          <input
            aria-label={`${p.label} (valor)`}
            className="w-24 bg-transparent text-right tabular-nums outline-none"
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
      {p.hint ? <p className="mt-2 text-xs text-slate-500">{p.hint}</p> : null}
    </label>
  );
}

// ---------- result cards ----------

interface MetricProps {
  label: string;
  emoji: string;
  value: number;
  format: (v: number) => string;
  sub?: string;
  big?: boolean;
  signed?: boolean;
  delay?: number;
}

function Metric(m: MetricProps) {
  const animated = useAnimatedNumber(m.value);
  const dir = useChangeDirection(m.value);
  const negative = m.signed && m.value < 0;
  const tint =
    dir === "up" ? "border-emerald-500/60 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
    : dir === "down" ? "border-rose-500/60 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
    : "border-slate-800";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-slate-900/70 p-4 transition-[border-color,box-shadow,transform] duration-500 ease-out ${tint} ${m.big ? "sm:col-span-2" : ""}`}
      style={{ transitionDelay: `${m.delay ?? 0}ms` }}
    >
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <span aria-hidden="true">{m.emoji}</span>
        {m.label}
        {dir ? (
          <span aria-hidden="true" className={`ml-auto text-sm transition-opacity duration-300 ${dir === "up" ? "text-emerald-400" : "text-rose-400"}`}>
            {dir === "up" ? "▲" : "▼"}
          </span>
        ) : null}
      </div>
      <div
        aria-live="polite"
        className={`font-mono tabular-nums tracking-tight transition-colors duration-500 ${m.big ? "text-3xl sm:text-4xl" : "text-2xl"} ${negative ? "text-rose-300" : "text-white"}`}
      >
        {m.format(animated)}
      </div>
      {m.sub ? <div className="mt-1 text-xs text-slate-500">{m.sub}</div> : null}
    </div>
  );
}

/** Stacked bar: where each dollar of MRR goes. Widths animate with CSS. */
function Breakdown({ mrr, fixed, infra, fee, net }: { mrr: number; fixed: number; infra: number; fee: number; net: number }) {
  const total = Math.max(mrr, fixed + infra + fee, 1);
  const w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const seg = "h-full transition-[width] duration-500 ease-out";
  const overspend = net < 0;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
        <span>🧮 Para onde vai cada dólar do MRR</span>
        <span className={`transition-colors duration-500 ${overspend ? "text-rose-400" : "text-emerald-400"}`}>
          {overspend ? "custos acima da receita" : "operação rentável"}
        </span>
      </div>
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`${seg} bg-amber-400`} style={{ width: w(fixed) }} title="Custos fixos" />
        <div className={`${seg} bg-sky-400`} style={{ width: w(infra) }} title="Infraestrutura" />
        <div className={`${seg} bg-fuchsia-400`} style={{ width: w(fee) }} title="Taxas de pagamento" />
        <div className={`${seg} ${overspend ? "bg-rose-500" : "bg-emerald-400"}`} style={{ width: w(Math.max(0, net)) }} title="Lucro" />
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
        <Legend color="bg-amber-400" label="Fixos" value={fixed} />
        <Legend color="bg-sky-400" label="Infra" value={infra} />
        <Legend color="bg-fuchsia-400" label="Taxas" value={fee} />
        <Legend color={overspend ? "bg-rose-500" : "bg-emerald-400"} label="Lucro" value={net} />
      </ul>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  const animated = useAnimatedNumber(value);
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color} transition-colors duration-500`} />
      <span>{label}</span>
      <span className="ml-auto font-mono tabular-nums text-slate-300">{usd.format(animated)}</span>
    </li>
  );
}

// ---------- presets ----------

const PRESETS: { name: string; emoji: string; patch: Partial<SimInput> }[] = [
  { name: "Indie", emoji: "🌱", patch: { users: 1_000, conversion: 4, price: 9, fixedCosts: 500, costPerUser: 0.03 } },
  { name: "Startup", emoji: "🚀", patch: { users: 25_000, conversion: 5, price: 19, fixedCosts: 12_000, costPerUser: 0.05 } },
  { name: "Scale-up", emoji: "🏢", patch: { users: 300_000, conversion: 3, price: 29, fixedCosts: 80_000, costPerUser: 0.04 } }
];

// ---------- app ----------

export function App() {
  const [input, setInput] = useState<SimInput>(DEFAULTS);
  const set = <K extends keyof SimInput>(key: K) => (v: SimInput[K]) => setInput((prev) => ({ ...prev, [key]: v }));

  // Computed properties: every result derives from `input`, recomputed instantly.
  const out = useMemo(() => simulate(input), [input]);
  const payingPct = useMemo(() => (input.users ? (out.payingUsers / input.users) * 100 : 0), [out.payingUsers, input.users]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:py-12">
      <style>{`
        .range { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 9999px;
          background: linear-gradient(90deg, #34d399 var(--fill, 0%), #1e293b var(--fill, 0%)); outline: none; cursor: pointer; }
        .range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 9999px;
          background: #fff; border: 3px solid #34d399; box-shadow: 0 2px 8px rgba(0,0,0,.4); transition: transform .15s ease, box-shadow .15s ease; }
        .range:hover::-webkit-slider-thumb, .range:focus-visible::-webkit-slider-thumb { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(52,211,153,.2); }
        .range:active::-webkit-slider-thumb { transform: scale(1.25); }
        .range::-moz-range-thumb { width: 20px; height: 20px; border-radius: 9999px; background: #fff; border: 3px solid #34d399; }
        @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }
      `}</style>

      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">💰 SaaS Subscription Simulator</h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Ajuste os parâmetros e acompanhe faturamento, custos e lucro recalculados em tempo real. Tudo roda no seu navegador, nada é salvo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((pr) => (
              <button
                className="rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-all duration-200 hover:border-emerald-500 hover:text-white active:scale-95"
                key={pr.name}
                type="button"
                onClick={() => setInput((prev) => ({ ...prev, ...pr.patch }))}
              >
                {pr.emoji} {pr.name}
              </button>
            ))}
            <button
              className="rounded-full border border-slate-800 px-3 py-1.5 text-sm text-slate-500 transition-all duration-200 hover:border-slate-600 hover:text-slate-300 active:scale-95"
              type="button"
              onClick={() => setInput(DEFAULTS)}
            >
              ↺ Reset
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ---- controls ---- */}
          <section aria-label="Parâmetros" className="space-y-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Parâmetros</h2>
            <Control
              emoji="👥" label="Usuários" value={input.users} onChange={set("users")}
              min={LIMITS.users.min} max={LIMITS.users.max} step={1}
              toSlider={usersToSlider} fromSlider={sliderToUsers} sliderMax={1000}
              format={(v) => int.format(v)} hint="Escala logarítmica: de 100 a 1 milhão de usuários."
            />
            <Control
              emoji="💳" label="Conversão" value={input.conversion} onChange={set("conversion")}
              min={LIMITS.conversion.min} max={LIMITS.conversion.max} step={LIMITS.conversion.step}
              format={(v) => v.toFixed(1)} suffix="%" hint="Percentual da base que paga. SaaS freemium costuma ficar entre 2% e 5%."
            />
            <Control
              emoji="💵" label="Preço mensal" value={input.price} onChange={set("price")}
              min={LIMITS.price.min} max={LIMITS.price.max} step={LIMITS.price.step}
              format={(v) => v.toFixed(0)} prefix="US$"
            />
            <Control
              emoji="💱" label="Câmbio" value={input.fx} onChange={set("fx")}
              min={LIMITS.fx.min} max={LIMITS.fx.max} step={LIMITS.fx.step}
              format={(v) => v.toFixed(2)} prefix="R$" suffix="/US$"
            />

            <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Custos</h2>
            <Control
              emoji="🏗️" label="Custos fixos" value={input.fixedCosts} onChange={set("fixedCosts")}
              min={LIMITS.fixedCosts.min} max={LIMITS.fixedCosts.max} step={LIMITS.fixedCosts.step}
              format={(v) => int.format(v)} prefix="US$" suffix="/mês" hint="Equipe, ferramentas, marketing."
            />
            <Control
              emoji="☁️" label="Infra por usuário" value={input.costPerUser} onChange={set("costPerUser")}
              min={LIMITS.costPerUser.min} max={LIMITS.costPerUser.max} step={LIMITS.costPerUser.step}
              format={(v) => v.toFixed(2)} prefix="US$" suffix="/mês" hint="Hospedagem, banco, e-mails, por usuário (pagante ou não)."
            />
            <Control
              emoji="🏦" label="Taxa de pagamento" value={input.feePct} onChange={set("feePct")}
              min={LIMITS.feePct.min} max={LIMITS.feePct.max} step={LIMITS.feePct.step}
              format={(v) => v.toFixed(1)} suffix="%" hint="Stripe, Paddle etc. sobre a receita bruta."
            />
          </section>

          {/* ---- results ---- */}
          <section aria-label="Resultados" className="space-y-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Resultados</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric emoji="🙋" label="Clientes pagantes" value={out.payingUsers} format={(v) => int.format(Math.round(v))} sub={`${pct(payingPct)} de ${compact(input.users)} usuários`} />
              <Metric emoji="📊" label="Margem líquida" value={out.margin} format={(v) => pct(v)} signed sub={out.breakEvenUsers ? `Break-even com ${int.format(out.breakEvenUsers)} usuários` : "Sem break-even: custo por usuário supera a receita"} />
              <Metric big emoji="📈" label="Receita mensal (MRR)" value={out.mrrUsd} format={(v) => usd.format(v)} sub={`${brl.format(out.mrrBrl)} por mês`} />
              <Metric emoji="🇧🇷" label="MRR em reais" value={out.mrrBrl} format={(v) => brl.format(v)} delay={40} />
              <Metric emoji="🗓️" label="Receita anual (ARR)" value={out.arrUsd} format={(v) => usd.format(v)} sub={brl.format(out.arrBrl)} delay={80} />
            </div>

            <Breakdown mrr={out.mrrUsd} fixed={input.fixedCosts} infra={out.infraCost} fee={out.feeCost} net={out.netUsd} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric emoji="💸" label="Custos totais / mês" value={out.totalCosts} format={(v) => usd.format(v)} sub={brl.format(out.totalCosts * input.fx)} delay={120} />
              <Metric emoji="🧾" label="Lucro mensal" value={out.netUsd} format={(v) => usd.format(v)} signed sub={brl.format(out.netBrl)} delay={160} />
              <Metric big emoji="🏆" label="Lucro anual estimado" value={out.netAnnualUsd} format={(v) => usd.format(v)} signed sub={`${brl.format(out.netAnnualBrl)} por ano, após custos`} delay={200} />
            </div>

            <p className="px-1 pt-2 text-xs text-slate-600">
              Estimativas simplificadas: sem churn, impostos ou crescimento mês a mês. Use como ponto de partida, não como plano financeiro.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
