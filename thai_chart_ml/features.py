"""สรุปข้อมูลรายวันให้เหลือหนึ่งแถวต่อเพลง (track_id)"""
from __future__ import annotations

import pandas as pd


def build_song_features(chart: pd.DataFrame) -> pd.DataFrame:
    """คุณลักษณะจากชาร์ต: best_rank, median_rank, days_on_chart, days_to_peak

    days_to_peak = จำนวนวันจากวันแรกที่พบในช่วงข้อมูล ถึงวันแรกที่ทำอันดับดีที่สุด
    """
    df = chart.sort_values(["track_id", "date", "rank"])
    g = df.groupby("track_id", sort=True)
    out = pd.DataFrame({
        "title": g["title"].agg(lambda s: s.mode().iloc[0] if not s.mode().empty else s.iloc[-1]),
        "artist": g["artist"].agg(lambda s: s.mode().iloc[0] if not s.mode().empty else s.iloc[-1]),
        "best_rank": g["rank"].min(),
        "median_rank": g["rank"].median(),
        "days_on_chart": g["date"].nunique(),
        "first_date": g["date"].min(),
        "last_date": g["date"].max(),
    })
    # วันแรกที่ทำอันดับดีที่สุด (กรณีอันดับดีที่สุดเกิดหลายวัน ใช้วันแรก)
    best = df.merge(out[["best_rank"]], left_on="track_id", right_index=True)
    peak_date = best[best["rank"] == best["best_rank"]].groupby("track_id")["date"].min()
    out["peak_date"] = peak_date
    out["days_to_peak"] = (out["peak_date"] - out["first_date"]).dt.days.astype(int)
    out = out.reset_index()
    return out[["track_id", "title", "artist", "best_rank", "median_rank", "days_on_chart",
                "days_to_peak", "first_date", "peak_date", "last_date"]]
