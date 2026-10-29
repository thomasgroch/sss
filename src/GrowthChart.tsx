import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type SimInput, horizon, monthFor, timeline, usersAt } from "./sim";
import { brl, compact, int } from "./App";

interface Props {
  input: SimInput;
  hover: number | null; // users under the cursor, shared with the revenue chart
  onHover: (users: number | null) => void;
  onPickUsers: (users: number) => void;
}

/**
 * Tempo × usuários (eixo esquerdo) e caixa acumulado (eixo direito).
 * A fase de construção aparece sombreada: zero usuários, custos fixos queimando caixa.
 * Compartilha o hover em usuários com o gráfico de receita; clique leva o simulador àquele mês.
 */
export function GrowthChart({ input, hover, onHover, onPickUsers }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 420 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setBox({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = box.w < 560;
  const W = narrow ? 560 : 1000;
  const H = Math.round(W * Math.min(0.9, Math.max(0.16, box.h > 40 ? box.h / box.w : 0.42)));
  const PAD = narrow ? { l: 64, r: 64, t: 36, b: 64 } : { l: 96, r: 96, t: 36, b: 70 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const N = horizon(input);
  const { points, paybackMonth } = useMemo(() => timeline(input), [input]);
  const last = points[N];

  const yMax = Math.max(last.users * 1.05, input.users * 1.2, 1);
  const cashAbs = Math.max(1, ...points.map((p) => Math.abs(p.cash)));
  const xOf = (m: number) => PAD.l + (m / N) * iw;
  const yOf = (u: number) => PAD.t + ih - (u / yMax) * ih;
  const cOf = (c: number) => PAD.t + ih / 2 - (c / cashAbs) * (ih / 2); // cash axis, zero at mid height
  const line = (f: (p: typeof points[number]) => number) => points.map((p, i) => `${i ? "L" : "M"}${xOf(p.m).toFixed(1)},${f(p).toFixed(1)}`).join(" ");

  const ticks = (max: number) => {
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? raw;
    const t: number[] = [];
    for (let v = 0; v <= max; v += step) t.push(v);
    return t;
  };
  const yTicks = useMemo(() => ticks(yMax), [yMax]);
  const cTicks = useMemo(() => { const t = ticks(cashAbs); return [...t.slice(1).map((v) => -v).reverse(), ...t]; }, [cashAbs]);
  const monthStep = N > 30 ? 6 : 3;

  const toMonth = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < PAD.l || px > W - PAD.r) return null;
    return Math.round(((px - PAD.l) / iw) * N);
  };

  const [hm, setHm] = useState<number | null>(null); // month under this chart's own cursor (keeps build months hoverable)
  const sharedM = hover !== null ? monthFor(input, hover) : null;
  const m = hm ?? (sharedM !== null && sharedM >= 0 && sharedM <= N ? sharedM : null);
  const hp = m !== null ? points[Math.round(m)] : null;
  const hx = m !== null ? xOf(m) : 0;
  const tooltipLeft = hx < W * 0.6;

  return (
    <figure className="flex min-h-0 flex-col px-2 py-1">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">📅 Usuários e caixa ao longo do tempo</span>
        <ul className="flex flex-wrap gap-x-3 text-xs text-zinc-600">
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />Usuários</li>
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-600" />Caixa acumulado</li>
          <li className="flex items-center gap-1"><span className="h-2 w-3 bg-zinc-300" />Construção</li>
        </ul>
      </figcaption>
      <div className="min-h-[220px] w-full lg:min-h-0 lg:flex-1" ref={boxRef}>
        <svg
          aria-label="Gráfico de usuários e caixa acumulado por mês"
          className="block h-auto w-full cursor-crosshair select-none touch-none font-sans lg:h-full"
          ref={svgRef} role="img" viewBox={`0 0 ${W} ${H}`}
          onPointerMove={(e) => { const mm = toMonth(e); setHm(mm); onHover(mm === null ? null : usersAt(input, mm)); }}
          onPointerLeave={() => { setHm(null); onHover(null); }}
          onPointerDown={(e) => { const mm = toMonth(e); const u = mm === null ? 0 : usersAt(input, mm); if (u > 0) onPickUsers(u); }}
        >
          {/* build phase */}
          {input.buildMonths > 0 ? (
            <g>
              <rect fill="#d4d4d8" opacity="0.35" height={ih} width={xOf(input.buildMonths) - PAD.l} x={PAD.l} y={PAD.t} style={{ transition: "width .4s ease" }} />
              <text fill="#52525b" fontSize="15" fontWeight="600" textAnchor="middle" x={(PAD.l + xOf(input.buildMonths)) / 2} y={PAD.t - 10}>construção · {input.buildMonths} {input.buildMonths === 1 ? "mês" : "meses"}</text>
            </g>
          ) : null}

          {/* left axis: users */}
          {yTicks.map((v) => (
            <g key={v}>
              <line stroke={v === 0 ? "#71717a" : "#e4e4e7"} x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)} />
              <text fill="#047857" fontSize="17" fontWeight="600" textAnchor="end" x={PAD.l - 12} y={yOf(v) + 6}>{compact(v)}</text>
            </g>
          ))}
          {/* right axis: cash */}
          {cTicks.map((v) => (
            <text fill="#6d28d9" fontSize="15" fontWeight="600" key={v} textAnchor="start" x={W - PAD.r + 12} y={cOf(v) + 5}>{compact(v)}</text>
          ))}
          <line stroke="#6d28d9" strokeDasharray="3 5" strokeOpacity="0.5" x1={PAD.l} x2={W - PAD.r} y1={cOf(0)} y2={cOf(0)} />
          {/* x axis */}
          {points.filter((p) => p.m % monthStep === 0).map((p) => (
            <g key={p.m}>
              <line stroke="#e4e4e7" x1={xOf(p.m)} x2={xOf(p.m)} y1={PAD.t} y2={PAD.t + ih} />
              <text fill="#52525b" fontSize="17" fontWeight="600" textAnchor="middle" x={xOf(p.m)} y={PAD.t + ih + 26}>{p.m}</text>
            </g>
          ))}
          <line stroke="#a1a1aa" strokeWidth="2" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} />
          <line stroke="#a1a1aa" strokeWidth="2" x1={W - PAD.r} x2={W - PAD.r} y1={PAD.t} y2={PAD.t + ih} />
          <line stroke="#a1a1aa" strokeWidth="2" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} />
          <text fill="#71717a" fontSize="16" fontWeight="700" textAnchor="middle" x={PAD.l + iw / 2} y={H - 10}>MESES A PARTIR DE HOJE</text>
          <text fill="#047857" fontSize="16" fontWeight="700" textAnchor="middle" transform={`translate(22 ${PAD.t + ih / 2}) rotate(-90)`}>USUÁRIOS NA BASE</text>
          <text fill="#6d28d9" fontSize="16" fontWeight="700" textAnchor="middle" transform={`translate(${W - 22} ${PAD.t + ih / 2}) rotate(90)`}>CAIXA (R$)</text>

          {/* series */}
          <path d={`${line((p) => yOf(p.users))} L${xOf(N)},${yOf(0)} L${PAD.l},${yOf(0)} Z`} fill="#059669" opacity="0.08" />
          <path d={line((p) => yOf(p.users))} fill="none" stroke="#059669" strokeLinejoin="round" strokeWidth="3" style={{ transition: "d .4s ease" }} />
          <path d={line((p) => cOf(p.cash))} fill="none" stroke="#7c3aed" strokeLinejoin="round" strokeWidth="3" style={{ transition: "d .4s ease" }} />

          {/* launch + payback markers */}
          <circle cx={xOf(input.buildMonths)} cy={yOf(input.users)} fill="#fff" r="7" stroke="#059669" strokeWidth="3" style={{ transition: "cx .4s ease, cy .4s ease" }} />
          {paybackMonth !== null ? (
            <g>
              <line stroke="#7c3aed" strokeDasharray="6 6" strokeWidth="1.5" x1={xOf(paybackMonth)} x2={xOf(paybackMonth)} y1={PAD.t} y2={PAD.t + ih} />
              <text fill="#6d28d9" fontSize="15" fontWeight="600" textAnchor="middle" x={xOf(paybackMonth)} y={PAD.t + ih - 8}>payback mês {paybackMonth}</text>
            </g>
          ) : null}

          {/* hover */}
          {hp ? (
            <g>
              <line stroke="#3f3f46" strokeOpacity="0.5" x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + ih} />
              <circle cx={hx} cy={yOf(hp.users)} fill="#059669" r="5" />
              <circle cx={hx} cy={cOf(hp.cash)} fill="#7c3aed" r="5" />
              <foreignObject height="120" width="250" x={tooltipLeft ? hx + 14 : hx - 264} y={PAD.t + 4}>
                <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-zinc-200">
                  <div className="font-semibold text-zinc-900">Mês {hp.m}{hp.users === 0 ? " · construção" : ""}</div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Base</span><span className="font-mono tabular-nums text-emerald-700">{int.format(hp.users)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Resultado</span><span className={`font-mono tabular-nums ${hp.net < 0 ? "text-rose-600" : "text-zinc-800"}`}>{brl.format(hp.net)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Caixa</span><span className={`font-mono tabular-nums ${hp.cash < 0 ? "text-rose-600" : "text-violet-700"}`}>{brl.format(hp.cash)}</span></div>
                </div>
              </foreignObject>
            </g>
          ) : null}
        </svg>
      </div>
    </figure>
  );
}
