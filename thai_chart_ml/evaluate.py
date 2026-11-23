"""ประเมินผลการแนะนำเทียบกับการสุ่ม (baseline) แบบเชิงสำรวจ

ไม่ใช้คะแนน cosine ตัวเดิมยืนยันความแม่นยำ แต่วัดด้วยตัวชี้วัดที่คำนวณแยกต่างหาก:
1) trajectory_mad — ค่าเฉลี่ยผลต่างอันดับรายวันหลังเปิดตัว (จัดแนวจากวันแรกที่พบ)
   ระหว่างเพลงตั้งต้นกับเพลงที่ถูกแนะนำ (ต่ำ = เส้นอันดับคล้ายกันมากกว่า)
2) audio_distance — ระยะห่างของคุณลักษณะเสียง (มาตรฐานแล้ว) เฉพาะคู่ที่จับคู่ข้อมูลเสียงได้ทั้งคู่
ตัวชี้วัดทั้งสองยังมาจากข้อมูลชาร์ตชุดเดียวกัน จึงเป็นการตรวจเชิงสำรวจ ไม่ใช่การยืนยันความแม่นยำ
จนกว่าจะมีคะแนนจากผู้ประเมิน (human judgement)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import AUDIO_FEATURES, RANDOM_STATE
from .recommend import recommend

OFF_CHART_RANK = 201  # วันที่หลุดชาร์ตหลังเปิดตัว ถือเป็นอันดับ 201
HORIZON_DAYS = 90


def aligned_trajectories(chart: pd.DataFrame, songs: pd.DataFrame, window_end: pd.Timestamp,
                         horizon: int = HORIZON_DAYS) -> dict[str, np.ndarray]:
    """เวกเตอร์อันดับนับจากวันแรกที่พบ: ติดชาร์ต=อันดับ, หลุด=201, เกินวันสุดท้ายของข้อมูล=NaN"""
    first = songs.set_index("track_id")["first_date"]
    out: dict[str, np.ndarray] = {}
    for tid, grp in chart.groupby("track_id"):
        f = first[tid]
        vec = np.full(horizon, float(OFF_CHART_RANK))
        avail = (window_end - f).days + 1
        if avail < horizon:
            vec[max(avail, 0):] = np.nan
        off = (grp["date"] - f).dt.days.to_numpy()
        ok = off < horizon
        vec[off[ok]] = grp["rank"].to_numpy()[ok]
        out[tid] = vec
    return out


def trajectory_mad(a: np.ndarray, b: np.ndarray) -> float:
    m = ~np.isnan(a) & ~np.isnan(b)
    return float(np.mean(np.abs(a[m] - b[m]))) if m.sum() >= 7 else np.nan


def _audio_matrix(songs: pd.DataFrame) -> dict[str, np.ndarray]:
    m = songs[songs["audio_matched"]]
    if len(m) < 2:
        return {}
    A = m[AUDIO_FEATURES].to_numpy(dtype=float)
    A = (A - A.mean(axis=0)) / np.where(A.std(axis=0) == 0, 1, A.std(axis=0))
    return dict(zip(m["track_id"], A))


def _score(seed: str, cands: list[str], traj, audio) -> dict:
    t = [trajectory_mad(traj[seed], traj[c]) for c in cands]
    a = [float(np.linalg.norm(audio[seed] - audio[c])) for c in cands if seed in audio and c in audio]
    return {"trajectory_mad": float(np.nanmean(t)) if not all(np.isnan(t)) else np.nan,
            "audio_distance": float(np.mean(a)) if a else np.nan, "audio_pairs": len(a)}


def evaluate_recommendations(songs: pd.DataFrame, chart: pd.DataFrame, window_end: pd.Timestamp,
                             n_seeds: int = 10, top_n: int = 5, n_random_draws: int = 100):
    rng = np.random.default_rng(RANDOM_STATE)
    ids = songs["track_id"].sort_values().to_numpy()
    n_seeds = min(n_seeds, len(ids))
    seeds = list(rng.choice(ids, size=n_seeds, replace=False))
    traj = aligned_trajectories(chart, songs, window_end)
    audio = _audio_matrix(songs)
    cluster = songs.set_index("track_id")["cluster"]

    rows, rec_rows = [], []
    for s in seeds:
        rec = recommend(songs, s, top_n)
        rec_ids = rec["track_id"].tolist()
        for r in rec.itertuples(index=False):
            rec_rows.append({"seed_track_id": s, **r._asdict()})
        others = ids[ids != s]
        k = min(top_n, len(others))
        rand_scores = [_score(s, list(rng.choice(others, size=k, replace=False)), traj, audio)
                       for _ in range(n_random_draws)]
        rs = _score(s, rec_ids, traj, audio)
        rows.append({
            "seed_track_id": s,
            "seed_title": songs.loc[songs["track_id"] == s, "title"].iloc[0],
            "rec_trajectory_mad": round(rs["trajectory_mad"], 2),
            "random_trajectory_mad": round(float(np.nanmean([x["trajectory_mad"] for x in rand_scores])), 2),
            "rec_same_cluster_pct": round(100 * float(np.mean([cluster[c] == cluster[s] for c in rec_ids])), 1),
            "rec_audio_distance": None if np.isnan(rs["audio_distance"]) else round(rs["audio_distance"], 3),
            "random_audio_distance": (None if all(np.isnan(x["audio_distance"]) for x in rand_scores)
                                      else round(float(np.nanmean([x["audio_distance"] for x in rand_scores])), 3)),
            "rec_audio_pairs": rs["audio_pairs"],
        })
    per_seed = pd.DataFrame(rows)
    per_seed["rec_better_than_random"] = per_seed["rec_trajectory_mad"] < per_seed["random_trajectory_mad"]
    summary = {
        "type": "exploratory (ยังไม่มีคะแนนจากผู้ประเมิน)",
        "n_seeds": int(n_seeds),
        "seed_selection": f"numpy default_rng({RANDOM_STATE}) เลือกจาก track_id ที่เรียงแล้ว",
        "metric": f"trajectory_mad: ผลต่างอันดับรายวันเฉลี่ย {HORIZON_DAYS} วันแรกหลังพบครั้งแรก (หลุดชาร์ต=201)",
        "random_baseline": f"สุ่ม {top_n} เพลง x {n_random_draws} ครั้งต่อเพลงตั้งต้น",
        "mean_rec_trajectory_mad": round(float(per_seed["rec_trajectory_mad"].mean()), 2),
        "mean_random_trajectory_mad": round(float(per_seed["random_trajectory_mad"].mean()), 2),
        "seeds_rec_better_than_random": int(per_seed["rec_better_than_random"].sum()),
        "audio_pairs_available": int(per_seed["rec_audio_pairs"].sum()),
        "note": "ตัวชี้วัดมาจากข้อมูลชาร์ตชุดเดียวกับคุณลักษณะที่ใช้แนะนำ จึงเป็นการตรวจความสอดคล้องเชิงสำรวจ "
                "ไม่ใช่การพิสูจน์ความแม่นยำ ควรให้ผู้ประเมินดูกราฟประวัติอันดับเพิ่มเติม",
    }
    return per_seed, pd.DataFrame(rec_rows), summary, seeds
