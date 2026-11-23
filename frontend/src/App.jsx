import { useEffect, useMemo, useRef, useState } from "react";
import { MiniBar, PcaScatter, RankHistory, SilhouetteChart } from "./components/Charts.jsx";
import { AgreementMatrix, ClimberChart, MiniScatter, ModelKLines, ModelSchematic, MomentumBars, Sparkline }
  from "./components/MoreCharts.jsx";
import Cover from "./components/Cover.jsx";
import Shape from "./components/Shape.jsx";
import Uploader from "./components/Uploader.jsx";
import {
  FEATURE_TH, addDays, applyModel, chartMoves, clusterColor, fmt, fmtDate, getModels, lastDay, recommend,
  searchSongs, titleCounts,
} from "./lib.js";
import { COMPARE_ROWS, METRIC_INFO, MODEL_COLOR, MODEL_INFO } from "./models.js";

const SOURCES = [
  { key: "real", label: "ข้อมูลจริง" },
  { key: "synthetic", label: "ข้อมูลจำลอง" },
];

const VIEWS = [
  { key: "overview", label: "ภาพรวม", title: "ภาพรวม", icon: "bars" },
  { key: "climbers", label: "ไต่อันดับ", title: "เพลงไต่อันดับ", icon: "rise" },
  { key: "models", label: "โมเดล", title: "เปรียบเทียบโมเดล", icon: "layers" },
  { key: "finder", label: "เพลงคล้าย", title: "ค้นหาเพลงที่ติดชาร์ตคล้ายกัน", icon: "note" },
  { key: "data", label: "ข้อมูล", title: "ข้อมูล", icon: "db" },
];

const LINE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const LINE_COLORS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const PERIODS = [1, 7, 30];
const MOVE_MODES = [
  { key: "up", label: "ไต่ขึ้น" },
  { key: "new", label: "เข้าใหม่" },
  { key: "down", label: "ร่วงลง" },
];

function store(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

function useTheme() {
  const [theme, setTheme] = useState(() => store("theme", "dark"));
  useEffect(() => { document.documentElement.dataset.theme = theme; save("theme", theme); }, [theme]);
  return [theme, setTheme];
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [available, setAvailable] = useState({});
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  // โหลดผลลัพธ์จากเซิร์ฟเวอร์ (prefer ข้อมูลจริง) — เรียกซ้ำได้หลังอัปโหลดและรันวิเคราะห์ใหม่
  const loadAll = (prefer) => Promise.all(SOURCES.map((s) =>
    fetch(`data/${s.key}.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then(([real, synth]) => {
      setAvailable((a) => ({ ...a, real, synthetic: synth }));
      const first = (prefer && { real, synthetic: synth }[prefer] ? prefer : null) || (real ? "real" : synth ? "synthetic" : null);
      if (!first) setError("ยังไม่พบไฟล์ผลลัพธ์ — รัน `python -m thai_chart_ml run` ก่อน แล้วเปิดด้วย `python -m thai_chart_ml serve`");
      setSource(first);
      setVersion((v) => v + 1);
    });
  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // เปิดไฟล์ dashboard.json จากเครื่องผู้ใช้โดยตรง (ไม่ต้องผ่านเซิร์ฟเวอร์)
  const openLocal = (obj) => {
    setAvailable((a) => ({ ...a, local: obj }));
    setSource("local");
    setVersion((v) => v + 1);
  };

  const data = source ? available[source] : null;
  if (error) return <div className="center"><div className="card">{error}</div></div>;
  if (!data) return <div className="center"><div className="loading">กำลังโหลดผลการวิเคราะห์…</div></div>;
  return <Dashboard key={`${source}-${version}`} data={data} theme={theme} setTheme={setTheme}
    source={source} onReload={loadAll} onOpenLocal={openLocal} />;
}

function Dashboard({ data, theme, setTheme, source, onReload, onOpenLocal }) {
  const dark = theme === "dark";
  const { meta, evaluation, data_quality: dq, audio_stats: audio } = data;
  const synthetic = meta.data_source === "synthetic";
  const models = useMemo(() => getModels(data), [data]);
  // มุมมองอยู่ใน URL (#climbers, #models, …) จึงแชร์ลิงก์และกดย้อนกลับได้
  const viewFromHash = () => {
    const h = window.location.hash.slice(1);
    return VIEWS.some((x) => x.key === h) ? h : "overview";
  };
  const [view, setViewRaw] = useState(viewFromHash);
  useEffect(() => {
    const on = () => setViewRaw(viewFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setView = (v) => { window.location.hash = v; window.scrollTo({ top: 0 }); };
  const [modelKey, setModelKeyRaw] = useState(() => store("model", data.default_model || "kmeans"));
  const setModelKey = (k) => { setModelKeyRaw(k); save("model", k); };
  const model = models.find((m) => m.key === modelKey) || models[0];
  const songs = useMemo(() => applyModel(data.songs, model), [data.songs, model]);
  const clusters = model.clusters;
  const [seedId, setSeedId] = useState(() => evaluation.per_seed[0]?.seed_track_id || data.songs[0].id);
  const seed = songs.find((s) => s.id === seedId);
  const dayMax = useMemo(() => lastDay(songs), [songs]);
  const dateOf = (d) => fmtDate(addDays(data.window_start, d));
  const modelColors = Object.fromEntries(models.map((m) => [m.key, clusterColor(MODEL_COLOR[m.key] ?? 0, dark)]));
  const v = VIEWS.find((x) => x.key === view);
  const ctx = { data, songs, model, models, clusters, dark, seed, seedId, setSeedId, setView, setModelKey,
    modelColors, dateOf, dayMax };

  return (
    <div className="app">
      <aside className="side">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 32 32"><path d="M5 25 L11 14 L17 19 L23 7 L28 11" /></svg>
        </span>
        <nav className="nav" aria-label="มุมมอง">
          {VIEWS.map((x) => (
            <button key={x.key} className={"nav-btn" + (view === x.key ? " on" : "")} onClick={() => setView(x.key)}
              aria-current={view === x.key ? "page" : undefined} title={x.title}>
              <Icon name={x.icon} />
              <span>{x.label}</span>
            </button>
          ))}
        </nav>
        <button className="nav-btn theme" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="สลับธีม" title="สลับธีม">
          <Icon name={dark ? "sun" : "moon"} /><span>ธีม</span>
        </button>
      </aside>

      <main className="main">
        <header className="top">
          <div className="top-title">
            <h1>{v.title}</h1>
            <p className="muted small">Top 200 · {fmt.int(meta.n_songs)} เพลง</p>
          </div>
          <div className="top-controls">
            <ModelPicker models={models} model={model} onPick={setModelKey} onCompare={() => setView("models")} />
          </div>
        </header>
        {view === "overview" && <Overview {...ctx} />}
        {view === "climbers" && <Climbers {...ctx} />}
        {view === "models" && <Models {...ctx} />}
        {view === "finder" && <Finder {...ctx} />}
        {view === "data" && (
          <>
            <Uploader source={source} onReload={onReload} onOpenLocal={onOpenLocal} />
            <DataQuality meta={meta} dq={dq} audio={audio} />
          </>
        )}
        <footer className="foot">
          {meta.generated_at.slice(0, 10)} · Spotify Charts (Kaggle) · Spotify Songs (TidyTuesday){synthetic ? " · ข้อมูลจำลอง" : ""}
        </footer>
      </main>

      <aside className="rail">
        <RailModel model={model} colors={modelColors} onCompare={() => setView("models")} />
        <RailClimbers songs={songs} dayMax={dayMax} dateOf={dateOf} onPick={(id) => setSeedId(id)}
          onMore={() => setView("climbers")} />
        {seed && <RailSeed seed={seed} cluster={clusters.find((c) => c.cluster === seed.c)} dark={dark}
          onFind={() => setView("finder")} />}
      </aside>
    </div>
  );
}

/* =================================================================== */
/*  ตัวเลือกโมเดล                                                        */
/* =================================================================== */
function ModelPicker({ models, model, onPick, onCompare }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="eyebrow">โมเดล</span>
        <b>{model.name}</b>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 4 L6 8 L10 4" /></svg>
      </button>
      {open && (
        <div className="picker-pop" role="listbox" aria-label="เลือกโมเดลจัดกลุ่ม">
          {models.map((m) => (
            <button key={m.key} role="option" aria-selected={m.key === model.key}
              className={"picker-opt" + (m.key === model.key ? " on" : "")}
              onClick={() => { onPick(m.key); setOpen(false); }}>
              <span className="picker-row">
                <b>{m.name}</b>
                {m.key === model.key && <span className="check" aria-hidden>✓</span>}
              </span>
              <span className="mono small">k = {m.best_k} · Silhouette {fmt.num(m.metrics.silhouette, 3)}</span>
            </button>
          ))}
          <button className="picker-foot" onClick={() => { setOpen(false); onCompare(); }}>
            เปรียบเทียบโมเดล →
          </button>
        </div>
      )}
    </div>
  );
}

/* =================================================================== */
/*  ภาพรวม                                                              */
/* =================================================================== */
function Overview({ data, songs, model, clusters, dark, seed, setSeedId, dayMax }) {
  const { meta, data_quality: dq, audio_stats: audio } = data;
  const win = dq.date_window;
  const [hidden, setHidden] = useState(new Set());
  const recs = useMemo(() => recommend(songs, seed?.id, 5), [songs, seed]);
  const toggle = (c) => setHidden((h) => { const n = new Set(h); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const kScores = model.k_scores;
  return (
    <>
      <section className="kpis">
        <Kpi label="เพลง" value={fmt.int(meta.n_songs)} />
        <Kpi label="ช่วงข้อมูล" value={`${win.days_with_data} วัน`} note={`${win.actual_first_date} → ${win.actual_last_date}`} />
        <Kpi label="จับคู่ข้อมูลเสียง" value={fmt.pct(audio.matched_pct)} />
        <Kpi label={model.name} value={`k = ${model.best_k}`} note={`Silhouette ${fmt.num(model.metrics.silhouette, 3)}`} accent />
      </section>

      <section className="grid-ov">
        <div className="stack">
          <div className="card">
            <CardHead title="Silhouette ต่อ k" />
            <SilhouetteChart kScores={kScores} bestK={model.best_k} />
          </div>
          <TrendingPlayer songs={songs} dayMax={dayMax} onPick={setSeedId} />
        </div>
        <div className="stack">
          <div className="card">
            <CardHead title="แผนที่กลุ่มเพลง (PCA)" />
            <div className="legend">
              {clusters.map((c) => (
                <button key={c.cluster} className={"chip" + (hidden.has(c.cluster) ? " off" : "")} onClick={() => toggle(c.cluster)}>
                  <svg width="14" height="14" viewBox="-7 -7 14 14"><Shape c={c.cluster} r={5} fill={clusterColor(c.cluster, dark)} sw={0} /></svg>
                  {c.cluster} <span className="muted">n={c.n_songs}</span>
                </button>
              ))}
            </div>
            <PcaScatter songs={songs} clusters={clusters} hidden={hidden} dark={dark} selected={seed}
              recIds={recs.map((r) => r.id)} onPick={setSeedId} explained={meta.pca_explained_variance} />
          </div>
          <NowTopCard songs={songs} dayMax={dayMax} onPick={setSeedId} />
        </div>
      </section>

      <section className="card">
        <CardHead title="โปรไฟล์กลุ่ม (มัธยฐาน)" />
        <div className="clusters">
          {clusters.map((c) => <ClusterCard key={c.cluster} c={c} all={clusters} dark={dark}
            audio={model.audio_profiles?.find((a) => a.cluster === c.cluster)} />)}
        </div>
      </section>
    </>
  );
}

const COVERS = [1, 2, 3, 4, 5].map((n) => `covers/cover${n}.jpg`);

/** การ์ดเพลงแบบ Spotify ขนาดกะทัดรัด: วนแสดงอันดับ 1–5 ณ วันล่าสุด
 *  ปกซูมช้าๆ + แผ่นเสียงหมุน + EQ + แถบเวลาที่เลื่อนต่อเนื่อง (ครบแถบ = เปลี่ยนเพลง)
 *  ภาพปกเป็นภาพประกอบ ไม่ใช่ปกจริงของเพลงในข้อมูล */
function NowTopCard({ songs, dayMax, onPick }) {
  const top = useMemo(() => chartMoves(songs, dayMax, 7).sort((a, b) => a.now - b.now).slice(0, 5), [songs, dayMax]);
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [round, setRound] = useState(0);
  const k = top.length ? i % top.length : 0;
  // เปลี่ยนเพลงทุก 7 วินาที (ตรงกับความยาวแอนิเมชันแถบเวลา) และหยุดเมื่อชี้เมาส์ค้างไว้
  useEffect(() => {
    if (hover || top.length < 2) return undefined;
    const id = setTimeout(() => setI((x) => (x + 1) % top.length), 7000);
    return () => clearTimeout(id);
  }, [k, hover, round, top.length]);
  if (!top.length) return null;
  const s = top[k];
  return (
    <div className={"card nowtop" + (hover ? " paused" : "")}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setRound((r) => r + 1); }}>
      <div className="nt-bg" aria-hidden>
        {top.map((t, j) => <img key={t.id} src={COVERS[j % COVERS.length]} alt="" className={j === k ? "on" : ""} />)}
      </div>
      <div className="nt-art">
        <span className="nt-disc" aria-hidden />
        <div className="nt-cover">
          {top.map((t, j) => (
            <img key={t.id} src={COVERS[j % COVERS.length]} alt={j === k ? `ภาพประกอบเพลง ${t.t}` : ""}
              className={j === k ? "on" : ""} />
          ))}
        </div>
      </div>
      <div className="nt-body">
        <div className="nt-top">
          <span className="eyebrow">อันดับล่าสุด</span>
          <span className="nt-eq" aria-hidden><i /><i /><i /><i /></span>
        </div>
        <button className="nt-title" onClick={() => onPick(s.id)} title="ตั้งเป็นเพลงตั้งต้น">
          <span className="nt-rank mono">#{s.now}</span>
          <b>{s.t}</b>
        </button>
        <div className="nt-meta">
          <span className="small muted">{s.a}</span>
          <MoveBadge s={s} />
        </div>
        <div className="nt-progress"><span key={`${k}-${round}`} /></div>
        <div className="nt-dots">
          {top.map((t, j) => (
            <button key={t.id} className={j === k ? "on" : ""} onClick={() => setI(j)} aria-label={`อันดับ ${t.now}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** การ์ดแบบเครื่องเล่นเพลง: วนดู 5 เพลงที่ไต่แรงสุด 7 วัน พร้อมปกเคลื่อนไหว */
function TrendingPlayer({ songs, dayMax, onPick }) {
  const top = useMemo(() => chartMoves(songs, dayMax, 7).filter((m) => m.kind === "up")
    .sort((a, b) => b.change - a.change || a.now - b.now).slice(0, 5), [songs, dayMax]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || top.length < 2) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % top.length), 6000);
    return () => clearInterval(id);
  }, [playing, top.length]);
  if (!top.length) return null;
  const s = top[i % top.length];
  const step = (d) => setI((x) => (x + d + top.length) % top.length);
  return (
    <div className="card player">
      <Cover seed={s.id} playing={playing}>
        <span className="cover-tag">มาแรง 7 วัน · {i % top.length + 1}/{top.length}</span>
        <span className="move up cover-move">▲ {s.change}</span>
      </Cover>
      <button className="player-meta" onClick={() => onPick(s.id)} title="ตั้งเป็นเพลงตั้งต้น">
        <b>{s.t}</b>
        <span className="small muted">{s.a} · #{s.now}</span>
      </button>
      <div className="player-ctl">
        <button onClick={() => step(-1)} aria-label="เพลงก่อนหน้า">
          <svg viewBox="0 0 24 24"><path d="M6 5v14M18 5 9 12l9 7z" /></svg>
        </button>
        <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "หยุด" : "เล่น"}>
          {playing ? <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>
            : <svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" /></svg>}
        </button>
        <button onClick={() => step(1)} aria-label="เพลงถัดไป">
          <svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l9 7-9 7z" /></svg>
        </button>
      </div>
    </div>
  );
}

/* =================================================================== */
/*  เพลงไต่อันดับ (Chart Climbers)                                        */
/* =================================================================== */
function Climbers({ songs, clusters, dark, setSeedId, seedId, dateOf, dayMax, model }) {
  const [period, setPeriod] = useState(7);
  const [asOf, setAsOf] = useState(dayMax);
  const [mode, setMode] = useState("up");
  const minDay = Math.min(period, dayMax);
  const day = Math.max(minDay, Math.min(asOf, dayMax));
  const moves = useMemo(() => chartMoves(songs, day, period), [songs, day, period]);
  const ups = moves.filter((m) => m.kind === "up");
  const downs = moves.filter((m) => m.kind === "down");
  const news = moves.filter((m) => m.kind === "new");
  const list = mode === "up" ? [...ups].sort((a, b) => b.change - a.change || a.now - b.now)
    : mode === "down" ? [...downs].sort((a, b) => a.change - b.change || a.now - b.now)
      : [...news].sort((a, b) => a.now - b.now);
  const top = list.slice(0, 10);
  const pal = dark ? LINE_COLORS_DARK : LINE_COLORS;
  const series = top.slice(0, 5).map((s, i) => ({ id: s.id, t: s.t, color: pal[i], pts: s.hd.map((d, j) => [d, s.hr[j]]) }));
  const span = Math.max(period * 3, 21);
  const fromDay = Math.max(0, day - span);
  const best = ups.length ? ups.reduce((a, b) => (b.change > a.change ? b : a)) : null;
  const momentum = clusters.map((c) => {
    const ms = moves.filter((m) => m.c === c.cluster && m.change != null);
    return { cluster: c.cluster, name: c.cluster_name, n: ms.length,
      mean: ms.length ? ms.reduce((s, m) => s + m.change, 0) / ms.length : null };
  });

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="ช่วงเวลาที่เทียบ">
          {PERIODS.map((p) => (
            <button key={p} role="tab" aria-selected={period === p} className={period === p ? "on" : ""}
              onClick={() => setPeriod(p)}>{p === 1 ? "เทียบเมื่อวาน" : `${p} วันล่าสุด`}</button>
          ))}
        </div>
        <label className="asof">
          <span className="eyebrow">ณ วันที่</span>
          <input type="range" min={minDay} max={dayMax} value={day} onChange={(e) => setAsOf(+e.target.value)}
            aria-label="เลือกวันที่ที่ใช้ดูการไต่อันดับ" />
          <b className="mono">{dateOf(day)}</b>
          {day !== dayMax && <button className="link" onClick={() => setAsOf(dayMax)}>ล่าสุด</button>}
        </label>
      </div>

      <section className="kpis">
        <Kpi label="ติดชาร์ต" value={fmt.int(moves.length)} />
        <Kpi label="ไต่ขึ้น ▲" value={fmt.int(ups.length)} note={`ร่วงลง ▼ ${fmt.int(downs.length)}`} accent />
        <Kpi label="ไต่สูงสุด" value={best ? `+${best.change}` : "–"} note={best ? best.t : ""} />
        <Kpi label="เข้าใหม่" value={fmt.int(news.length)} />
      </section>

      <section className="grid-chart">
        <div className="card">
          <CardHead title="เส้นอันดับ Top 5" />
          {series.length ? <ClimberChart series={series} fromDay={fromDay} toDay={day} markDay={day - period} dateOf={dateOf} />
            : <p className="muted empty-note">ไม่มีข้อมูล</p>}
        </div>
        <div className="card">
          <CardHead title={`เฉลี่ยตามกลุ่ม (${model.name})`} />
          <MomentumBars rows={momentum} dark={dark} />
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head row">
            <div>
              <h2>{mode === "up" ? "Top Chart Climbers" : mode === "new" ? "เข้าชาร์ตใหม่" : "ร่วงลงมากที่สุด"}</h2>
            </div>
            <div className="seg sm" role="tablist" aria-label="ประเภทการเคลื่อนไหว">
              {MOVE_MODES.map((m) => (
                <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? "on" : ""}
                  onClick={() => setMode(m.key)}>{m.label}</button>
              ))}
            </div>
          </div>
          {top.length === 0 ? <p className="muted empty-note">ไม่มีเพลงในหมวดนี้สำหรับช่วงที่เลือก</p> : (
            <ol className="climb-list">
              {top.map((s, i) => (
                <li key={s.id}>
                  <button className={"climb" + (s.id === seedId ? " on" : "")} onClick={() => setSeedId(s.id)}>
                    <span className="climb-i mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="climb-sw">{i < 5 ? <i style={{ background: pal[i] }} /> : null}</span>
                    <span className="climb-body">
                      <span className="climb-t">{s.t}</span>
                      <span className="muted small">{s.a}</span>
                    </span>
                    <span className="climb-now mono">#{s.now}</span>
                    <MoveBadge s={s} />
                    <ClusterTag c={s.c} small dark={dark} bare />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}

function MoveBadge({ s }) {
  if (s.kind === "new") return <span className="move new">ใหม่</span>;
  if (s.kind === "re") return <span className="move re">กลับมา</span>;
  if (s.change === 0) return <span className="move same">— 0</span>;
  const up = s.change > 0;
  return (
    <span className={"move " + (up ? "up" : "down")} title={`จาก #${s.prev} เป็น #${s.now}`}>
      {up ? "▲" : "▼"} {Math.abs(s.change)}
    </span>
  );
}

/* =================================================================== */
/*  เปรียบเทียบโมเดล                                                    */
/* =================================================================== */
function Models({ data, models, model, setModelKey, dark, modelColors }) {
  const agreement = data.model_agreement || [];
  const bestOf = (metric) => {
    const vals = models.map((m) => m.metrics[metric]).filter((v) => v != null);
    if (!vals.length) return null;
    return METRIC_INFO[metric].better === "high" ? Math.max(...vals) : Math.min(...vals);
  };
  const meanConf = (m) => (m.confidence ? m.confidence.reduce((a, b) => a + b, 0) / m.confidence.length : null);
  const unsure = (m) => (m.confidence ? m.confidence.filter((c) => c < 0.6).length : null);
  const cur = (m) => (m.key === model.key ? " cur" : "");
  return (
    <>

      {models.length < 2 && (
        <div className="banner info">มีเพียง K-Means — รัน <span className="mono">python -m thai_chart_ml run</span> ใหม่</div>
      )}

      <section className="model-cards">
        {models.map((m) => {
          const info = MODEL_INFO[m.key] || {};
          const on = m.key === model.key;
          return (
            <article key={m.key} className={"mcard" + (on ? " on" : "")} style={{ "--mc": modelColors[m.key] }}>
              <div className="mcard-top">
                <ModelSchematic kind={m.key} />
                <div>
                  <span className="eyebrow">{info.family}</span>
                  <h3>{m.name}</h3>
                  <p className="small">{info.short}</p>
                </div>
              </div>
              <div className="mstats">
                <div><span className="eyebrow">k ที่เลือก</span><b className="mono">{m.best_k}</b></div>
                <div><span className="eyebrow">Silhouette</span><b className="mono">{fmt.num(m.metrics.silhouette, 3)}</b></div>
                <div><span className="eyebrow">การจัดสมาชิก</span><b>{m.confidence ? "Soft" : "Hard"}</b></div>
              </div>
              <h4 className="h5">ทำงานอย่างไร</h4>
              <ol className="steps">{info.how?.map((h, i) => <li key={i}>{h}</li>)}</ol>
              <div className="pc">
                <div><h4 className="h5">จุดเด่น</h4><ul className="plus">{info.pros?.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
                <div><h4 className="h5">ข้อจำกัด</h4><ul className="minus">{info.cons?.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
              </div>
              <button className={"use-btn" + (on ? " on" : "")} onClick={() => setModelKey(m.key)} aria-pressed={on}>
                {on ? "✓ กำลังใช้โมเดลนี้" : "ใช้โมเดลนี้"}
              </button>
            </article>
          );
        })}
      </section>

      <section className="card">
        <CardHead title="ตารางเปรียบเทียบ" />
        <div className="scroll">
          <table className="tbl cmp">
            <thead>
              <tr><th />{models.map((m) => (
                <th key={m.key} className={cur(m).trim()}>
                  <span className="dot" style={{ background: modelColors[m.key] }} />{m.name}
                </th>))}</tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r) => (
                <tr key={r.label}><td className="muted">{r.label}</td>
                  {models.map((m) => <td key={m.key} className={(r.mono ? "mono small" : "") + cur(m)}>{r.get(m.key)}</td>)}
                </tr>
              ))}
              <tr className="sep"><td colSpan={models.length + 1}>ผลลัพธ์</td></tr>
              <tr><td className="muted">k ที่เลือก</td>{models.map((m) => <td key={m.key} className={"mono" + cur(m)}>{m.best_k}</td>)}</tr>
              {Object.entries(METRIC_INFO).map(([key, mi]) => {
                const b = bestOf(key);
                return (
                  <tr key={key}>
                    <td className="muted" title={mi.desc}>{mi.label} {mi.better === "high" ? "↑" : "↓"}</td>
                    {models.map((m) => {
                      const val = m.metrics[key];
                      return (
                        <td key={m.key} className={"mono" + cur(m)}>
                          {val == null ? "–" : fmt.num(val, key === "calinski_harabasz" ? 1 : 3)}
                          {val != null && val === b && models.length > 1 && <span className="best-tag">ดีสุด</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr><td className="muted">ขนาดกลุ่ม</td>{models.map((m) => <td key={m.key} className={"mono small" + cur(m)}>{m.clusters.map((c) => c.n_songs).join(" · ")}</td>)}</tr>
              <tr><td className="muted">ความมั่นใจเฉลี่ย / ก้ำกึ่ง</td>{models.map((m) => (
                <td key={m.key} className={"mono small" + cur(m)}>
                  {m.confidence ? `${fmt.pct(100 * meanConf(m))} / ${unsure(m)}` : "–"}
                </td>))}</tr>
              <tr><td className="muted">เวลาฟิต</td>{models.map((m) => <td key={m.key} className={"mono small" + cur(m)}>{m.fit_seconds != null ? `${fmt.num(m.fit_seconds, 2)} s` : "–"}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <CardHead title="Silhouette ต่อ k" />
          <div className="line-legend">
            {models.map((m) => <span key={m.key}><i style={{ background: modelColors[m.key] }} />{m.name}</span>)}
          </div>
          <ModelKLines models={models} colors={modelColors} current={model.key} />
        </div>
        <div className="card">
          <CardHead title="ความสอดคล้อง (ARI)" />
          {agreement.length ? <AgreementMatrix models={models} agreement={agreement} /> : <p className="muted">ไม่มีข้อมูล</p>}
        </div>
      </section>

      <section className="card">
        <CardHead title="PCA แยกตามโมเดล" />
        <div className="multiples">
          {models.map((m) => (
            <figure key={m.key} className={m.key === model.key ? "on" : ""}>
              <MiniScatter songs={data.songs} labels={m.labels} dark={dark} label={`PCA สีตามกลุ่มของ ${m.name}`} />
              <figcaption><b>{m.name}</b> <span className="muted small">k = {m.best_k}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}

/* =================================================================== */
/*  ค้นหาเพลงคล้าย                                                       */
/* =================================================================== */
function Finder({ data, songs, clusters, dark, seed, seedId, setSeedId, model }) {
  const { evaluation } = data;
  const [sameCluster, setSameCluster] = useState(false);
  const recs = useMemo(() => recommend(songs, seedId, 5, sameCluster), [songs, seedId, sameCluster]);
  const sameClusterPct = useMemo(() => Object.fromEntries(evaluation.per_seed.map((r) => {
    const s = songs.find((x) => x.id === r.seed_track_id);
    const rr = s ? recommend(songs, s.id, 5) : [];
    return [r.seed_track_id, rr.length ? (100 * rr.filter((x) => x.c === s.c).length) / rr.length : null];
  })), [songs, evaluation]);
  const pal = dark ? LINE_COLORS_DARK : LINE_COLORS;
  return (
    <>
      <div className="finder-bar">
        <SongSearch songs={songs} onPick={setSeedId} />
        <label className="toggle">
          <input type="checkbox" checked={sameCluster} onChange={(e) => setSameCluster(e.target.checked)} />
          <span>กลุ่มเดียวกัน</span>
        </label>
      </div>

      <section className="finder-grid">
        <div className="card">
          {seed && (
            <div className="seed-row">
              <i className="seed-line" aria-hidden />
              <div className="seed-name">
                <b>{seed.t}</b>
                <span className="small muted">{seed.a}</span>
              </div>
              <ClusterTag c={seed.c} small dark={dark} bare />
              <div className="seed-stats mono small">
                <span>#{seed.br}</span><span>{seed.d} วัน</span>
              </div>
            </div>
          )}
          <ol className="rec-list">
            {recs.map((r, i) => (
              <li key={r.id}>
                <button onClick={() => setSeedId(r.id)} title="ตั้งเป็นเพลงตั้งต้น">
                  <span className="rec-i mono">{i + 1}</span>
                  <i className="rec-line" style={{ background: pal[i] }} aria-hidden />
                  <span className="rec-body">
                    <span className="rec-title">{r.t}</span>
                    <span className="muted small">{r.a}</span>
                  </span>
                  <span className="rec-sim">
                    <MiniBar value={Math.max(0, r.sim)} max={1} />
                    <span className="mono small">{(r.sim * 100).toFixed(1)}%</span>
                  </span>
                  <ClusterTag c={r.c} small dark={dark} bare />
                </button>
              </li>
            ))}
          </ol>
          {recs.length === 0 && <p className="muted empty-note">ไม่มีเพลงในกลุ่มเดียวกัน</p>}
        </div>
        <div className="card">
          <CardHead title="ประวัติอันดับ" />
          {seed && recs.length > 0 && <RankHistory seed={seed} recs={recs} dark={dark} height={400} />}
        </div>
      </section>

      <details className="card eval">
        <summary>
          <span>ประเมินเทียบการสุ่ม</span>
          <span className="mono small muted">
            {fmt.num(evaluation.summary.mean_rec_trajectory_mad)} vs {fmt.num(evaluation.summary.mean_random_trajectory_mad)} ·
            ดีกว่า {evaluation.summary.seeds_rec_better_than_random}/{evaluation.summary.n_seeds}
          </span>
        </summary>
        <div className="scroll">
          <table className="tbl">
            <thead><tr><th>เพลงตั้งต้น</th><th>แนะนำ</th><th>สุ่ม</th><th>กลุ่มเดียวกัน</th></tr></thead>
            <tbody>
              {evaluation.per_seed.map((r) => (
                <tr key={r.seed_track_id} className={r.seed_track_id === seedId ? "hl" : ""}
                  onClick={() => setSeedId(r.seed_track_id)} style={{ cursor: "pointer" }}>
                  <td>{r.seed_title}</td>
                  <td className="mono">{fmt.num(r.rec_trajectory_mad)}</td>
                  <td className="mono">{fmt.num(r.random_trajectory_mad)}</td>
                  <td className="mono">{fmt.pct(sameClusterPct[r.seed_track_id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/* =================================================================== */
/*  คุณภาพข้อมูล                                                       */
/* =================================================================== */
function DataQuality({ meta, dq, audio }) {
  const win = dq.date_window;
  return (
    <section className="card">
      <CardHead title="คุณภาพข้อมูล" />
      <dl className="dl">
        <dt>ข้อมูลที่มีในไฟล์</dt><dd>{win.data_available_from} → {win.data_available_to}</dd>
        <dt>ช่วงที่วิเคราะห์</dt><dd>{win.requested_start} → {win.requested_end}{win.default_12_month_window ? " (ค่าเริ่มต้น 12 เดือน)" : ""}</dd>
        <dt>วันที่มีข้อมูล / วันในปฏิทิน</dt><dd>{win.days_with_data} / {win.calendar_days_in_window}</dd>
        <dt>วันที่ข้อมูลขาด</dt><dd>{win.missing_days_count ? win.missing_days.slice(0, 12).join(", ") + (win.missing_days.length > 12 ? " …" : "") : "ไม่มี"}</dd>
        <dt>แถวในช่วงวัน</dt><dd className="mono">{fmt.int(dq.cleaning.rows_in_window)}</dd>
        <dt>ตัด: ไม่มี track_id</dt><dd className="mono">{fmt.int(dq.cleaning.dropped_no_track_id)}</dd>
        <dt>ตัด: อันดับไม่ถูกต้อง</dt><dd className="mono">{fmt.int(dq.cleaning.dropped_invalid_rank)}</dd>
        <dt>ตัด: ซ้ำทุกค่า</dt><dd className="mono">{fmt.int(dq.cleaning.dropped_exact_duplicates)}</dd>
        <dt>อันดับขัดแย้ง (เก็บอันดับดีกว่า)</dt><dd className="mono">{fmt.int(dq.cleaning.rank_conflict_groups)} กลุ่ม</dd>
        <dt>แถวหลังทำความสะอาด</dt><dd className="mono">{fmt.int(dq.cleaning.rows_after_cleaning)}</dd>
        <dt>ข้อมูลเสียง</dt><dd>{audio.available ? `${fmt.int(audio.unique_track_ids)} track_id ไม่ซ้ำในไฟล์ · จับคู่ ${fmt.int(audio.matched)} เพลง (${fmt.pct(audio.matched_pct)})` : "ไม่มีไฟล์ — ไม่เติมค่าแทน"}</dd>
      </dl>
      {meta.notices?.length > 0 && (
        <details className="banner info"><summary>ข้อความจากการรัน ({meta.notices.length})</summary>
          {meta.notices.map((n, i) => <pre key={i}>{n}</pre>)}
        </details>
      )}
    </section>
  );
}

/* =================================================================== */
/*  แถบด้านขวา                                                          */
/* =================================================================== */
function RailModel({ model, colors, onCompare }) {
  return (
    <section className="rail-card">
      <div className="rail-head">
        <span className="eyebrow">โมเดลที่ใช้อยู่</span>
        <button className="link" onClick={onCompare}>เปรียบเทียบ</button>
      </div>
      <div className="rail-model">
        <span className="dot lg" style={{ background: colors[model.key] }} />
        <div><b>{model.name}</b></div>
      </div>
      <div className="rail-stats">
        <div><span className="eyebrow">k</span><b className="mono">{model.best_k}</b></div>
        <div><span className="eyebrow">Silhouette</span><b className="mono">{fmt.num(model.metrics.silhouette, 3)}</b></div>
        <div><span className="eyebrow">สมาชิก</span><b>{model.confidence ? "Soft" : "Hard"}</b></div>
      </div>
    </section>
  );
}

function RailClimbers({ songs, dayMax, dateOf, onPick, onMore }) {
  const top = useMemo(() => chartMoves(songs, dayMax, 7).filter((m) => m.kind === "up")
    .sort((a, b) => b.change - a.change || a.now - b.now).slice(0, 5), [songs, dayMax]);
  return (
    <section className="rail-card">
      <div className="rail-head">
        <span className="eyebrow">ไต่แรงสุด 7 วัน</span>
        <button className="link" onClick={onMore}>ทั้งหมด</button>
      </div>
      {top.length === 0 ? <p className="small muted">ไม่มีเพลงที่ไต่ขึ้น</p> : (
        <ol className="rail-list">
          {top.map((s) => (
            <li key={s.id}>
              <button onClick={() => onPick(s.id)}>
                <span className="rail-t"><span className="rail-name">{s.t}</span><span className="small muted mono">#{s.now}</span></span>
                <span className="move up">▲ {s.change}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RailSeed({ seed, cluster, dark, onFind }) {
  return (
    <section className="rail-card seed-card" style={{ "--cc": clusterColor(seed.c, dark) }}>
      <Cover seed={seed.id} className="cover-sm">
        <span className="cover-tag">เพลงตั้งต้น</span>
      </Cover>
      <h3>{seed.t}</h3>
      <div className="small muted">{seed.a}</div>
      <Sparkline song={seed} />
      <ClusterTag c={seed.c} dark={dark} small />
      <button className="use-btn on" onClick={onFind}>เพลงที่คล้ายกัน →</button>
    </section>
  );
}

/* =================================================================== */
/*  ชิ้นส่วนเล็ก                                                         */
/* =================================================================== */
function Icon({ name }) {
  const p = {
    bars: <><path d="M5 19V11" /><path d="M10 19V5" /><path d="M15 19v-6" /><path d="M20 19V9" /></>,
    rise: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
    layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
    note: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
    db: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  }[name];
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden>{p}</svg>;
}

function Kpi({ label, value, note, accent }) {
  return (
    <div className={"kpi" + (accent ? " kpi-accent" : "")}>
      <span className="eyebrow">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="muted small kpi-note">{note}</span>
    </div>
  );
}

function CardHead({ title, sub }) {
  return <div className="card-head"><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>;
}

function ClusterTag({ c, name, small, dark, bare }) {
  return (
    <span className={"ctag" + (small ? " ctag-sm" : "") + (bare ? " ctag-bare" : "")} title={name ? `กลุ่ม ${c}: ${name}` : `กลุ่ม ${c}`}>
      <svg width="12" height="12" viewBox="-6 -6 12 12"><Shape c={c} r={4.5} fill={clusterColor(c, dark)} sw={0} /></svg>
      {bare ? c : <>กลุ่ม {c}{name ? `: ${name}` : ""}</>}
    </span>
  );
}

const CARD_FEATS = [
  { f: "best_rank", label: "อันดับดีสุด", fmt: (v) => `#${fmt.num(v, 0)}` },
  { f: "median_rank", label: "อันดับกลาง", fmt: (v) => `#${fmt.num(v, 0)}` },
  { f: "days_on_chart", label: "วันบนชาร์ต", fmt: (v) => fmt.num(v, 0) },
  { f: "days_to_peak", label: "วันถึงพีค", fmt: (v) => fmt.num(v, 0) },
];

function ClusterCard({ c, all, audio, dark }) {
  const maxOf = (f) => Math.max(...all.map((k) => k[`median_${f}`]));
  const tags = c.cluster_name.replace(/\s*\(กลุ่ม \d+\)$/, "").split(" · ");
  return (
    <div className="ccard" style={{ "--cc": clusterColor(c.cluster, dark) }}>
      <div className="ccard-head">
        <svg width="18" height="18" viewBox="-9 -9 18 18"><Shape c={c.cluster} r={7} fill={clusterColor(c.cluster, dark)} sw={0} /></svg>
        <b>กลุ่ม {c.cluster}</b>
        <span className="ccard-count"><b className="mono">{fmt.int(c.n_songs)}</b> เพลง · {fmt.pct(c.share_pct)}</span>
      </div>
      <div className="ccard-tags">{tags.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="ccard-stats">
        {CARD_FEATS.map(({ f, label, fmt: show }) => (
          <div key={f}>
            <span className="ccard-label">{label}</span>
            <b className="mono">{show(c[`median_${f}`])}</b>
            <MiniBar value={c[`median_${f}`]} max={maxOf(f)} color="var(--cc)" />
          </div>
        ))}
      </div>
      {audio && audio.n_audio_matched > 0 && (
        <div className="ccard-audio">
          <span>dance <b className="mono">{fmt.num(audio.mean_danceability, 2)}</b></span>
          <span>energy <b className="mono">{fmt.num(audio.mean_energy, 2)}</b></span>
          <span>valence <b className="mono">{fmt.num(audio.mean_valence, 2)}</b></span>
          <span className="muted">n={audio.n_audio_matched}</span>
        </div>
      )}
    </div>
  );
}

function Stats({ s }) {
  return (
    <div className="stats">
      <div><span className="eyebrow">อันดับดีสุด</span><b className="mono">#{s.br}</b></div>
      <div><span className="eyebrow">อันดับมัธยฐาน</span><b className="mono">#{fmt.num(s.mr)}</b></div>
      <div><span className="eyebrow">วันที่ติดชาร์ต</span><b className="mono">{s.d}</b></div>
      <div><span className="eyebrow">วันถึงจุดสูงสุด</span><b className="mono">{s.dp}</b></div>
    </div>
  );
}

function SongSearch({ songs, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => titleCounts(songs), [songs]);
  const hits = useMemo(() => searchSongs(songs, q), [songs, q]);
  return (
    <div className="search">
      <input value={q} placeholder="พิมพ์ชื่อเพลงหรือศิลปิน…" aria-label="ค้นหาเพลง"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && q && (
        <ul className="dropdown">
          {hits.length === 0 && <li className="muted">ไม่พบเพลงที่ตรงกับ “{q}”</li>}
          {hits.map((s) => (
            <li key={s.id}>
              <button onMouseDown={() => { onPick(s.id); setQ(s.t); setOpen(false); }}>
                <span>{s.t} <span className="muted">— {s.a}</span></span>
                <span className="small muted">
                  {counts.get(s.t.toLowerCase()) > 1 && <span className="dup">ชื่อซ้ำ</span>}
                  <span className="mono">{s.id}</span> · ดีสุด #{s.br} · {s.d} วัน
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
