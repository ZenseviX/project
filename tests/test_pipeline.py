"""ทดสอบเส้นทางหลักและกรณีขอบ: python -m pytest -q"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from thai_chart_ml import data as D
from thai_chart_ml.config import AUDIO_FEATURES, PipelineConfig
from thai_chart_ml.features import build_song_features
from thai_chart_ml.model import ModelError, run_kmeans, valid_k_values
from thai_chart_ml.pipeline import run_pipeline
from thai_chart_ml.recommend import SearchError, recommend, resolve_song

TID = ["A" * 22, "B" * 22, "C" * 22, "D" * 22, "E" * 22, "F" * 22, "G" * 22]


def _rows(tid, title, ranks, start="2021-01-01", region="Thailand", chart="top200"):
    d0 = pd.Timestamp(start)
    return [{"title": title, "rank": r, "date": str((d0 + pd.Timedelta(days=i)).date()), "artist": f"Artist {title}",
             "url": f"https://open.spotify.com/track/{tid}", "region": region, "chart": chart,
             "trend": "SAME_POSITION", "streams": 1000} for i, r in enumerate(ranks) if r is not None]


@pytest.fixture
def small_csv(tmp_path):
    rows = []
    rows += _rows(TID[0], "Same Name", [5, 3, 1, 1, 2, 4, 8, 12])
    rows += _rows(TID[1], "Same Name", [150, 140, 160, 170])
    rows += _rows(TID[2], "Long Runner", [40, 35, 30, 28, 25, 30, 33, 35, 40, 45])
    rows += _rows(TID[3], "Short Spike", [2, 10, 60])
    rows += _rows(TID[4], "Slow Climber", [180, 150, 120, 90, 60, 30, 20, 15], start="2021-01-03")
    rows += _rows(TID[5], "Steady", [100, 101, 99, 100, 98, 100])
    rows += _rows(TID[6], "Other Country", [1, 1, 1], region="Japan")
    rows += _rows(TID[6], "Viral", [1, 1], chart="viral50")
    df = pd.DataFrame(rows)
    df = pd.concat([df, df.iloc[[0]], df.iloc[[1]].assign(rank=99)], ignore_index=True)  # ซ้ำ + ขัดแย้ง
    charts = tmp_path / "charts.csv"
    df.to_csv(charts, index=False)
    songs = tmp_path / "spotify_songs.csv"
    pd.DataFrame({"track_id": [TID[0], TID[0], TID[2], "Z" * 22],
                  "track_name": ["x", "x", "y", "z"], **{f: [0.5, 0.5, 0.7, 0.1] for f in AUDIO_FEATURES}}
                 ).to_csv(songs, index=False)
    return charts, songs


def test_extract_track_id():
    assert D.extract_track_id("https://open.spotify.com/track/" + TID[0]) == TID[0]
    assert D.extract_track_id("spotify:track:" + TID[1]) == TID[1]
    assert D.extract_track_id(TID[2]) == TID[2]
    assert D.extract_track_id("https://example.com/x") is None
    assert D.extract_track_id(np.nan) is None


def test_missing_columns_reports_found_columns():
    with pytest.raises(D.DataError, match="คอลัมน์ที่พบ"):
        D.resolve_columns(["foo", "bar"])


def test_filter_no_match_reports_values(small_csv, tmp_path):
    charts, _ = small_csv
    with pytest.raises(D.DataError) as e:
        D.filter_region_chart(charts, region="Narnia", cache_dir=tmp_path / "c", log=lambda *_: None)
    assert "Thailand" in str(e.value) and "top200" in str(e.value)


def test_filter_chunked_and_cache(small_csv, tmp_path):
    charts, _ = small_csv
    df = D.filter_region_chart(charts, chunksize=7, cache_dir=tmp_path / "c", log=lambda *_: None)
    assert set(df["region"]) == {"Thailand"} and set(df["chart"]) == {"top200"}
    again = D.filter_region_chart(charts, chunksize=7, cache_dir=tmp_path / "c", log=lambda *_: None)
    assert len(again) == len(df)


def test_clean_dedup_and_conflict(small_csv, tmp_path):
    charts, _ = small_csv
    df = D.filter_region_chart(charts, cache_dir=tmp_path / "c", log=lambda *_: None)
    win, info = D.select_date_window(df, None, None)
    clean, st = D.clean_chart_rows(win)
    assert st["dropped_exact_duplicates"] == 1
    assert st["rank_conflict_groups"] == 1
    assert not clean.duplicated(["track_id", "date"]).any()
    # อันดับที่ขัดแย้ง (99 กับ 3) ต้องเก็บอันดับดีกว่า
    r = clean[(clean.track_id == TID[0]) & (clean.date == pd.Timestamp("2021-01-02"))]["rank"].item()
    assert r == 3
    assert info["default_12_month_window"] and info["missing_days_count"] == 0


def test_date_window_missing_days():
    df = pd.DataFrame({"date": ["2021-01-01", "2021-01-02", "2021-01-05"], "x": 1})
    _, info = D.select_date_window(df, "2021-01-01", "2021-01-05")
    assert info["days_with_data"] == 3 and info["missing_days"] == ["2021-01-03", "2021-01-04"]
    with pytest.raises(D.DataError):
        D.select_date_window(df, "2022-01-01", "2022-02-01")


def test_days_to_peak_uses_first_best_day():
    chart = pd.DataFrame({"track_id": ["x"] * 4, "title": "t", "artist": "a", "rank": [5, 1, 1, 3],
                          "date": pd.date_range("2021-01-01", periods=4)})
    f = build_song_features(chart).iloc[0]
    assert f.best_rank == 1 and f.days_to_peak == 1 and f.days_on_chart == 4 and f.median_rank == 2.0


def test_audio_left_join_no_imputation(tmp_path):
    songs = pd.DataFrame({"track_id": [TID[0], TID[1]]})
    p = tmp_path / "s.csv"
    pd.DataFrame({"track_id": [TID[0], TID[0]], **{f: [0.3, 0.9] for f in AUDIO_FEATURES}}).to_csv(p, index=False)
    audio, info = D.load_audio_features(p)
    assert info["unique_track_ids"] == 1
    out, st = D.join_audio(songs, audio, info)
    assert len(out) == 2 and st["matched"] == 1 and st["matched_pct"] == 50.0
    assert out.loc[out.track_id == TID[1], AUDIO_FEATURES].isna().all(axis=None)


def test_missing_audio_file(tmp_path):
    audio, info = D.load_audio_features(tmp_path / "nope.csv")
    assert audio is None and "spotify_songs.csv" in info["message"]


def test_small_data_k_range():
    ks, skipped = valid_k_values(4, 4, 2, 8)
    assert ks == [2, 3] and [s["k"] for s in skipped] == [4, 5, 6, 7, 8]
    feats = pd.DataFrame({"best_rank": [1, 2, 3, 4], "median_rank": [1, 5, 9, 3],
                          "days_on_chart": [4, 3, 2, 1], "days_to_peak": [0, 1, 0, 2]})
    res = run_kmeans(feats, log=lambda *_: None)
    assert set(res.k_scores[res.k_scores.status == "tested"]["k"]) == {2, 3}
    with pytest.raises(ModelError):
        run_kmeans(feats.head(2), log=lambda *_: None)


def test_end_to_end_small(small_csv, tmp_path, monkeypatch):
    charts, songs = small_csv
    monkeypatch.setattr("thai_chart_ml.pipeline.PROCESSED_DIR", tmp_path / "cache")
    cfg = PipelineConfig(charts_path=charts, songs_path=songs, output_dir=tmp_path / "out", chunksize=5)
    r = run_pipeline(cfg, log=lambda *_: None)
    s = r["summary"]
    assert s["data_source"] == "real" and s["n_songs"] == 6
    assert s["audio_matched"] == 2 and s["audio_matched_pct"] == pytest.approx(33.33)
    tested = r["k_scores"][r["k_scores"].status == "tested"]["k"].tolist()
    assert max(tested) <= 5  # 6 เพลง -> k สูงสุด 5
    for f in ["song_clusters.csv", "k_scores.csv", "audio_match_stats.json", "pca_clusters.png",
              "rank_history_samples.png", "dashboard.json", "recommendation_eval.csv"]:
        assert (tmp_path / "out" / f).exists(), f
    dash = json.loads((tmp_path / "out" / "dashboard.json").read_text(encoding="utf-8"))
    assert len(dash["songs"]) == 6 and dash["meta"]["data_source"] == "real"
    # ทุกโมเดลต้องมีป้ายกลุ่มครบทุกเพลง และ K-Means ต้องตรงกับคอลัมน์ cluster หลัก
    keys = [m["key"] for m in dash["models"]]
    assert keys == ["kmeans", "agglomerative", "gmm"]
    for m in dash["models"]:
        assert len(m["labels"]) == 6 and m["best_k"] == len(m["clusters"])
    assert dash["models"][0]["labels"] == [s["c"] for s in dash["songs"]]
    assert dash["models"][2]["confidence"] is not None
    assert {(p["a"], p["b"]) for p in dash["model_agreement"]} == {
        ("kmeans", "agglomerative"), ("kmeans", "gmm"), ("agglomerative", "gmm")}

    songs_df = r["songs"]
    with pytest.raises(SearchError, match=TID[1]):
        resolve_song(songs_df, "same name")  # ชื่อซ้ำ ต้องให้เลือกจาก Track ID
    one = resolve_song(songs_df, "same name", track_id=TID[1])
    rec = recommend(songs_df, one.track_id, 5)
    assert len(rec) == 5 and TID[1] not in rec["track_id"].tolist()
    assert rec["similarity"].is_monotonic_decreasing


def test_missing_charts_falls_back_to_synthetic(tmp_path):
    cfg = PipelineConfig(charts_path=tmp_path / "none.csv", songs_path=tmp_path / "none2.csv",
                         output_dir=tmp_path / "out", make_plots=False)
    r = run_pipeline(cfg, log=lambda *_: None)
    assert r["summary"]["data_source"] == "synthetic"
    assert "ข้อมูลจำลอง" in r["summary"]["warning"]
    assert any("kaggle.com" in n for n in r["summary"]["notices"])


def test_compare_models_well_separated():
    """กลุ่มที่แยกกันชัด 3 ก้อน ทุกโมเดลควรเลือก k=3 และแบ่งตรงกัน (ARI = 1)"""
    from thai_chart_ml.compare import compare_models
    rng = np.random.default_rng(0)
    centers = np.array([[1, 1, 300, 0], [50, 120, 30, 10], [150, 190, 5, 2]], dtype=float)
    X = np.vstack([c + rng.normal(0, [1, 2, 3, 0.5], size=(20, 4)) for c in centers])
    feats = pd.DataFrame(X, columns=["best_rank", "median_rank", "days_on_chart", "days_to_peak"])
    feats["audio_matched"] = False
    for f in AUDIO_FEATURES:
        feats[f] = np.nan
    res = run_kmeans(feats, log=lambda *_: None)
    cmp = compare_models(feats, res, 2, 6, log=lambda *_: None)
    assert [m["best_k"] for m in cmp["models"]] == [3, 3, 3]
    assert all(p["ari"] == 1.0 for p in cmp["agreement"])


def test_upload_csv_zip_and_bad_file_keeps_old(tmp_path):
    """อัปโหลดผ่าน API: csv ตรง, zip แบบ Kaggle และไฟล์เสียไม่ทับไฟล์เดิม"""
    import io
    import zipfile

    from thai_chart_ml.server import UploadError, save_upload

    charts = "title,rank,date,artist,url,region,chart,trend,streams\nA,1,2021-01-01,X,https://open.spotify.com/track/abc,Thailand,top200,SAME,10\n"
    raw = tmp_path / "raw"
    res = save_upload("charts", io.BytesIO(charts.encode()), len(charts.encode()), raw_dir=raw)
    assert res["ok"] and not res["from_zip"] and (raw / "charts.csv").read_text() == charts

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("charts.csv", charts.replace("A,1", "B,2"))
    data = buf.getvalue()
    res = save_upload("charts", io.BytesIO(data), len(data), raw_dir=raw)
    assert res["from_zip"] and "B,2" in (raw / "charts.csv").read_text()

    bad = b"foo,bar\n1,2\n"
    with pytest.raises(UploadError):
        save_upload("charts", io.BytesIO(bad), len(bad), raw_dir=raw)
    assert "B,2" in (raw / "charts.csv").read_text()  # ไฟล์เดิมยังอยู่
    assert sorted(p.name for p in raw.iterdir()) == ["charts.csv"]  # ไม่มีไฟล์ชั่วคราวค้าง

    songs = "track_id,danceability,energy,acousticness,valence,tempo\nabc,0.5,0.6,0.1,0.4,120\n"
    res = save_upload("songs", io.BytesIO(songs.encode()), len(songs.encode()), raw_dir=raw)
    assert res["name"] == "spotify_songs.csv"
