import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { HORIZON_MONTHS, type SimInput, monthFor, simulate, usersAt } from "./sim";
import { compact, int } from "./App";

interface Props {
  input: SimInput;
  hover: number | null; // users under the cursor, shared with the revenue chart
  onHover: (users: number | null) => void;
  onPickUsers: (users: number) => void;
}

/**
 * Usuários ao longo do tempo com crescimento composto. Eixo X em meses.
 * Compartilha o hover (em usuários) com o gráfico de receita: passar o mouse num mês destaca
 * o mesmo tamanho de base lá, e vice-versa. Clique leva o simulador àquele mês.
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
  const PAD = narrow ? { l: 72, r: 16, t: 36, b: 64 } : { l: 96, r: 28, t: 36, b: 70 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const months = useMemo(() => Array.from({ length: HORIZON_MONTHS + 1 }, (_, m) => ({ m, u: usersAt(input, m) })), [input]);
  const yMax = Math.max(months[months.length - 1].u * 1.05, input.users * 1.2);
  const xOf = (m: number) => PAD.l + (m / HORIZON_MONTHS) * iw;
  const yOf = (u: number) => PAD.t + ih - (u / yMax) * ih;
  const path = months.map((p, i) => `${i ? "L" : "M"}${xOf(p.m).toFixed(1)},${yOf(p.u).toFixed(1)}`).join(" ");

  const yTicks = useMemo(() => {
    const raw = yMax / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? raw;
    const t: number[] = [];
    for (let v = 0; v <= yMax; v += step) t.push(v);
    return t;
  }, [yMax]);

  const beMonth = simulate(input).breakEvenUsers;
  const beM = beMonth ? monthFor(input, beMonth) : null;

  const toMonth = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < PAD.l || px > W - PAD.r) return null;
    return Math.round(((px - PAD.l) / iw) * HORIZON_MONTHS);
  };

  // Hover is shared as a user count; map it back to a month on this axis.
  const hm = hover !== null ? monthFor(input, hover) : null;
  const showHover = hm !== null && hm >= 0 && hm <= HORIZON_MONTHS;
  const hx = showHover ? xOf(hm) : 0;
  const tooltipLeft = hx < W * 0.6;

  return (
    <figure className="flex min-h-0 flex-col px-2 py-1">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">📅 Usuários ao longo do tempo</span>
        <span className="text-xs text-zinc-600">{input.growthPct.toFixed(1).replace(".", ",")}% ao mês · {int.format(months[HORIZON_MONTHS].u)} usuários em {HORIZON_MONTHS} meses</span>
      </figcaption>
      <div className="min-h-[220px] w-full lg:min-h-0 lg:flex-1" ref={boxRef}>
        <svg
          aria-label="Gráfico de usuários projetados por mês"
          className="block h-auto w-full cursor-crosshair select-none touch-none font-sans lg:h-full"
          ref={svgRef} role="img" viewBox={`0 0 ${W} ${H}`}
          onPointerMove={(e) => { const m = toMonth(e); onHover(m === null ? null : usersAt(input, m)); }}
          onPointerLeave={() => onHover(null)}
          onPointerDown={(e) => { const m = toMonth(e); if (m !== null) onPickUsers(usersAt(input, m)); }}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line stroke={v === 0 ? "#71717a" : "#e4e4e7"} x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)} />
              <text fill="#52525b" fontSize="17" fontWeight="600" textAnchor="end" x={PAD.l - 12} y={yOf(v) + 6}>{compact(v)}</text>
            </g>
          ))}
          {months.filter((p) => p.m % (narrow ? 6 : 3) === 0).map((p) => (
            <g key={p.m}>
              <line stroke="#e4e4e7" x1={xOf(p.m)} x2={xOf(p.m)} y1={PAD.t} y2={PAD.t + ih} />
              <text fill="#52525b" fontSize="17" fontWeight="600" textAnchor="middle" x={xOf(p.m)} y={PAD.t + ih + 26}>{p.m}</text>
            </g>
          ))}
          <line stroke="#a1a1aa" strokeWidth="2" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} />
          <line stroke="#a1a1aa" strokeWidth="2" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} />
          <text fill="#71717a" fontSize="16" fontWeight="700" textAnchor="middle" x={PAD.l + iw / 2} y={H - 10}>MESES A PARTIR DE HOJE</text>
          <text fill="#71717a" fontSize="16" fontWeight="700" textAnchor="middle" transform={`translate(22 ${PAD.t + ih / 2}) rotate(-90)`}>USUÁRIOS</text>

          <path d={`${path} L${xOf(HORIZON_MONTHS)},${yOf(0)} L${PAD.l},${yOf(0)} Z`} fill="#059669" opacity="0.08" />
          <path d={path} fill="none" stroke="#059669" strokeLinejoin="round" strokeWidth="3" style={{ transition: "d .4s ease" }} />

          {beM !== null && beM >= 0 && beM <= HORIZON_MONTHS ? (
            <g>
              <line stroke="#71717a" strokeDasharray="6 6" strokeWidth="1.5" x1={xOf(beM)} x2={xOf(beM)} y1={PAD.t} y2={PAD.t + ih} />
              <text fill="#52525b" fontSize="15" fontWeight="600" textAnchor="middle" x={xOf(beM)} y={PAD.t - 10}>break-even no mês {Math.ceil(beM)}</text>
            </g>
          ) : null}

          <circle cx={xOf(0)} cy={yOf(input.users)} fill="#fff" r="7" stroke="#059669" strokeWidth="3" style={{ transition: "cy .4s ease" }} />

          {showHover && hover !== null ? (
            <g>
              <line stroke="#3f3f46" strokeOpacity="0.5" x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + ih} />
              <circle cx={hx} cy={yOf(hover)} fill="#059669" r="5" />
              <foreignObject height="90" width="230" x={tooltipLeft ? hx + 14 : hx - 244} y={PAD.t + 4}>
                <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-zinc-200">
                  <div className="font-semibold text-zinc-900">Mês {Math.round(hm!)}</div>
                  <div className="font-mono tabular-nums text-emerald-700">{int.format(hover)} usuários</div>
                  <div className="mt-1 text-xs text-zinc-400">clique para simular aqui</div>
                </div>
              </foreignObject>
            </g>
          ) : null}
        </svg>
      </div>
    </figure>
  );
}
