"""อ่าน ตรวจ กรอง และทำความสะอาดข้อมูลชาร์ต Spotify กับข้อมูลคุณลักษณะเสียง"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from .config import AUDIO_FEATURES, CHARTS_URL, PROCESSED_DIR, SONGS_URL


class DataError(RuntimeError):
    """ข้อผิดพลาดของข้อมูลที่ผู้ใช้แก้ไขได้ (ข้อความเป็นภาษาไทย)"""


# ---------------------------------------------------------------------------
# ชื่อคอลัมน์
# ---------------------------------------------------------------------------
COLUMN_ALIASES = {
    "title": ["title", "track_name", "song", "name", "track"],
    "rank": ["rank", "position", "pos"],
    "date": ["date", "chart_date", "day"],
    "artist": ["artist", "artists", "artist_name", "track_artist"],
    "url": ["url", "track_url", "uri", "spotify_url", "track_id", "id"],
    "region": ["region", "country", "market"],
    "chart": ["chart", "chart_type", "type"],
}
REQUIRED = ["title", "rank", "date", "artist", "url", "region", "chart"]


def missing_file_message(path: Path, url: str, what: str) -> str:
    return (
        f"ไม่พบไฟล์ {what}: {path}\n"
        f"  -> ดาวน์โหลดจาก {url}\n"
        f"  -> แล้ววางไฟล์ไว้ที่ {path}"
    )


def resolve_columns(columns: list[str]) -> dict[str, str]:
    """จับคู่ชื่อคอลัมน์มาตรฐานกับชื่อในไฟล์จริง (ไม่สนตัวพิมพ์เล็กใหญ่)"""
    lower = {c.strip().lower(): c for c in columns}
    mapping: dict[str, str] = {}
    for std, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            if a in lower:
                mapping[std] = lower[a]
                break
    missing = [c for c in REQUIRED if c not in mapping]
    if missing:
        raise DataError(
            "charts.csv ไม่มีคอลัมน์ที่ต้องใช้: "
            + ", ".join(missing)
            + f"\n  คอลัมน์ที่พบในไฟล์: {list(columns)}"
            + "\n  แก้ได้โดยเปลี่ยนชื่อคอลัมน์ให้ตรง หรือเพิ่มชื่อใน COLUMN_ALIASES ของ thai_chart_ml/data.py"
        )
    return mapping


def _norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def inspect_charts(path: Path, nrows: int = 5000) -> dict:
    """ดูโครงสร้างไฟล์จากส่วนต้นของไฟล์: คอลัมน์ ตัวอย่างวันที่ ประเทศ และประเภทชาร์ต"""
    if not Path(path).exists():
        raise DataError(missing_file_message(Path(path), CHARTS_URL, "charts.csv"))
    head = pd.read_csv(path, nrows=nrows)
    info: dict = {"columns": list(head.columns), "dtypes": head.dtypes.astype(str).to_dict()}
    try:
        cmap = resolve_columns(list(head.columns))
        info["column_mapping"] = cmap
        info["date_examples"] = head[cmap["date"]].astype(str).head(5).tolist()
        info["region_values_in_head"] = head[cmap["region"]].astype(str).value_counts().head(15).to_dict()
        info["chart_values_in_head"] = head[cmap["chart"]].astype(str).value_counts().to_dict()
        info["url_examples"] = head[cmap["url"]].astype(str).head(3).tolist()
    except DataError as exc:
        info["error"] = str(exc)
    return info


# ---------------------------------------------------------------------------
# กรองชาร์ตไทยแบบอ่านทีละส่วน
# ---------------------------------------------------------------------------
def _cache_paths(cache_dir: Path, region: str, chart: str) -> tuple[Path, Path]:
    tag = f"{_norm(region)}_{_norm(chart)}"
    return cache_dir / f"{tag}_filtered.csv", cache_dir / f"{tag}_filtered.meta.json"


def filter_region_chart(
    path: Path,
    region: str = "Thailand",
    chart: str = "top200",
    chunksize: int = 500_000,
    cache_dir: Path = PROCESSED_DIR,
    refresh: bool = False,
    log=print,
) -> pd.DataFrame:
    """อ่าน charts.csv ทีละ chunk กรองเฉพาะประเทศ/ชาร์ตที่ต้องการ แล้วบันทึกไว้ใช้ซ้ำ"""
    path = Path(path)
    if not path.exists():
        raise DataError(missing_file_message(path, CHARTS_URL, "charts.csv"))

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_csv, cache_meta = _cache_paths(cache_dir, region, chart)
    stat = path.stat()
    signature = {"source": str(path.resolve()), "size": stat.st_size, "mtime": stat.st_mtime,
                 "region": region, "chart": chart}
    if not refresh and cache_csv.exists() and cache_meta.exists():
        meta = json.loads(cache_meta.read_text(encoding="utf-8"))
        if meta.get("signature") == signature:
            log(f"[data] ใช้ไฟล์ที่กรองไว้แล้ว: {cache_csv} ({meta.get('rows', '?')} แถว)")
            return pd.read_csv(cache_csv, dtype={"url": str})

    header = pd.read_csv(path, nrows=0)
    cmap = resolve_columns(list(header.columns))
    want_region = _norm(region)
    region_ok = {want_region}
    if want_region == "thailand":
        region_ok.add("th")
    want_chart = _norm(chart)

    parts = []
    region_seen: dict[str, int] = {}
    chart_seen: dict[str, int] = {}
    total = 0
    usecols = [cmap[c] for c in REQUIRED] + ([c for c in header.columns if c.lower() == "streams"])
    for i, chunk in enumerate(pd.read_csv(path, chunksize=chunksize, usecols=usecols, dtype=str)):
        total += len(chunk)
        reg = chunk[cmap["region"]].astype(str)
        cht = chunk[cmap["chart"]].astype(str)
        for k, v in reg.value_counts().items():
            region_seen[k] = region_seen.get(k, 0) + int(v)
        for k, v in cht.value_counts().items():
            chart_seen[k] = chart_seen.get(k, 0) + int(v)
        mask = reg.map(_norm).isin(region_ok) & (cht.map(_norm) == want_chart)
        if mask.any():
            parts.append(chunk.loc[mask])
        log(f"[data] chunk {i + 1}: อ่านแล้ว {total:,} แถว, พบที่ตรงเงื่อนไขสะสม {sum(len(p) for p in parts):,}")

    if not parts:
        regions = sorted(region_seen, key=lambda r: -region_seen[r])[:40]
        raise DataError(
            f"กรองแล้วไม่พบข้อมูลสำหรับ region='{region}', chart='{chart}'\n"
            f"  คอลัมน์ที่ใช้: region -> '{cmap['region']}', chart -> '{cmap['chart']}'\n"
            f"  ค่า chart ที่พบ: {chart_seen}\n"
            f"  ค่า region ที่พบ (บางส่วน): {regions}\n"
            "  แก้ได้ด้วย --region และ --chart ให้ตรงกับค่าที่พบ"
        )

    df = pd.concat(parts, ignore_index=True)
    rename = {cmap[k]: k for k in REQUIRED}
    df = df.rename(columns=rename)
    df.columns = [c.lower() for c in df.columns]
    df.to_csv(cache_csv, index=False, encoding="utf-8")
    cache_meta.write_text(json.dumps({"signature": signature, "rows": len(df), "rows_scanned": total},
                                     ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[data] บันทึกข้อมูลที่กรองแล้ว {len(df):,} แถว -> {cache_csv}")
    return df


# ---------------------------------------------------------------------------
# ช่วงวันที่
# ---------------------------------------------------------------------------
def parse_dates(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce", format="%Y-%m-%d")
    if parsed.isna().mean() > 0.5:  # รูปแบบอื่น ให้ pandas เดา
        parsed = pd.to_datetime(series, errors="coerce")
    return parsed.dt.normalize()


def select_date_window(df: pd.DataFrame, start: str | None, end: str | None) -> tuple[pd.DataFrame, dict]:
    df = df.copy()
    df["date"] = parse_dates(df["date"])
    bad_dates = int(df["date"].isna().sum())
    df = df.dropna(subset=["date"])
    if df.empty:
        raise DataError("ไม่มีวันที่ที่อ่านได้ในคอลัมน์ date (ตรวจรูปแบบวันที่ เช่น 2021-12-31)")

    data_min, data_max = df["date"].min(), df["date"].max()
    end_ts = pd.Timestamp(end) if end else data_max
    if start:
        start_ts = pd.Timestamp(start)
        default_used = False
    else:
        start_ts = max(end_ts - pd.DateOffset(months=12) + pd.Timedelta(days=1), data_min)
        default_used = True
    if start_ts > end_ts:
        raise DataError(f"วันเริ่ม {start_ts.date()} อยู่หลังวันสิ้นสุด {end_ts.date()}")

    win = df[(df["date"] >= start_ts) & (df["date"] <= end_ts)].copy()
    if win.empty:
        raise DataError(
            f"ไม่มีข้อมูลในช่วง {start_ts.date()} ถึง {end_ts.date()} "
            f"(ข้อมูลที่มีอยู่: {data_min.date()} ถึง {data_max.date()})"
        )
    present = pd.DatetimeIndex(sorted(win["date"].unique()))
    full = pd.date_range(start_ts, end_ts, freq="D")
    missing = full.difference(present)
    info = {
        "data_available_from": str(data_min.date()),
        "data_available_to": str(data_max.date()),
        "requested_start": str(start_ts.date()),
        "requested_end": str(end_ts.date()),
        "default_12_month_window": default_used,
        "actual_first_date": str(present.min().date()),
        "actual_last_date": str(present.max().date()),
        "calendar_days_in_window": int(len(full)),
        "days_with_data": int(len(present)),
        "missing_days_count": int(len(missing)),
        "missing_days": [str(d.date()) for d in missing],
        "rows_with_unparseable_date": bad_dates,
    }
    return win, info


# ---------------------------------------------------------------------------
# track_id และการลบรายการซ้ำ
# ---------------------------------------------------------------------------
_TRACK_RE = re.compile(r"track[/:]([A-Za-z0-9]{22})")
_BARE_ID = re.compile(r"^[A-Za-z0-9]{22}$")


def extract_track_id(url: object) -> str | None:
    if url is None or (isinstance(url, float) and np.isnan(url)):
        return None
    s = str(url).strip()
    m = _TRACK_RE.search(s)
    if m:
        return m.group(1)
    if _BARE_ID.match(s):
        return s
    return None


def clean_chart_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """ดึง track_id, แปลงอันดับ, ลบซ้ำตาม track_id+date และเก็บสถิติแถวที่ตัดออก"""
    stats: dict = {"rows_in_window": int(len(df))}
    df = df.copy()
    df["track_id"] = df["url"].map(extract_track_id)
    stats["dropped_no_track_id"] = int(df["track_id"].isna().sum())
    df = df.dropna(subset=["track_id"])

    df["rank"] = pd.to_numeric(df["rank"], errors="coerce")
    bad_rank = df["rank"].isna() | (df["rank"] < 1)
    stats["dropped_invalid_rank"] = int(bad_rank.sum())
    df = df[~bad_rank].copy()
    df["rank"] = df["rank"].astype(int)

    before = len(df)
    df = df.drop_duplicates(subset=["track_id", "date", "rank"])
    stats["dropped_exact_duplicates"] = int(before - len(df))

    # อันดับขัดแย้ง: เพลงเดียวกัน วันเดียวกัน แต่อันดับต่างกัน -> เก็บอันดับที่ดีที่สุด
    n_rank = df.groupby(["track_id", "date"])["rank"].transform("nunique")
    conflict_rows = df[n_rank > 1]
    stats["rank_conflict_groups"] = int(conflict_rows.groupby(["track_id", "date"]).ngroups)
    stats["rank_conflict_examples"] = (
        conflict_rows.sort_values(["track_id", "date", "rank"]).head(10)
        .assign(date=lambda d: d["date"].astype(str))[["track_id", "date", "rank", "title"]]
        .to_dict("records")
    )
    before = len(df)
    df = df.sort_values(["track_id", "date", "rank"]).drop_duplicates(subset=["track_id", "date"], keep="first")
    stats["dropped_conflicting_rank_rows"] = int(before - len(df))

    # ตรวจเพิ่ม: วันเดียวกัน อันดับเดียวกัน แต่หลายเพลง (รายงานเท่านั้น)
    collide = df.groupby(["date", "rank"])["track_id"].transform("nunique")
    stats["rows_sharing_date_and_rank"] = int((collide > 1).sum())
    stats["rows_after_cleaning"] = int(len(df))
    stats["total_rows_removed"] = stats["rows_in_window"] - stats["rows_after_cleaning"]
    return df.reset_index(drop=True), stats


# ---------------------------------------------------------------------------
# ข้อมูลเสียง
# ---------------------------------------------------------------------------
def load_audio_features(path: Path) -> tuple[pd.DataFrame | None, dict]:
    path = Path(path)
    if not path.exists():
        return None, {"available": False, "message": missing_file_message(path, SONGS_URL, "spotify_songs.csv")}
    raw = pd.read_csv(path)
    cols = {c.lower(): c for c in raw.columns}
    need = ["track_id"] + AUDIO_FEATURES
    missing = [c for c in need if c not in cols]
    if missing:
        raise DataError(f"spotify_songs.csv ไม่มีคอลัมน์ {missing}\n  คอลัมน์ที่พบ: {list(raw.columns)}")
    audio = raw[[cols[c] for c in need]].copy()
    audio.columns = need
    for c in AUDIO_FEATURES:
        audio[c] = pd.to_numeric(audio[c], errors="coerce")
    audio = audio.dropna(subset=["track_id"])
    n_rows = len(audio)
    audio = audio.drop_duplicates(subset=["track_id"], keep="first").reset_index(drop=True)
    return audio, {"available": True, "rows_in_file": int(len(raw)), "rows_with_track_id": int(n_rows),
                   "unique_track_ids": int(len(audio))}


def join_audio(songs: pd.DataFrame, audio: pd.DataFrame | None, audio_info: dict) -> tuple[pd.DataFrame, dict]:
    """left join ด้วย track_id ไม่เติมค่าให้เพลงที่จับคู่ไม่ได้"""
    n = len(songs)
    if audio is None:
        out = songs.copy()
        for c in AUDIO_FEATURES:
            out[c] = np.nan
        out["audio_matched"] = False
        return out, {**audio_info, "songs": n, "matched": 0, "matched_pct": 0.0}
    out = songs.merge(audio, on="track_id", how="left", validate="one_to_one")
    assert len(out) == n, "left join ต้องไม่เพิ่มจำนวนแถว"
    out["audio_matched"] = out[AUDIO_FEATURES].notna().all(axis=1)
    matched = int(out["audio_matched"].sum())
    return out, {**audio_info, "songs": n, "matched": matched,
                 "matched_pct": round(100 * matched / n, 2) if n else 0.0,
                 "unmatched": n - matched}
