import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LIMITS, type SimInput, simulate } from "./sim";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(".", ",")}k`;
  return int.format(n);
}

const SERIES = [
  { key: "mrr", label: "Receita", color: "#34d399" },
  { key: "totalCosts", label: "Custos", color: "#fbbf24" },
  { key: "net", label: "Lucro", color: "#38bdf8" }
] as const;

interface Props {
  input: SimInput;
  onPickUsers: (users: number) => void;
}

/**
 * Receita, custos e lucro mensais (R$) em função do número de usuários.
 * Eixo X em escala log. Hover mostra valores; clique leva o simulador àquele ponto.
 */
export function Chart({ input, onPickUsers }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null); // users under cursor

  // The viewBox follows the container's aspect ratio so the chart fills its box without distorting text.
  // Narrow containers get a smaller viewBox width so labels stay readable.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 420 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0) setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = box.w < 560;
  const W = narrow ? 560 : 1000;
  const ratio = box.h > 40 ? box.h / box.w : 0.42;
  const H = Math.round(W * Math.min(0.9, Math.max(0.16, ratio)));
  const PAD = narrow ? { l: 72, r: 16, t: 36, b: 64 } : { l: 96, r: 28, t: 36, b: 70 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const out = useMemo(() => simulate(input), [input]);

  // X domain: keep the current point around the middle, include break-even if it exists.
  const xMin = LIMITS.users.min;
  const xMax = useMemo(() => {
    const want = Math.max(input.users * 6, (out.breakEvenUsers ?? 0) * 1.4, 2_000);
    return Math.min(LIMITS.users.max, want);
  }, [input.users, out.breakEvenUsers]);
  const lx = Math.log10(xMin), ux = Math.log10(xMax);
  const xOf = (u: number) => PAD.l + ((Math.log10(u) - lx) / (ux - lx)) * iw;
  const uOf = (px: number) => Math.pow(10, lx + ((px - PAD.l) / iw) * (ux - lx));

  const points = useMemo(() => {
    const n = 80;
    return Array.from({ length: n + 1 }, (_, i) => {
      const u = Math.round(Math.pow(10, lx + (i / n) * (ux - lx)));
      const o = simulate({ ...input, users: u });
      return { u, mrr: o.mrr, totalCosts: o.totalCosts, net: o.net };
    });
  }, [input, lx, ux]);

  const yMax = Math.max(1, ...points.map((p) => Math.max(p.mrr, p.totalCosts)));
  const yMin = Math.min(0, ...points.map((p) => p.net));
  const yOf = (v: number) => PAD.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const path = (key: (typeof SERIES)[number]["key"]) =>
    points.map((p, i) => `${i ? "L" : "M"}${xOf(p.u).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(" ");

  const yTicks = useMemo(() => {
    const span = yMax - yMin;
    const raw = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const ticks: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let e = Math.ceil(lx); e <= Math.floor(ux); e++) ticks.push(Math.pow(10, e));
    if (ticks.length < 3) for (let e = Math.floor(lx); e <= Math.floor(ux); e++) ticks.push(3 * Math.pow(10, e));
    return ticks.filter((t) => t >= xMin && t <= xMax).sort((a, b) => a - b);
  }, [lx, ux, xMin, xMax]);

  const toUsers = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.l || px > W - PAD.r) return null;
    return Math.round(uOf(px));
  };

  const hovered = hover ? simulate({ ...input, users: hover }) : null;
  const hx = hover ? xOf(hover) : 0;
  const tooltipLeft = hover ? hx < W * 0.6 : true;
  const curX = xOf(input.users);
  const beX = out.breakEvenUsers && out.breakEvenUsers >= xMin && out.breakEvenUsers <= xMax ? xOf(out.breakEvenUsers) : null;

  return (
    <figure className="flex min-h-0 flex-col rounded-xl border border-transparent px-3 py-2">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold uppercase tracking-wide text-sky-300/90">📉 Receita, custos e lucro por usuários</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
          {SERIES.map((s) => (
            <li className="flex items-center gap-2" key={s.key}>
              <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
          <li className="flex items-center gap-2 text-slate-400">
            <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
            Break-even
          </li>
        </ul>
      </figcaption>

      <div className="min-h-[220px] w-full lg:min-h-0 lg:flex-1" ref={boxRef}>
      <svg
        aria-label="Gráfico de receita, custos e lucro mensais em reais conforme o número de usuários"
        className="block h-auto w-full cursor-crosshair select-none touch-none font-sans lg:h-full"
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={(e) => setHover(toUsers(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => { const u = toUsers(e); if (u) onPickUsers(u); }}
      >
        {/* grid + y labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line stroke={v === 0 ? "#64748b" : "#1e293b"} strokeWidth={v === 0 ? 1.5 : 1} x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)} />
            <line stroke="#94a3b8" x1={PAD.l - 6} x2={PAD.l} y1={yOf(v)} y2={yOf(v)} />
            <text fill="#cbd5e1" fontSize="17" fontWeight="600" textAnchor="end" x={PAD.l - 12} y={yOf(v) + 6}>{compact(v)}</text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((u) => (
          <g key={u}>
            <line stroke="#1e293b" x1={xOf(u)} x2={xOf(u)} y1={PAD.t} y2={PAD.t + ih} />
            <line stroke="#94a3b8" x1={xOf(u)} x2={xOf(u)} y1={PAD.t + ih} y2={PAD.t + ih + 6} />
            <text fill="#cbd5e1" fontSize="17" fontWeight="600" textAnchor="middle" x={xOf(u)} y={PAD.t + ih + 26}>{compact(u)}</text>
          </g>
        ))}
        {/* axis lines + titles */}
        <line stroke="#94a3b8" strokeWidth="2" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} />
        <line stroke="#94a3b8" strokeWidth="2" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} />
        <text fill="#94a3b8" fontSize="16" fontWeight="700" textAnchor="middle" x={PAD.l + iw / 2} y={H - 10}>USUÁRIOS (escala logarítmica)</text>
        <text fill="#94a3b8" fontSize="16" fontWeight="700" textAnchor="middle" transform={`translate(22 ${PAD.t + ih / 2}) rotate(-90)`}>R$ POR MÊS</text>

        {/* profit area */}
        <path d={`${path("net")} L${xOf(points[points.length - 1].u).toFixed(1)},${yOf(0)} L${PAD.l},${yOf(0)} Z`} fill="#38bdf8" opacity="0.08" />

        {/* break-even */}
        {beX !== null ? (
          <g style={{ transition: "transform .5s ease" }}>
            <line stroke="#94a3b8" strokeDasharray="6 6" strokeWidth="1.5" x1={beX} x2={beX} y1={PAD.t} y2={PAD.t + ih} />
            <text fill="#cbd5e1" fontSize="15" fontWeight="600" textAnchor="middle" x={beX} y={PAD.t - 10}>break-even {compact(out.breakEvenUsers!)}</text>
          </g>
        ) : null}

        {/* series */}
        {SERIES.map((s) => (
          <path d={path(s.key)} fill="none" key={s.key} stroke={s.color} strokeLinejoin="round" strokeWidth="3" style={{ transition: "d .4s ease" }} />
        ))}

        {/* current point */}
        <line stroke="#34d399" strokeOpacity="0.5" strokeWidth="2" x1={curX} x2={curX} y1={PAD.t} y2={PAD.t + ih} style={{ transition: "x1 .4s ease, x2 .4s ease" }} />
        {SERIES.map((s) => (
          <circle cx={curX} cy={yOf(out[s.key])} fill="#020617" key={s.key} r="7" stroke={s.color} strokeWidth="3" style={{ transition: "cx .4s ease, cy .4s ease" }} />
        ))}

        {/* hover */}
        {hover && hovered ? (
          <g>
            <line stroke="#e2e8f0" strokeOpacity="0.5" strokeWidth="1" x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + ih} />
            {SERIES.map((s) => <circle cx={hx} cy={yOf(hovered[s.key])} fill={s.color} key={s.key} r="5" />)}
            <foreignObject height="170" width="280" x={tooltipLeft ? hx + 14 : hx - 294} y={PAD.t + 4}>
              <div className="rounded-xl bg-slate-950/95 px-3 py-2 text-base shadow-xl ring-1 ring-white/10">
                <div className="mb-1 font-semibold text-white">{int.format(hover)} usuários</div>
                {SERIES.map((s) => (
                  <div className="flex items-center justify-between gap-4" key={s.key}>
                    <span className="flex items-center gap-1.5 text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                    <span className="font-mono tabular-nums" style={{ color: s.color }}>{brl.format(hovered[s.key])}</span>
                  </div>
                ))}
                <div className="mt-1 text-sm text-slate-500">clique para simular aqui</div>
              </div>
            </foreignObject>
          </g>
        ) : null}
      </svg>
      </div>
    </figure>
  );
}
