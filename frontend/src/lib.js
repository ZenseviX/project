// ฟังก์ชันคำนวณฝั่งหน้าเว็บ — ใช้สูตรเดียวกับ thai_chart_ml/recommend.py

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];
export const SHAPES = ["circle", "square", "triangle", "diamond", "triangleDown", "plus", "cross", "star"];

export const FEATURE_TH = {
  best_rank: "อันดับดีที่สุด",
  median_rank: "อันดับมัธยฐาน",
  days_on_chart: "วันที่ติดชาร์ต",
  days_to_peak: "วันถึงจุดสูงสุด",
};

export function clusterColor(c, dark) {
  const p = dark ? SERIES_DARK : SERIES;
  return p[c % p.length];
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Top-N ด้วย Cosine Similarity บนคุณลักษณะชาร์ตที่ปรับสเกลแล้ว ตัดเพลงตั้งต้นออก
 *  ปัดเป็นทศนิยม 4 ตำแหน่ง และเรียงเสมอด้วย track_id เหมือนฝั่ง Python */
export function recommend(songs, seedId, topN = 5, sameCluster = false) {
  const seed = songs.find((s) => s.id === seedId);
  if (!seed) return [];
  return songs
    .filter((s) => s.id !== seedId && (!sameCluster || s.c === seed.c))
    .map((s) => ({ ...s, sim: Math.round(cosine(seed.z, s.z) * 1e4) / 1e4 }))
    .sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, topN);
}

export function searchSongs(songs, query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = songs.filter((s) => s.t.toLowerCase() === q);
  const partial = songs.filter((s) => s.t.toLowerCase() !== q &&
    (s.t.toLowerCase().includes(q) || s.a.toLowerCase().includes(q)));
  return [...exact, ...partial.sort((a, b) => a.br - b.br)].slice(0, limit);
}

export function titleCounts(songs) {
  const m = new Map();
  songs.forEach((s) => m.set(s.t.toLowerCase(), (m.get(s.t.toLowerCase()) || 0) + 1));
  return m;
}

export const fmt = {
  int: (v) => (v == null ? "–" : Math.round(v).toLocaleString("th-TH")),
  num: (v, d = 1) => (v == null ? "–" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: d })),
  pct: (v) => (v == null ? "–" : `${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`),
};

/** แปลงพิกัดเมาส์เป็นพิกัด viewBox ของ SVG */
export function svgPoint(evt, svg, vbW, vbH) {
  const r = svg.getBoundingClientRect();
  return { x: ((evt.clientX - r.left) / r.width) * vbW, y: ((evt.clientY - r.top) / r.height) * vbH, rect: r };
}

export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/* ---------------- โมเดลจัดกลุ่ม ---------------- */

/** รายชื่อโมเดลจาก dashboard.json — ไฟล์รุ่นเก่าที่ไม่มี models จะได้ K-Means ตัวเดียว */
export function getModels(data) {
  if (data.models?.length) return data.models;
  return [{
    key: "kmeans", name: "K-Means", best_k: data.best_k, k_scores: data.k_scores,
    metrics: { silhouette: data.meta.best_silhouette, davies_bouldin: null, calinski_harabasz: null },
    labels: data.songs.map((s) => s.c), confidence: null, clusters: data.clusters,
    audio_profiles: data.audio_profiles, fit_seconds: null,
  }];
}

/** แทนกลุ่มของเพลงด้วยป้ายของโมเดลที่เลือก (labels เรียงตามลำดับ songs) */
export function applyModel(songs, model) {
  return songs.map((s, i) => ({
    ...s, c: model.labels[i], conf: model.confidence ? model.confidence[i] : null,
  }));
}

/* ---------------- เพลงไต่อันดับ (Chart Climbers) ---------------- */

/** อันดับของเพลงในวันที่ day (นับจาก window_start) หรือ null ถ้าไม่ติดชาร์ตวันนั้น */
export function rankOn(song, day) {
  const hd = song.hd;
  let lo = 0, hi = hd.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hd[mid] === day) return song.hr[mid];
    if (hd[mid] < day) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

export function lastDay(songs) {
  let m = 0;
  for (const s of songs) m = Math.max(m, s.hd[s.hd.length - 1]);
  return m;
}

/** เทียบอันดับวันที่ asOf กับ asOf - period
 *  kind: "up" ไต่ขึ้น, "down" ร่วงลง, "same" คงที่, "new" เข้าชาร์ตครั้งแรกในช่วงนี้, "re" กลับเข้าชาร์ต
 *  change > 0 หมายถึงอันดับดีขึ้น (ตัวเลขอันดับลดลง) */
export function chartMoves(songs, asOf, period) {
  const from = asOf - period;
  const out = [];
  for (const s of songs) {
    const now = rankOn(s, asOf);
    if (now == null) continue;
    const prev = rankOn(s, from);
    let kind, change = null;
    if (prev != null) {
      change = prev - now;
      kind = change > 0 ? "up" : change < 0 ? "down" : "same";
    } else {
      kind = s.hd[0] > from ? "new" : "re";
    }
    out.push({ ...s, now, prev, change, kind });
  }
  return out;
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}
