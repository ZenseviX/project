"""เซิร์ฟเวอร์หน้าเว็บ + API อัปโหลดไฟล์ข้อมูลและสั่งรันวิเคราะห์ (ใช้กับ python -m thai_chart_ml serve)

GET  /api/status            ไฟล์ใน data/raw และสถานะการรันล่าสุด
POST /api/upload?kind=...   kind = charts | songs ; body = ไฟล์ .csv หรือ .zip (เช่น archive.zip จาก Kaggle)
POST /api/run               รัน run_pipeline() ในเธรดเบื้องหลัง

ป้องกันเว็บอื่นยิงคำสั่งมาที่เครื่อง: ตรวจ Host ต้องเป็น 127.0.0.1/localhost
และคำขอ POST ต้องมีส่วนหัว X-Thai-Chart (เบราว์เซอร์จะไม่ส่งข้ามโดเมนโดยไม่ผ่าน CORS preflight ซึ่งเราไม่อนุญาต)
"""
from __future__ import annotations

import http.server
import json
import shutil
import threading
import time
import traceback
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import data as D
from .config import AUDIO_FEATURES, RAW_DIR, PipelineConfig

UPLOAD_TARGETS = {"charts": "charts.csv", "songs": "spotify_songs.csv"}
CHUNK = 1 << 20


class UploadError(ValueError):
    pass


class RunState:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = "idle"  # idle | running | done | error
        self.log: list[str] = []
        self.error: str | None = None
        self.source: str | None = None
        self.started: float | None = None
        self.finished: float | None = None

    def snapshot(self) -> dict:
        with self.lock:
            return {"state": self.state, "log": self.log[-40:], "error": self.error, "source": self.source,
                    "started": self.started, "finished": self.finished}


RUN = RunState()


def file_status(raw_dir: Path = RAW_DIR) -> dict:
    out = {}
    for kind, name in UPLOAD_TARGETS.items():
        f = raw_dir / name
        out[kind] = ({"name": name, "exists": True, "size": f.stat().st_size, "modified": f.stat().st_mtime}
                     if f.exists() else {"name": name, "exists": False})
    return out


def validate_header(kind: str, path: Path) -> list[str]:
    """อ่านเฉพาะบรรทัดหัวตาราง ตรวจว่ามีคอลัมน์ที่ต้องใช้ คืนรายชื่อคอลัมน์"""
    with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
        first = fh.readline()
    cols = [c.strip().strip('"') for c in first.rstrip("\r\n").split(",")]
    if kind == "charts":
        try:
            D.resolve_columns(cols)
        except D.DataError as e:
            raise UploadError(str(e)) from None
    else:
        lower = {c.lower() for c in cols}
        missing = [c for c in ["track_id", *AUDIO_FEATURES] if c not in lower]
        if missing:
            raise UploadError(f"ไฟล์ข้อมูลเสียงไม่มีคอลัมน์ {missing}")
    return cols


def _extract_csv_from_zip(zpath: Path, kind: str, dest: Path) -> None:
    want = UPLOAD_TARGETS[kind]
    with zipfile.ZipFile(zpath) as zf:
        csvs = [i for i in zf.infolist() if i.filename.lower().endswith(".csv") and not i.is_dir()]
        pick = [i for i in csvs if Path(i.filename).name.lower() == want] or (csvs if len(csvs) == 1 else [])
        if not pick:
            raise UploadError(f"ไม่พบ {want} ในไฟล์ zip (พบ: {[i.filename for i in csvs][:10]})")
        with zf.open(pick[0]) as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out, CHUNK)


def save_upload(kind: str, stream, length: int, raw_dir: Path = RAW_DIR) -> dict:
    """เขียนลงไฟล์ชั่วคราวก่อน ตรวจหัวตาราง แล้วจึงแทนที่ไฟล์เดิม (ไฟล์เดิมไม่เสียถ้าไฟล์ใหม่ใช้ไม่ได้)"""
    if kind not in UPLOAD_TARGETS:
        raise UploadError(f"kind ต้องเป็น {list(UPLOAD_TARGETS)}")
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / UPLOAD_TARGETS[kind]
    part = raw_dir / (target.name + ".upload")
    csv_tmp = raw_dir / (target.name + ".extract")
    try:
        left = length
        with open(part, "wb") as out:
            while left > 0:
                buf = stream.read(min(CHUNK, left))
                if not buf:
                    raise UploadError("การอัปโหลดถูกตัดกลางคัน")
                out.write(buf)
                left -= len(buf)
        with open(part, "rb") as fh:
            is_zip = fh.read(4) == b"PK\x03\x04"
        if is_zip:
            _extract_csv_from_zip(part, kind, csv_tmp)
            part.unlink()
            src = csv_tmp
        else:
            src = part
        cols = validate_header(kind, src)
        src.replace(target)
        return {"ok": True, "kind": kind, "name": target.name, "size": target.stat().st_size,
                "from_zip": is_zip, "columns": cols}
    finally:
        for f in (part, csv_tmp):
            if f.exists():
                f.unlink()


def start_run(dist_data: Path | None = None) -> bool:
    with RUN.lock:
        if RUN.state == "running":
            return False
        RUN.state, RUN.log, RUN.error, RUN.source = "running", [], None, None
        RUN.started, RUN.finished = time.time(), None

    def log(msg):
        with RUN.lock:
            RUN.log.extend(str(msg).splitlines())

    def work():
        from .pipeline import run_pipeline
        try:
            res = run_pipeline(PipelineConfig(), log=log)
            src = res["summary"]["data_source"]
            if dist_data is not None:
                dist_data.mkdir(exist_ok=True)
                shutil.copyfile(res["out_dir"] / "dashboard.json", dist_data / f"{src}.json")
            with RUN.lock:
                RUN.state, RUN.source = "done", src
        except Exception as e:  # noqa: BLE001 — ส่งข้อความผิดพลาดกลับไปแสดงบนหน้าเว็บ
            log(traceback.format_exc(limit=3))
            with RUN.lock:
                RUN.state, RUN.error = "error", str(e)
        finally:
            with RUN.lock:
                RUN.finished = time.time()

    threading.Thread(target=work, daemon=True).start()
    return True


class Handler(http.server.SimpleHTTPRequestHandler):
    port = 8000

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        return host in {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/status":
            if not self._host_ok():
                return self._json(403, {"error": "forbidden host"})
            return self._json(200, {"api": 1, "files": file_status(), "run": RUN.snapshot()})
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if not self._host_ok() or self.headers.get("X-Thai-Chart") != "1":
            return self._json(403, {"error": "forbidden"})
        if url.path == "/api/upload":
            if RUN.state == "running":
                return self._json(409, {"error": "กำลังรันวิเคราะห์อยู่ รอให้เสร็จก่อน"})
            kind = parse_qs(url.query).get("kind", [""])[0]
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                return self._json(411, {"error": "ต้องระบุ Content-Length"})
            try:
                return self._json(200, save_upload(kind, self.rfile, length))
            except (UploadError, zipfile.BadZipFile) as e:
                return self._json(400, {"error": str(e)})
        if url.path == "/api/run":
            ok = start_run(Path(self.directory) / "data")
            return self._json(202 if ok else 409, {"started": ok, "run": RUN.snapshot()})
        return self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):  # ไม่พิมพ์ทุกคำขอ /api/status ที่หน้าเว็บถามซ้ำ
        if "/api/status" not in (args[0] if args else ""):
            super().log_message(fmt, *args)
