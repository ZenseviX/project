"""คำสั่งหลัก: python -m thai_chart_ml <command> --help"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import webbrowser
from pathlib import Path

import pandas as pd

from .config import OUTPUT_DIR, PROJECT_ROOT, RAW_DIR, PipelineConfig

DESCRIPTION = """Thailand Spotify Chart Analysis Using Machine Learning
การวิเคราะห์และจัดกลุ่มรูปแบบความนิยมของเพลงบนชาร์ต Spotify ประเทศไทยด้วย Machine Learning

คำสั่งย่อย:
  run      รันทั้งหมดตั้งแต่ CSV ถึงผลลัพธ์ (กรอง -> คุณลักษณะ -> K-Means -> แนะนำ -> ประเมิน -> ส่งออก)
  inspect  ตรวจชื่อคอลัมน์ รูปแบบวันที่ ค่าประเทศ และประเภทชาร์ตในไฟล์ charts.csv
  search   ค้นชื่อเพลงและแสดง 5 เพลงที่มีรูปแบบการติดชาร์ตใกล้เคียง (ต้อง run ก่อน)
  serve    เปิดหน้าเว็บ React แสดงผล (ต้อง run และ build หน้าเว็บก่อน)
"""


def _configure_stdout() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass


def cmd_run(a) -> int:
    from .data import DataError
    from .model import ModelError
    from .pipeline import run_pipeline
    cfg = PipelineConfig(
        charts_path=Path(a.charts), songs_path=Path(a.songs), start_date=a.start, end_date=a.end,
        k_min=a.k_min, k_max=a.k_max, n_eval_seeds=a.seeds, chunksize=a.chunksize, region=a.region,
        chart=a.chart, force_synthetic=a.synthetic, refresh_cache=a.refresh_cache,
        output_dir=Path(a.output) if a.output else None, make_plots=not a.no_plots)
    try:
        r = run_pipeline(cfg)
    except (DataError, ModelError) as exc:
        print(f"\n[ข้อผิดพลาด] {exc}", file=sys.stderr)
        return 2
    s = r["summary"]
    print("\n=========== สรุป ===========")
    if s["warning"]:
        print("!!! " + s["warning"])
    print(json.dumps({k: s[k] for k in ["data_source", "date_window", "n_songs", "audio_matched",
                                         "audio_matched_pct", "best_k", "best_silhouette"]},
                     ensure_ascii=False, indent=2))
    print(r["k_scores"][["k", "silhouette", "cluster_sizes", "status"]].to_string(index=False))
    print(r["profiles"][["cluster", "cluster_name", "n_songs", "median_best_rank", "median_median_rank",
                         "median_days_on_chart", "median_days_to_peak"]].to_string(index=False))
    return 0


def cmd_inspect(a) -> int:
    from .data import DataError, filter_region_chart, inspect_charts, select_date_window
    try:
        info = inspect_charts(Path(a.charts), nrows=a.nrows)
        print(json.dumps(info, ensure_ascii=False, indent=2, default=str))
        if a.filter and "error" not in info:
            df = filter_region_chart(Path(a.charts), a.region, a.chart, a.chunksize, refresh=a.refresh_cache)
            _, d = select_date_window(df, a.start, a.end)
            d = {**d, "missing_days": d["missing_days"][:30]}
            print(f"\nกรองได้ {len(df):,} แถว ({a.region}/{a.chart})")
            print(json.dumps(d, ensure_ascii=False, indent=2))
    except DataError as exc:
        print(f"[ข้อผิดพลาด] {exc}", file=sys.stderr)
        return 2
    return 0


def cmd_search(a) -> int:
    from .recommend import SearchError, recommend, resolve_song
    path = OUTPUT_DIR / a.source / "song_clusters.csv"
    if not path.exists():
        print(f"[ข้อผิดพลาด] ไม่พบ {path} — รัน `python -m thai_chart_ml run` ก่อน", file=sys.stderr)
        return 2
    songs = pd.read_csv(path)
    if a.source == "synthetic":
        print("!!! ผลจากข้อมูลจำลอง ไม่ใช่ชาร์ตไทยจริง")
    try:
        song = resolve_song(songs, a.query, a.track_id)
    except SearchError as exc:
        print(str(exc))
        return 1
    print(f"เพลงตั้งต้น: {song.title} — {song.artist} [{song.track_id}]")
    print(f"  กลุ่ม {song.cluster}: {song.cluster_name} | อันดับดีสุด {song.best_rank} | "
          f"มัธยฐาน {song.median_rank} | ติดชาร์ต {song.days_on_chart} วัน | ถึงจุดสูงสุด {song.days_to_peak} วัน")
    rec = recommend(songs, song.track_id, a.top)
    print(f"\n{a.top} เพลงที่มีรูปแบบการติดชาร์ตใกล้เคียง (Cosine Similarity):")
    print(rec.to_string(index=False))
    return 0


class _ExclusiveServer(http.server.ThreadingHTTPServer):
    """ไม่ยอมใช้พอร์ตร่วมกับโปรแกรมอื่น (บน Windows SO_REUSEADDR ทำให้สองเซิร์ฟเวอร์จองพอร์ตเดียวกันได้)"""
    allow_reuse_address = False

    def server_bind(self):
        import socket
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def cmd_serve(a) -> int:
    dist = PROJECT_ROOT / "frontend" / "dist"
    if not (dist / "index.html").exists():
        print(f"[ข้อผิดพลาด] ไม่พบ {dist / 'index.html'} — build หน้าเว็บก่อน (ดู README)", file=sys.stderr)
        return 2
    (dist / "data").mkdir(exist_ok=True)
    found = []
    for src in ("real", "synthetic"):
        f = OUTPUT_DIR / src / "dashboard.json"
        if f.exists():
            (dist / "data" / f"{src}.json").write_bytes(f.read_bytes())
            found.append(src)
    if not found:
        print("[ข้อผิดพลาด] ยังไม่มี outputs/*/dashboard.json — รัน `python -m thai_chart_ml run` ก่อน", file=sys.stderr)
        return 2
    from .server import Handler  # หน้าเว็บ + API อัปโหลดไฟล์ (/api/upload, /api/run)
    Handler.port = a.port
    handler = functools.partial(Handler, directory=str(dist))
    try:
        httpd = _ExclusiveServer(("0.0.0.0", a.port), handler)
    except OSError:
        print(f"[ข้อผิดพลาด] พอร์ต {a.port} มีโปรแกรมอื่นใช้อยู่ — ลองใหม่ด้วย --port 8010 (หรือพอร์ตอื่นที่ว่าง)",
              file=sys.stderr)
        return 2
    public_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    url = f"https://{public_host}/" if public_host else f"http://127.0.0.1:{a.port}/"
    print(f"เปิดหน้าเว็บที่ {url} (ข้อมูล: {', '.join(found)}) — กด Ctrl+C เพื่อหยุด", flush=True)
    if not a.no_browser:
        webbrowser.open(url)
    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m thai_chart_ml", description=DESCRIPTION,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    def data_args(sp):
        sp.add_argument("--charts", default=str(RAW_DIR / "charts.csv"), help="ไฟล์ charts.csv (ค่าเริ่มต้น data/raw/charts.csv)")
        sp.add_argument("--start", help="วันเริ่ม YYYY-MM-DD (ไม่ระบุ = ย้อนหลัง 12 เดือนจากวันล่าสุด)")
        sp.add_argument("--end", help="วันสิ้นสุด YYYY-MM-DD (ไม่ระบุ = วันล่าสุดในชาร์ตไทย)")
        sp.add_argument("--region", default="Thailand", help="ค่าประเทศในคอลัมน์ region (ค่าเริ่มต้น Thailand)")
        sp.add_argument("--chart", default="top200", help="ประเภทชาร์ต (ค่าเริ่มต้น top200)")
        sp.add_argument("--chunksize", type=int, default=500_000, help="จำนวนแถวต่อการอ่านหนึ่งครั้ง")
        sp.add_argument("--refresh-cache", action="store_true", help="กรองไฟล์ใหม่ ไม่ใช้ไฟล์ที่กรองไว้แล้ว")

    r = sub.add_parser("run", help="รันทั้งหมดตั้งแต่ CSV ถึงผลลัพธ์")
    data_args(r)
    r.add_argument("--songs", default=str(RAW_DIR / "spotify_songs.csv"), help="ไฟล์ spotify_songs.csv")
    r.add_argument("--k-min", type=int, default=2)
    r.add_argument("--k-max", type=int, default=8)
    r.add_argument("--seeds", type=int, default=10, help="จำนวนเพลงตั้งต้นสำหรับประเมิน (ค่าเริ่มต้น 10)")
    r.add_argument("--synthetic", action="store_true", help="บังคับใช้ข้อมูลจำลองเพื่อทดสอบโค้ด")
    r.add_argument("--output", help="โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น outputs/real หรือ outputs/synthetic)")
    r.add_argument("--no-plots", action="store_true", help="ไม่สร้างกราฟ PNG")
    r.set_defaults(func=cmd_run)

    i = sub.add_parser("inspect", help="ตรวจโครงสร้าง charts.csv")
    data_args(i)
    i.add_argument("--nrows", type=int, default=5000, help="จำนวนแถวแรกที่ใช้ตรวจ")
    i.add_argument("--filter", action="store_true", help="ทดลองกรองทั้งไฟล์และรายงานช่วงวัน")
    i.set_defaults(func=cmd_inspect)

    s = sub.add_parser("search", help="ค้นเพลงและแนะนำเพลงที่คล้าย")
    s.add_argument("query", nargs="?", help="ชื่อเพลง (บางส่วนก็ได้)")
    s.add_argument("--track-id", help="เลือกเพลงด้วย Spotify Track ID (ใช้เมื่อชื่อซ้ำ)")
    s.add_argument("--source", choices=["real", "synthetic"], default="real")
    s.add_argument("--top", type=int, default=5)
    s.set_defaults(func=cmd_search)

    v = sub.add_parser("serve", help="เปิดหน้าเว็บ React")
    v.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    v.add_argument("--no-browser", action="store_true")
    v.set_defaults(func=cmd_serve)
    return p


def main(argv=None) -> int:
    _configure_stdout()
    args = build_parser().parse_args(argv)
    return args.func(args)
