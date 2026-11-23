"""สร้างข้อมูลจำลองรูปแบบเดียวกับไฟล์จริง สำหรับทดสอบโค้ดเท่านั้น

ผลที่ได้จากข้อมูลชุดนี้ *ไม่ใช่* ผลของชาร์ต Spotify ประเทศไทย
"""
from __future__ import annotations

import random
import string
from pathlib import Path

import numpy as np
import pandas as pd

from .config import RANDOM_STATE

ARCHETYPES = {
    # ชื่อ: (ความนิยมสูงสุด, วันถึงจุดสูงสุด, อัตราลดหลังจุดสูงสุด)
    "fast_long": (9.0, 3, 0.004),
    "slow_build": (7.5, 45, 0.010),
    "short_spike": (8.5, 2, 0.090),
    "low_short": (5.0, 5, 0.060),
    "steady_mid": (6.3, 12, 0.006),
}


def _fake_track_id(rng: random.Random) -> str:
    return "".join(rng.choice(string.ascii_letters + string.digits) for _ in range(22))


def make_synthetic_charts(path: Path, n_songs: int = 320, n_days: int = 420, seed: int = RANDOM_STATE) -> pd.DataFrame:
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    start = pd.Timestamp("2020-10-01")
    songs = []
    for i in range(n_songs):
        arch = rng.choice(list(ARCHETYPES))
        peak, t_peak, decay = ARCHETYPES[arch]
        songs.append({
            "track_id": _fake_track_id(rng),
            "title": f"Synthetic Song {i + 1:03d}",
            "artist": f"Synthetic Artist {rng.randint(1, 60):02d}",
            "debut": rng.randint(-60, n_days - 10),
            "peak": peak + nrng.normal(0, 0.6),
            "t_peak": max(1, int(t_peak * nrng.uniform(0.5, 1.5))),
            "decay": decay * nrng.uniform(0.7, 1.3),
        })
    # ชื่อเพลงซ้ำแต่คนละ track_id (ใช้ทดสอบการเลือกจาก Track ID)
    songs[1]["title"] = songs[0]["title"] = "Synthetic Duplicate Title"

    skip_days = {50, 51, 200}  # วันที่ข้อมูลขาด
    rows = []
    for d in range(n_days):
        if d in skip_days:
            continue
        date = start + pd.Timedelta(days=d)
        scores = []
        for s in songs:
            t = d - s["debut"]
            if t < 0:
                continue
            if t <= s["t_peak"]:
                v = s["peak"] - 3.0 * (1 - t / s["t_peak"])
            else:
                v = s["peak"] - s["decay"] * (t - s["t_peak"]) * 10
            scores.append((v + nrng.normal(0, 0.25), s))
        scores.sort(key=lambda x: -x[0])
        for r, (_, s) in enumerate(scores[:200], start=1):
            rows.append({
                "title": s["title"], "rank": r, "date": date.strftime("%Y-%m-%d"),
                "artist": s["artist"], "url": f"https://open.spotify.com/track/{s['track_id']}",
                "region": "Thailand", "chart": "top200", "trend": "SAME_POSITION",
                "streams": int(200000 / r),
            })
    df = pd.DataFrame(rows)
    # แถวซ้ำแบบตรงกันทุกอย่าง + แถวอันดับขัดแย้ง + แถวประเทศ/ชาร์ตอื่น (ต้องถูกกรองออก)
    dup = df.iloc[[10, 20]].copy()
    conflict = df.iloc[[30]].copy()
    conflict["rank"] = conflict["rank"] + 7
    other = df.iloc[:50].copy()
    other["region"] = "Japan"
    viral = df.iloc[:50].copy()
    viral["chart"] = "viral50"
    bad = df.iloc[[0]].copy()
    bad["url"] = "not-a-spotify-url"
    df = pd.concat([df, dup, conflict, other, viral, bad], ignore_index=True)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8")
    return df


def make_synthetic_songs(path: Path, charts: pd.DataFrame, match_share: float = 0.45, seed: int = RANDOM_STATE) -> pd.DataFrame:
    """ไฟล์ข้อมูลเสียงจำลอง จับคู่ได้เพียงบางส่วน และมี track_id ซ้ำหลายแถว"""
    rng = np.random.default_rng(seed)
    ids = sorted(charts["url"].str.extract(r"track/([A-Za-z0-9]{22})")[0].dropna().unique())
    chosen = rng.choice(ids, size=int(len(ids) * match_share), replace=False)
    r = random.Random(seed)
    extra = [_fake_track_id(r) for _ in range(150)]  # เพลงที่ไม่อยู่ในชาร์ต
    all_ids = list(chosen) + extra
    n = len(all_ids)
    df = pd.DataFrame({
        "track_id": all_ids,
        "track_name": [f"Audio {i}" for i in range(n)],
        "track_artist": "Synthetic",
        "danceability": rng.uniform(0.3, 0.9, n).round(3),
        "energy": rng.uniform(0.2, 0.95, n).round(3),
        "acousticness": rng.uniform(0.0, 0.8, n).round(3),
        "valence": rng.uniform(0.1, 0.9, n).round(3),
        "tempo": rng.uniform(70, 170, n).round(1),
        "playlist_genre": "pop",
    })
    df = pd.concat([df, df.iloc[:20]], ignore_index=True)  # track_id ซ้ำเหมือนไฟล์จริง
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8")
    return df
