"""ค้นหาเพลงและแนะนำ 5 เพลงที่มีรูปแบบการติดชาร์ตใกล้เคียงด้วย Cosine Similarity"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from .config import CHART_FEATURES

Z_COLS = [f"z_{c}" for c in CHART_FEATURES]


class SearchError(RuntimeError):
    pass


def search_songs(songs: pd.DataFrame, query: str) -> pd.DataFrame:
    """ค้นด้วยชื่อเพลง (ไม่สนตัวพิมพ์) ชื่อที่ตรงทั้งหมดมาก่อน"""
    q = query.strip().lower()
    if not q:
        raise SearchError("กรุณาระบุชื่อเพลง")
    titles = songs["title"].astype(str).str.lower()
    exact = songs[titles == q]
    if not exact.empty:
        return exact
    return songs[titles.str.contains(q, regex=False)]


def resolve_song(songs: pd.DataFrame, query: str | None = None, track_id: str | None = None) -> pd.Series:
    """คืนเพลงเดียว ถ้าชื่อซ้ำให้ผู้ใช้เลือกด้วย Track ID"""
    if track_id:
        hit = songs[songs["track_id"] == track_id]
        if hit.empty:
            raise SearchError(f"ไม่พบ Track ID {track_id}")
        return hit.iloc[0]
    if not query:
        raise SearchError("ระบุชื่อเพลง หรือ --track-id")
    hits = search_songs(songs, query)
    if hits.empty:
        raise SearchError(f"ไม่พบเพลงที่ชื่อมีคำว่า '{query}'")
    if len(hits) > 1:
        lines = "\n".join(
            f"  {r.track_id}  {r.title} — {r.artist} (อันดับดีสุด {r.best_rank}, ติดชาร์ต {r.days_on_chart} วัน)"
            for r in hits.head(20).itertuples()
        )
        raise SearchError(f"พบ {len(hits)} เพลงที่ตรงกับ '{query}' กรุณาเลือกด้วย --track-id:\n{lines}")
    return hits.iloc[0]


def recommend(songs: pd.DataFrame, track_id: str, top_n: int = 5) -> pd.DataFrame:
    """songs ต้องมีคอลัมน์ z_* (คุณลักษณะชาร์ตที่ปรับสเกลแล้ว)"""
    idx = songs.index[songs["track_id"] == track_id]
    if len(idx) == 0:
        raise SearchError(f"ไม่พบ Track ID {track_id}")
    Z = songs[Z_COLS].to_numpy(dtype=float)
    pos = songs.index.get_loc(idx[0])
    sims = cosine_similarity(Z[pos:pos + 1], Z)[0]
    res = songs.assign(similarity=np.round(sims, 4))
    res = res[res["track_id"] != track_id]
    res = res.sort_values(["similarity", "track_id"], ascending=[False, True]).head(top_n)
    cols = ["track_id", "title", "artist", "similarity", "cluster", "cluster_name"] + CHART_FEATURES
    return res[[c for c in cols if c in res.columns]].reset_index(drop=True)
