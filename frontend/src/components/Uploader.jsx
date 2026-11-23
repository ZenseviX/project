import { useEffect, useRef, useState } from "react";

const KINDS = {
  charts: { label: "ชาร์ตรายวัน", file: "charts.csv" },
  songs: { label: "ข้อมูลเสียง", file: "spotify_songs.csv" },
};

function fmtSize(n) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** ดูหัวตาราง CSV (64 KB แรก) เพื่อเดาว่าเป็นไฟล์ชาร์ตหรือไฟล์ข้อมูลเสียง */
async function sniffKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return name.includes("song") ? "songs" : "charts";
  const head = await file.slice(0, 65536).text();
  const cols = head.split(/\r?\n/)[0].toLowerCase().split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  if (cols.includes("danceability") && cols.includes("track_id")) return "songs";
  if (cols.includes("rank") && cols.includes("region")) return "charts";
  return null;
}

function upload(kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `api/upload?kind=${kind}`);
    xhr.setRequestHeader("X-Thai-Chart", "1");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      xhr.status === 200 ? resolve(body) : reject(new Error(body.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"));
    xhr.send(file);
  });
}

export default function Uploader({ source, onReload, onOpenLocal }) {
  const [api, setApi] = useState(null); // null = กำลังตรวจ, false = ไม่มี API
  const [items, setItems] = useState([]); // {id, name, size, kind, progress, state, msg}
  const [drag, setDrag] = useState(false);
  const [run, setRun] = useState(null);
  const input = useRef(null);
  const poll = useRef(0);

  const refresh = () => fetch("api/status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((s) => { setApi(s); setRun(s.run); return s; })
    .catch(() => { setApi(false); return null; });

  useEffect(() => { refresh(); return () => clearTimeout(poll.current); }, []); // eslint-disable-line

  const patch = (id, p) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function handle(files) {
    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}`;
      const lower = file.name.toLowerCase();
      setItems((xs) => [{ id, name: file.name, size: file.size, progress: 0, state: "check" }, ...xs].slice(0, 6));
      if (lower.endsWith(".json")) {
        try {
          const obj = JSON.parse(await file.text());
          if (!obj?.songs || !obj?.meta) throw new Error("ไม่ใช่ไฟล์ dashboard.json");
          patch(id, { state: "ok", kind: "result", msg: `เปิดแล้ว · ${obj.songs.length} เพลง` });
          onOpenLocal(obj);
        } catch (e) {
          patch(id, { state: "err", msg: e.message });
        }
        continue;
      }
      if (!/\.(csv|zip)$/.test(lower)) { patch(id, { state: "err", msg: "รองรับ .csv .zip .json" }); continue; }
      if (!api) { patch(id, { state: "err", msg: "ต้องเปิดผ่าน python -m thai_chart_ml serve" }); continue; }
      const kind = await sniffKind(file);
      if (!kind) { patch(id, { state: "err", msg: "ไม่รู้จักคอลัมน์ในไฟล์นี้" }); continue; }
      const existing = api.files?.[kind];
      if (existing?.exists && !window.confirm(`แทนที่ ${existing.name} เดิม (${fmtSize(existing.size)})?`)) {
        patch(id, { state: "err", kind, msg: "ยกเลิก" });
        continue;
      }
      patch(id, { kind, state: "up" });
      try {
        const res = await upload(kind, file, (p) => patch(id, { progress: p }));
        patch(id, { state: "ok", progress: 1, msg: `${res.name}${res.from_zip ? " (แตกจาก zip)" : ""}` });
      } catch (e) {
        patch(id, { state: "err", msg: e.message });
      }
      await refresh();
    }
  }

  async function startRun() {
    const r = await fetch("api/run", { method: "POST", headers: { "X-Thai-Chart": "1" } });
    const body = await r.json().catch(() => ({}));
    setRun(body.run);
    const tick = async () => {
      const s = await refresh();
      if (s?.run?.state === "running") poll.current = setTimeout(tick, 1200);
      else if (s?.run?.state === "done") onReload(s.run.source);
    };
    tick();
  }

  const running = run?.state === "running";
  const hasCharts = api?.files?.charts?.exists;

  return (
    <section className="card upload">
      <div className="card-head row">
        <h2>นำเข้าข้อมูล</h2>
        {api && (
          <button className="use-btn on run-btn" disabled={running} onClick={startRun}>
            {running ? "กำลังวิเคราะห์…" : "วิเคราะห์ใหม่"}
          </button>
        )}
      </div>

      <div className="upload-grid">
        <button className={"drop" + (drag ? " over" : "")} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handle([...e.dataTransfer.files]); }}>
          <svg viewBox="0 0 24 24" className="drop-icon" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <b>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</b>
          <span className="small muted">.csv · .zip (Kaggle) · dashboard.json</span>
          <input ref={input} type="file" hidden multiple accept=".csv,.zip,.json"
            onChange={(e) => { handle([...e.target.files]); e.target.value = ""; }} />
        </button>

        <div className="slots">
          {Object.entries(KINDS).map(([k, info]) => {
            const f = api?.files?.[k];
            return (
              <div key={k} className={"slot" + (f?.exists ? " ok" : "")}>
                <span className="slot-dot" aria-hidden />
                <div>
                  <b>{info.label}</b>
                  <div className="small muted mono">{info.file}</div>
                </div>
                <span className="small mono">{api === false ? "–" : f?.exists ? fmtSize(f.size) : "ยังไม่มี"}</span>
              </div>
            );
          })}
          <div className="slot">
            <span className={"slot-dot src-" + source} aria-hidden />
            <div><b>กำลังแสดง</b><div className="small muted">{{ real: "ข้อมูลจริง", synthetic: "ข้อมูลจำลอง", local: "ไฟล์ที่เปิดเอง" }[source]}</div></div>
          </div>
        </div>
      </div>

      {api === false && <p className="small muted">อัปโหลด .csv ได้เมื่อเปิดผ่าน <span className="mono">python -m thai_chart_ml serve</span> · เปิด dashboard.json ได้เสมอ</p>}
      {api && !hasCharts && !running && <p className="small muted">ยังไม่มี charts.csv — วิเคราะห์ใหม่จะใช้ข้อมูลจำลอง</p>}

      {items.length > 0 && (
        <ul className="up-list">
          {items.map((it) => (
            <li key={it.id} className={"up " + it.state}>
              <span className="up-name">{it.name}</span>
              <span className="small muted mono">{fmtSize(it.size)}</span>
              <span className="up-bar"><span style={{ width: `${Math.round((it.state === "ok" ? 1 : it.progress) * 100)}%` }} /></span>
              <span className="small up-msg">
                {it.state === "up" ? `${Math.round(it.progress * 100)}%` : it.state === "check" ? "ตรวจไฟล์…" : it.msg}
              </span>
            </li>
          ))}
        </ul>
      )}

      {run && run.state !== "idle" && (
        <div className={"run-box " + run.state}>
          <div className="small"><b>{{ running: "กำลังวิเคราะห์", done: "เสร็จแล้ว", error: "ผิดพลาด" }[run.state]}</b>
            {run.error ? ` — ${run.error}` : ""}</div>
          <pre>{(run.log || []).slice(-8).join("\n")}</pre>
        </div>
      )}
    </section>
  );
}
