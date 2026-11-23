import { useMemo, useRef, useState } from "react";
import Shape from "./Shape.jsx";
import { clusterColor, fmt, niceTicks, svgPoint } from "../lib.js";

export function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.left, top: tip.top }}>
      {tip.content}
    </div>
  );
}

export function placeTip(evt, wrap, content) {
  const r = wrap.getBoundingClientRect();
  let left = evt.clientX - r.left + 14;
  const top = evt.clientY - r.top + 14;
  if (left > r.width - 230) left = evt.clientX - r.left - 240;
  return { left, top, content };
}

/* ---------------- Silhouette ต่อ k ---------------- */
export function SilhouetteChart({ kScores, bestK }) {
  const wrap = useRef(null);
  const [tip, setTip] = useState(null);
  const W = 560, H = 210, m = { l: 44, r: 12, t: 22, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const rows = kScores;
  const maxV = Math.max(0.1, ...rows.map((r) => r.silhouette ?? 0));
  const yMax = Math.ceil(maxV * 10) / 10;
  const bw = iw / rows.length;
  const y = (v) => m.t + ih - (v / yMax) * ih;
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Silhouette Score ของแต่ละ k">
        {niceTicks(0, yMax, 4).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t.toFixed(2)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
          const tested = r.silhouette != null;
          const best = r.k === bestK;
          return (
            <g key={r.k}
              onMouseMove={(e) => setTip(placeTip(e, wrap.current, (
                <>
                  <b>k = {r.k}{best ? " (เลือก)" : ""}</b>
                  {tested ? (<>
                    <div>Silhouette <span className="mono">{r.silhouette.toFixed(4)}</span></div>
                    <div>ขนาดกลุ่ม <span className="mono">{r.cluster_sizes.join(" · ")}</span></div>
                  </>) : <div>{r.status}</div>}
                </>)))}
              onMouseLeave={() => setTip(null)}>
              <rect x={m.l + i * bw} y={m.t} width={bw} height={ih} fill="transparent" />
              {tested ? (
                <>
                  <path d={`M${x},${y(0)} V${y(r.silhouette) + 4} q0,-4 4,-4 H${x + w - 4} q4,0 4,4 V${y(0)} Z`}
                    className={best ? "bar bar-best" : "bar"} />
                  <text x={x + w / 2} y={y(r.silhouette) - 6} textAnchor="middle" className={best ? "val val-strong" : "val"}>
                    {r.silhouette.toFixed(3)}
                  </text>
                </>
              ) : (
                <text x={x + w / 2} y={y(0) - 8} textAnchor="middle" className="val muted">ข้าม</text>
              )}
              <text x={x + w / 2} y={H - 12} textAnchor="middle" className="tick">k={r.k}</text>
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} className="axis" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- PCA scatter ---------------- */
export function PcaScatter({ songs, clusters, hidden, dark, selected, recIds, onPick, explained }) {
  const wrap = useRef(null);
  const svgRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [hover, setHover] = useState(null);
  const W = 720, H = 340, m = { l: 44, r: 16, t: 12, b: 36 };
  const ext = useMemo(() => {
    const xs = songs.map((s) => s.x), ys = songs.map((s) => s.y);
    const pad = (a, b) => [a - (b - a) * 0.04, b + (b - a) * 0.04];
    return { x: pad(Math.min(...xs), Math.max(...xs)), y: pad(Math.min(...ys), Math.max(...ys)) };
  }, [songs]);
  const sx = (v) => m.l + ((v - ext.x[0]) / (ext.x[1] - ext.x[0])) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - ext.y[0]) / (ext.y[1] - ext.y[0])) * (H - m.t - m.b);
  const visible = songs.filter((s) => !hidden.has(s.c));
  const name = (c) => clusters.find((k) => k.cluster === c)?.cluster_name;
  const recSet = new Set(recIds);

  function nearest(evt) {
    const p = svgPoint(evt, svgRef.current, W, H);
    let best = null, bd = Infinity;
    for (const s of visible) {
      const d = (sx(s.x) - p.x) ** 2 + (sy(s.y) - p.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return bd < 18 * 18 ? best : null;
  }

  return (
    <div className="chart" ref={wrap}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="กราฟ PCA สองมิติของเพลงตามกลุ่ม"
        onMouseMove={(e) => {
          const s = nearest(e);
          setHover(s?.id ?? null);
          setTip(s ? placeTip(e, wrap.current, (
            <>
              <b>{s.t}</b>
              <div className="muted">{s.a}</div>
              <div>กลุ่ม {s.c}: {name(s.c)}</div>
              <div className="mono">ดีสุด #{s.br} · มัธยฐาน #{fmt.num(s.mr)} · {s.d} วัน · ถึงพีค {s.dp} วัน</div>
              <div className="hint">คลิกเพื่อดูเพลงที่คล้าย</div>
            </>)) : null);
        }}
        onMouseLeave={() => { setTip(null); setHover(null); }}
        onClick={(e) => { const s = nearest(e); if (s) onPick(s.id); }}
        style={{ cursor: hover ? "pointer" : "default" }}>
        {niceTicks(ext.x[0], ext.x[1], 6).map((t) => (
          <g key={"x" + t}>
            <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} className="grid" />
            <text x={sx(t)} y={H - m.b + 16} className="tick" textAnchor="middle">{t}</text>
          </g>
        ))}
        {niceTicks(ext.y[0], ext.y[1], 5).map((t) => (
          <g key={"y" + t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        <text x={(W + m.l) / 2} y={H - 6} className="axis-label" textAnchor="middle">
          PC1 ({fmt.num(explained[0] * 100)}%)
        </text>
        <text x={12} y={(H - m.b) / 2} className="axis-label" textAnchor="middle" transform={`rotate(-90 12 ${(H - m.b) / 2})`}>
          PC2 ({fmt.num(explained[1] * 100)}%)
        </text>
        <g opacity={selected ? 0.45 : 0.9}>
          {visible.map((s) => (
            <Shape key={s.id} c={s.c} x={sx(s.x)} y={sy(s.y)} r={4.2} fill={clusterColor(s.c, dark)} sw={1} />
          ))}
        </g>
        {visible.filter((s) => recSet.has(s.id) || s.id === hover).map((s) => (
          <Shape key={"h" + s.id} c={s.c} x={sx(s.x)} y={sy(s.y)} r={6.5} fill={clusterColor(s.c, dark)} sw={2} />
        ))}
        {selected && !hidden.has(selected.c) && (
          <g>
            <circle cx={sx(selected.x)} cy={sy(selected.y)} r={13} className="seed-ring" />
            <Shape c={selected.c} x={sx(selected.x)} y={sy(selected.y)} r={7.5} fill={clusterColor(selected.c, dark)} sw={2} />
          </g>
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- ประวัติอันดับ (จัดแนวตามวันหลังพบครั้งแรก) ---------------- */
const LINE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const LINE_COLORS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];

export function RankHistory({ seed, recs, dark, height = 230 }) {
  const wrap = useRef(null);
  const svgRef = useRef(null);
  const [hx, setHx] = useState(null);
  const [tip, setTip] = useState(null);
  const W = 720, H = height, m = { l: 44, r: 16, t: 12, b: 34 };
  const series = useMemo(() => {
    const pal = dark ? LINE_COLORS_DARK : LINE_COLORS;
    const mk = (s, color, isSeed) => {
      const off = s.hd[0];
      return { id: s.id, t: s.t, color, isSeed, pts: s.hd.map((d, i) => [d - off, s.hr[i]]) };
    };
    return [...recs.map((r, i) => mk(r, pal[i % pal.length], false)), mk(seed, "var(--ink)", true)];
  }, [seed, recs, dark]);
  const maxX = Math.max(10, ...series.map((s) => s.pts[s.pts.length - 1][0]));
  const sx = (v) => m.l + (v / maxX) * (W - m.l - m.r);
  const sy = (r) => m.t + ((r - 1) / 199) * (H - m.t - m.b);
  const path = (pts) => {
    let d = "", prev = null;
    for (const [x, r] of pts) {
      d += (prev != null && x - prev === 1 ? "L" : "M") + sx(x).toFixed(1) + "," + sy(r).toFixed(1);
      prev = x;
    }
    return d;
  };
  return (
    <div className="chart" ref={wrap}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ประวัติอันดับของเพลงตั้งต้นและเพลงที่แนะนำ"
        onMouseMove={(e) => {
          const p = svgPoint(e, svgRef.current, W, H);
          const day = Math.round(((p.x - m.l) / (W - m.l - m.r)) * maxX);
          if (day < 0 || day > maxX) { setHx(null); setTip(null); return; }
          setHx(day);
          const rows = series.map((s) => ({ s, r: s.pts.find((q) => q[0] === day)?.[1] }))
            .sort((a, b) => (a.r ?? 999) - (b.r ?? 999));
          setTip(placeTip(e, wrap.current, (
            <>
              <b>วันที่ {day} หลังพบครั้งแรก</b>
              {rows.map(({ s, r }) => (
                <div key={s.id} className="tip-row">
                  <i style={{ background: s.color }} className={s.isSeed ? "sw sw-seed" : "sw"} />
                  <span className="tip-name">{s.t}</span>
                  <span className="mono">{r ? `#${r}` : "ไม่ติด"}</span>
                </div>
              ))}
            </>)));
        }}
        onMouseLeave={() => { setHx(null); setTip(null); }}>
        {[1, 50, 100, 150, 200].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">#{t}</text>
          </g>
        ))}
        {niceTicks(0, maxX, 6).map((t) => (
          <text key={t} x={sx(t)} y={H - m.b + 16} className="tick" textAnchor="middle">{t}</text>
        ))}
        <text x={(W + m.l) / 2} y={H - 4} className="axis-label" textAnchor="middle">วันหลังเข้าชาร์ต</text>
        {series.map((s) => (
          <path key={s.id} d={path(s.pts)} fill="none" stroke={s.color}
            strokeWidth={s.isSeed ? 3 : 1.6} strokeLinejoin="round" strokeLinecap="round" opacity={s.isSeed ? 1 : 0.85} />
        ))}
        {hx != null && <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} className="crosshair" />}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- แถบเปรียบเทียบเล็ก ---------------- */
export function MiniBar({ value, max, color = "var(--accent)" }) {
  const w = Math.max(2, Math.min(100, (value / max) * 100));
  return <span className="minibar"><span style={{ width: `${w}%`, background: color }} /></span>;
}
