import { useMemo, useRef, useState } from "react";
import Shape from "./Shape.jsx";
import { Tooltip, placeTip } from "./Charts.jsx";
import { clusterColor, fmt, niceTicks, svgPoint } from "../lib.js";

/** ดันป้ายปลายเส้นลงให้ห่างกันอย่างน้อย gap px และไม่ล้นขอบล่าง */
function spreadLabels(items, gap, maxY) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
  const over = items.length ? items[items.length - 1].y - maxY : 0;
  if (over > 0) items.forEach((it) => { it.y -= over; });
  return items;
}

/* ---------------- เพลงไต่อันดับ: เส้นอันดับรายวันของ Top climbers ---------------- */
export function ClimberChart({ series, fromDay, toDay, markDay, dateOf }) {
  const wrap = useRef(null);
  const svgRef = useRef(null);
  const [hx, setHx] = useState(null);
  const [tip, setTip] = useState(null);
  const W = 720, H = 240, m = { l: 44, r: 132, t: 12, b: 30 };
  const inRange = (d) => d >= fromDay && d <= toDay;
  const ranks = series.flatMap((s) => s.pts.filter(([d]) => inRange(d)).map(([, r]) => r));
  const rMin = Math.max(1, Math.min(200, ...ranks) - 5);
  const rMax = Math.min(200, Math.max(1, ...ranks) + 5);
  const span = Math.max(1, toDay - fromDay);
  const sx = (d) => m.l + ((d - fromDay) / span) * (W - m.l - m.r);
  const sy = (r) => m.t + ((r - rMin) / Math.max(1, rMax - rMin)) * (H - m.t - m.b);
  const path = (pts) => {
    let d = "", prev = null;
    for (const [x, r] of pts) {
      if (!inRange(x)) { prev = null; continue; }
      d += (prev != null && x - prev === 1 ? "L" : "M") + sx(x).toFixed(1) + "," + sy(r).toFixed(1);
      prev = x;
    }
    return d;
  };
  const ends = spreadLabels(series.map((s) => {
    const last = [...s.pts].reverse().find(([d]) => inRange(d));
    return last ? { s, y: sy(last[1]), d: last[0], r: last[1] } : null;
  }).filter(Boolean), 15, H - m.b);
  const yTicks = niceTicks(rMin, rMax, 5).filter((t) => t >= rMin && t <= rMax);
  const xTicks = niceTicks(fromDay, toDay, 5).filter((t) => Number.isInteger(t));
  return (
    <div className="chart" ref={wrap}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="อันดับรายวันของเพลงที่ไต่อันดับมากที่สุด"
        onMouseMove={(e) => {
          const p = svgPoint(e, svgRef.current, W, H);
          const day = Math.round(fromDay + ((p.x - m.l) / (W - m.l - m.r)) * span);
          if (!inRange(day)) { setHx(null); setTip(null); return; }
          setHx(day);
          const rows = series.map((s) => ({ s, r: s.pts.find((q) => q[0] === day)?.[1] }))
            .sort((a, b) => (a.r ?? 999) - (b.r ?? 999));
          setTip(placeTip(e, wrap.current, (
            <>
              <b>{dateOf(day)}</b>
              {rows.map(({ s, r }) => (
                <div key={s.id} className="tip-row">
                  <i style={{ background: s.color }} className="sw" />
                  <span className="tip-name">{s.t}</span>
                  <span className="mono">{r ? `#${r}` : "ไม่ติด"}</span>
                </div>
              ))}
            </>)));
        }}
        onMouseLeave={() => { setHx(null); setTip(null); }}>
        {markDay != null && markDay > fromDay && (
          <g>
            <rect x={sx(markDay)} y={m.t} width={sx(toDay) - sx(markDay)} height={H - m.t - m.b} className="period-band" />
            <text x={sx(markDay) + 6} y={H - m.b - 6} className="tick">ช่วงที่เทียบ</text>
          </g>
        )}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">#{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - m.b + 16} className="tick" textAnchor="middle">{dateOf(t)}</text>
        ))}
        {series.map((s) => (
          <path key={s.id} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {ends.map(({ s, y, d, r }) => (
          <g key={"e" + s.id}>
            <circle cx={sx(d)} cy={sy(r)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            <text x={W - m.r + 10} y={y} className="end-label" dominantBaseline="middle">
              {s.t.length > 15 ? s.t.slice(0, 14) + "…" : s.t}
            </text>
          </g>
        ))}
        {hx != null && <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} className="crosshair" />}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- การเปลี่ยนอันดับเฉลี่ยตามกลุ่ม (แท่งสองทิศรอบ 0) ---------------- */
export function MomentumBars({ rows, dark }) {
  const wrap = useRef(null);
  const [tip, setTip] = useState(null);
  const W = 440, rowH = 28, m = { l: 104, r: 48, t: 4, b: 22 };
  const H = m.t + m.b + rows.length * rowH;
  const ext = 1.25 * Math.max(1, ...rows.map((r) => Math.abs(r.mean ?? 0)));
  const sx = (v) => m.l + ((v + ext) / (2 * ext)) * (W - m.l - m.r);
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="การเปลี่ยนอันดับเฉลี่ยของแต่ละกลุ่ม">
        {rows.map((r, i) => {
          const y = m.t + i * rowH + 7, h = rowH - 14;
          const v = r.mean ?? 0;
          const x0 = sx(Math.min(0, v)), x1 = sx(Math.max(0, v));
          return (
            <g key={r.cluster}
              onMouseMove={(e) => setTip(placeTip(e, wrap.current, (
                <>
                  <b>กลุ่ม {r.cluster}</b>
                  <div className="muted">{r.name}</div>
                  <div className="mono">เฉลี่ย {v > 0 ? "+" : ""}{fmt.num(v)} อันดับ · {r.n} เพลงที่เทียบได้</div>
                </>)))}
              onMouseLeave={() => setTip(null)}>
              <rect x={0} y={y - 6} width={W} height={rowH - 2} fill="transparent" />
              <Shape c={r.cluster} x={12} y={y + h / 2} r={5} fill={clusterColor(r.cluster, dark)} sw={0} />
              <text x={24} y={y + h / 2} className="tick" dominantBaseline="middle">กลุ่ม {r.cluster}</text>
              {r.n > 0 && (
                <path className="hbar" fill={clusterColor(r.cluster, dark)}
                  d={v >= 0
                    ? `M${x0},${y} H${Math.max(x0 + 2, x1 - 4)} q4,0 4,4 V${y + h - 4} q0,4 -4,4 H${x0} Z`
                    : `M${x1},${y} H${Math.min(x1 - 2, x0 + 4)} q-4,0 -4,4 V${y + h - 4} q0,4 4,4 H${x1} Z`} />
              )}
              <text x={v >= 0 ? x1 + 6 : x0 - 6} y={y + h / 2} className="val" dominantBaseline="middle"
                textAnchor={v >= 0 ? "start" : "end"}>{r.n ? `${v > 0 ? "+" : ""}${fmt.num(v)}` : "ไม่มีข้อมูล"}</text>
            </g>
          );
        })}
        <line x1={sx(0)} x2={sx(0)} y1={m.t} y2={H - m.b + 2} className="axis" />
        <text x={sx(-ext)} y={H - 6} className="tick">▼ ร่วงลง</text>
        <text x={sx(ext)} y={H - 6} className="tick" textAnchor="end">ไต่ขึ้น ▲</text>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- Silhouette ต่อ k ของทุกโมเดล ---------------- */
export function ModelKLines({ models, colors, current }) {
  const wrap = useRef(null);
  const svgRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [hk, setHk] = useState(null);
  const W = 560, H = 220, m = { l: 44, r: 132, t: 12, b: 30 };
  const ks = [...new Set(models.flatMap((md) => md.k_scores.map((r) => r.k)))].sort((a, b) => a - b);
  const vals = models.flatMap((md) => md.k_scores.map((r) => r.silhouette).filter((v) => v != null));
  const yMin = Math.floor(Math.min(...vals) * 20) / 20, yMax = Math.ceil(Math.max(...vals) * 20) / 20;
  const sx = (k) => m.l + ((k - ks[0]) / Math.max(1, ks[ks.length - 1] - ks[0])) * (W - m.l - m.r);
  const sy = (v) => m.t + (1 - (v - yMin) / Math.max(0.01, yMax - yMin)) * (H - m.t - m.b);
  const ends = spreadLabels(models.map((md) => {
    const last = md.k_scores.filter((r) => r.silhouette != null).at(-1);
    return last ? { md, y: sy(last.silhouette) } : null;
  }).filter(Boolean), 15, H - m.b);
  return (
    <div className="chart" ref={wrap}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Silhouette ต่อจำนวนกลุ่มของแต่ละโมเดล"
        onMouseMove={(e) => {
          const p = svgPoint(e, svgRef.current, W, H);
          const k = ks.reduce((b, kk) => (Math.abs(sx(kk) - p.x) < Math.abs(sx(b) - p.x) ? kk : b), ks[0]);
          setHk(k);
          setTip(placeTip(e, wrap.current, (
            <>
              <b>k = {k}</b>
              {models.map((md) => {
                const r = md.k_scores.find((q) => q.k === k);
                return (
                  <div key={md.key} className="tip-row">
                    <i className="sw" style={{ background: colors[md.key] }} />
                    <span className="tip-name">{md.name}{md.best_k === k ? " (เลือก)" : ""}</span>
                    <span className="mono">{r?.silhouette != null ? r.silhouette.toFixed(3) : "–"}</span>
                  </div>
                );
              })}
            </>)));
        }}
        onMouseLeave={() => { setTip(null); setHk(null); }}>
        {niceTicks(yMin, yMax, 4).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t.toFixed(2)}</text>
          </g>
        ))}
        {ks.map((k) => <text key={k} x={sx(k)} y={H - m.b + 16} className="tick" textAnchor="middle">k={k}</text>)}
        {hk != null && <line x1={sx(hk)} x2={sx(hk)} y1={m.t} y2={H - m.b} className="crosshair" />}
        {models.map((md) => {
          const pts = md.k_scores.filter((r) => r.silhouette != null);
          const on = md.key === current;
          return (
            <g key={md.key}>
              <path d={pts.map((r, i) => `${i ? "L" : "M"}${sx(r.k)},${sy(r.silhouette)}`).join("")}
                fill="none" stroke={colors[md.key]} strokeWidth={on ? 3 : 2} strokeLinejoin="round" />
              {pts.map((r) => (
                <circle key={r.k} cx={sx(r.k)} cy={sy(r.silhouette)} r={r.k === md.best_k ? 6 : 4}
                  fill={r.k === md.best_k ? colors[md.key] : "var(--surface)"} stroke={colors[md.key]} strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {ends.map(({ md, y }) => (
          <text key={md.key} x={W - m.r + 10} y={y} className={"end-label" + (md.key === current ? " strong" : "")}
            dominantBaseline="middle">{md.name}</text>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- ความสอดคล้องระหว่างโมเดล (Adjusted Rand Index) ---------------- */
export function AgreementMatrix({ models, agreement }) {
  const ari = (a, b) => (a === b ? 1 : agreement.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))?.ari);
  return (
    <div className="ari" role="table" aria-label="ARI ระหว่างคู่โมเดล"
      style={{ gridTemplateColumns: `minmax(96px, 1.3fr) repeat(${models.length}, minmax(0, 1fr))` }}>
      <span />
      {models.map((m) => <span key={m.key} className="ari-h small muted">{m.name}</span>)}
      {models.map((r) => (
        <div key={r.key} style={{ display: "contents" }} role="row">
          <span className="ari-h ari-row small muted">{r.name}</span>
          {models.map((c) => {
            const v = ari(r.key, c.key);
            return (
              <span key={c.key} role="cell" className={"ari-cell mono" + (r.key === c.key ? " diag" : v != null && v >= 0.45 ? " hi" : "")}
                style={{ "--a": v == null ? 0 : Math.max(0, v) }}
                title={`ARI ${r.name} กับ ${c.name} = ${v == null ? "–" : v.toFixed(3)}`}>
                {v == null ? "–" : v.toFixed(2)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------------- PCA ขนาดเล็กสำหรับเทียบโมเดลแบบ small multiples ---------------- */
export function MiniScatter({ songs, labels, dark, label }) {
  const W = 260, H = 160, p = 6;
  const ext = useMemo(() => {
    const xs = songs.map((s) => s.x), ys = songs.map((s) => s.y);
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
  }, [songs]);
  const sx = (v) => p + ((v - ext.x[0]) / (ext.x[1] - ext.x[0] || 1)) * (W - 2 * p);
  const sy = (v) => H - p - ((v - ext.y[0]) / (ext.y[1] - ext.y[0] || 1)) * (H - 2 * p);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-scatter" role="img" aria-label={label}>
      {songs.map((s, i) => (
        <Shape key={s.id} c={labels[i]} x={sx(s.x)} y={sy(s.y)} r={3.2} fill={clusterColor(labels[i], dark)} sw={0.8} />
      ))}
    </svg>
  );
}

/* ---------------- Sparkline อันดับ ---------------- */
export function Sparkline({ song, color = "var(--accent)" }) {
  const W = 240, H = 64;
  const max = song.hd[song.hd.length - 1], min = song.hd[0];
  const sx = (d) => 2 + ((d - min) / Math.max(1, max - min)) * (W - 4);
  const sy = (r) => 4 + ((r - 1) / 199) * (H - 8);
  let d = "", prev = null;
  song.hd.forEach((x, i) => {
    d += (prev != null && x - prev === 1 ? "L" : "M") + sx(x).toFixed(1) + "," + sy(song.hr[i]).toFixed(1);
    prev = x;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label={`ประวัติอันดับของ ${song.t}`}>
      <line x1={0} x2={W} y1={sy(1)} y2={sy(1)} className="grid" />
      <line x1={0} x2={W} y1={sy(200)} y2={sy(200)} className="grid" />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- แผนภาพอธิบายหลักการของแต่ละโมเดล (ภาพประกอบ ไม่ใช่ข้อมูลจริง) ---------------- */
export function ModelSchematic({ kind }) {
  const pts = [[30, 40], [42, 30], [50, 48], [36, 58], [58, 36], [120, 44], [132, 30], [140, 52], [126, 60], [112, 34],
    [80, 100], [92, 112], [70, 114], [86, 124], [100, 98]];
  const grp = (i) => (i < 5 ? 0 : i < 10 ? 1 : 2);
  const col = ["var(--s0)", "var(--s1)", "var(--s2)"];
  return (
    <svg viewBox="0 0 170 140" className="schematic" aria-hidden>
      {kind === "kmeans" && (
        <>
          <path d="M85 0 L85 70 L0 110 M85 70 L170 110" className="schem-line" />
          {[[43, 44], [126, 44], [86, 110]].map(([x, y], i) => (
            <g key={i}><line x1={x - 6} x2={x + 6} y1={y} y2={y} className="schem-c" stroke={col[i]} />
              <line x1={x} x2={x} y1={y - 6} y2={y + 6} className="schem-c" stroke={col[i]} /></g>
          ))}
        </>
      )}
      {kind === "gmm" && (
        <>
          <ellipse cx={44} cy={44} rx={26} ry={16} transform="rotate(-30 44 44)" className="schem-ell" stroke={col[0]} />
          <ellipse cx={126} cy={45} rx={22} ry={20} className="schem-ell" stroke={col[1]} />
          <ellipse cx={86} cy={111} rx={30} ry={14} transform="rotate(10 86 111)" className="schem-ell" stroke={col[2]} />
          <ellipse cx={44} cy={44} rx={42} ry={28} transform="rotate(-30 44 44)" className="schem-ell faint" stroke={col[0]} />
        </>
      )}
      {kind === "agglomerative" && (
        <g className="schem-line">
          <path d="M20 132 V118 H40 V132 M30 118 V104 H60 V132 M45 104 V86" />
          <path d="M110 132 V120 H130 V132 M120 120 V100 H150 V132 M135 100 V86" />
          <path d="M45 86 H135 M90 86 V70" />
          <path d="M75 132 V112 H95 V132 M85 112 V86" />
          <line x1={10} x2={160} y1={94} y2={94} className="schem-cut" />
        </g>
      )}
      {kind !== "agglomerative" && pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.6} fill={col[grp(i)]} />
      ))}
      {kind === "agglomerative" && [20, 40, 60, 75, 95, 110, 130, 150].map((x, i) => (
        <circle key={i} cx={x} cy={134} r={3.6} fill={col[i < 3 ? 0 : i < 5 ? 2 : 1]} />
      ))}
    </svg>
  );
}
