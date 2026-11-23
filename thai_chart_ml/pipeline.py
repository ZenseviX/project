"""เส้นทางหลัก: CSV -> กรอง -> ทำความสะอาด -> คุณลักษณะ -> K-Means -> แนะนำ -> ประเมิน -> ส่งออก

ทั้ง CLI (python -m thai_chart_ml run) และ Notebook เรียกฟังก์ชัน run_pipeline() ตัวเดียวกันนี้
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import data as D
from .config import (AUDIO_FEATURES, CHART_FEATURES, CHARTS_URL, OUTPUT_DIR, PROCESSED_DIR,
                     PROJECT_ROOT, SONGS_URL, PipelineConfig)
from .compare import compare_models, models_for_dashboard
from .evaluate import evaluate_recommendations
from .features import build_song_features
from .model import (audio_profiles, cluster_profiles, name_clusters, relabel_by_size, run_kmeans)
from .recommend import Z_COLS

SYNTH_DIR = PROJECT_ROOT / "data" / "synthetic"
SYNTH_WARNING = ("ผลลัพธ์นี้มาจากข้อมูลจำลอง (synthetic) เพื่อทดสอบโค้ดเท่านั้น "
                 "ไม่ใช่ผลของชาร์ต Spotify ประเทศไทย")


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return str(o.date()) if hasattr(o, "date") else str(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, Path):
        return str(o)
    raise TypeError(type(o))


def _clean_nan(o):
    if isinstance(o, dict):
        return {k: _clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean_nan(v) for v in o]
    if isinstance(o, (float, np.floating)) and np.isnan(o):
        return None
    return o


def _write_json(obj, path: Path) -> None:
    text = json.dumps(_clean_nan(obj), ensure_ascii=False, indent=1, default=_json_default, allow_nan=False)
    path.write_text(text, encoding="utf-8")


def run_pipeline(cfg: PipelineConfig | None = None, log=print) -> dict:
    cfg = cfg or PipelineConfig()
    charts_path, songs_path = Path(cfg.charts_path), Path(cfg.songs_path)
    notices: list[str] = []

    # ---------------- 1) เลือกแหล่งข้อมูล ----------------
    synthetic = cfg.force_synthetic or not charts_path.exists()
    if synthetic:
        if not charts_path.exists():
            msg = D.missing_file_message(charts_path, CHARTS_URL, "charts.csv")
            notices.append(msg)
            log("[ข้อมูล] " + msg)
        log("[ข้อมูล] *** ใช้ข้อมูลจำลองสำหรับทดสอบ: " + SYNTH_WARNING + " ***")
        from .synthetic import make_synthetic_charts, make_synthetic_songs
        charts_path = SYNTH_DIR / "charts_synthetic.csv"
        songs_path = SYNTH_DIR / "spotify_songs_synthetic.csv"
        ch = make_synthetic_charts(charts_path)
        make_synthetic_songs(songs_path, ch)
        cache_dir = SYNTH_DIR / "processed"
        refresh = True
    else:
        cache_dir = PROCESSED_DIR
        refresh = cfg.refresh_cache
        if not songs_path.exists():
            msg = D.missing_file_message(songs_path, SONGS_URL, "spotify_songs.csv")
            notices.append(msg + "\n  -> รันต่อโดยไม่มีข้อมูลเสียง (ไม่เติมค่าแทน)")
            log("[ข้อมูล] " + notices[-1])
    source = "synthetic" if synthetic else "real"
    out_dir = Path(cfg.output_dir) if cfg.output_dir else OUTPUT_DIR / source
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"[ข้อมูล] แหล่งข้อมูล: {source} | ผลลัพธ์จะอยู่ที่ {out_dir}")

    # ---------------- 2) กรอง + ช่วงวัน + ทำความสะอาด ----------------
    thai = D.filter_region_chart(charts_path, cfg.region, cfg.chart, cfg.chunksize, cache_dir, refresh, log)
    window, date_info = D.select_date_window(thai, cfg.start_date, cfg.end_date)
    log(f"[ข้อมูล] ช่วงวันจริง {date_info['actual_first_date']} ถึง {date_info['actual_last_date']} | "
        f"มีข้อมูล {date_info['days_with_data']} วัน จาก {date_info['calendar_days_in_window']} วัน | "
        f"ขาด {date_info['missing_days_count']} วัน")
    chart, clean_stats = D.clean_chart_rows(window)
    log(f"[ข้อมูล] ทำความสะอาด: {clean_stats['rows_in_window']:,} -> {clean_stats['rows_after_cleaning']:,} แถว "
        f"(ไม่มี track_id {clean_stats['dropped_no_track_id']}, ซ้ำ {clean_stats['dropped_exact_duplicates']}, "
        f"อันดับขัดแย้ง {clean_stats['rank_conflict_groups']} กลุ่ม)")

    # ---------------- 3) คุณลักษณะ + ข้อมูลเสียง ----------------
    songs = build_song_features(chart)
    audio, audio_info = D.load_audio_features(songs_path)
    songs, audio_stats = D.join_audio(songs, audio, audio_info)
    log(f"[ข้อมูล] เพลงทั้งหมด {len(songs):,} เพลง | จับคู่ข้อมูลเสียงได้ {audio_stats['matched']:,} "
        f"เพลง ({audio_stats['matched_pct']}%)")

    # ---------------- 4) K-Means ----------------
    res = run_kmeans(songs, cfg.k_min, cfg.k_max, log)
    songs["cluster"] = relabel_by_size(res.labels)
    songs["cluster_name"] = songs["cluster"].map(name_clusters(songs))
    for c, z in zip(Z_COLS, res.X_scaled.T):
        songs[c] = z
    songs["pca_x"], songs["pca_y"] = res.pca_xy[:, 0], res.pca_xy[:, 1]
    profiles = cluster_profiles(songs)
    aud_prof = audio_profiles(songs)
    best_sil = float(res.k_scores.loc[res.k_scores["k"] == res.best_k, "silhouette"].iloc[0])
    log(f"[model] เลือก k={res.best_k} (Silhouette={best_sil:.4f})")

    # ---------------- 4b) เปรียบเทียบโมเดลอื่นบนคุณลักษณะชุดเดียวกัน ----------------
    cmp = compare_models(songs, res, cfg.k_min, cfg.k_max, log)

    # ---------------- 5) ประเมินผลการแนะนำ ----------------
    window_end = pd.Timestamp(date_info["actual_last_date"])
    per_seed, recs, eval_summary, seeds = evaluate_recommendations(
        songs, chart, window_end, cfg.n_eval_seeds, cfg.top_n)
    log(f"[eval] trajectory MAD แนะนำ={eval_summary['mean_rec_trajectory_mad']} vs "
        f"สุ่ม={eval_summary['mean_random_trajectory_mad']} (เชิงสำรวจ)")

    # ---------------- 6) ส่งออก ----------------
    sfx = " [ข้อมูลจำลอง]" if synthetic else ""
    export = songs.copy()
    for c in ["first_date", "peak_date", "last_date"]:
        export[c] = export[c].dt.strftime("%Y-%m-%d")
    export.to_csv(out_dir / "song_clusters.csv", index=False, encoding="utf-8-sig")
    ks = res.k_scores.copy()
    ks["cluster_sizes"] = ks["cluster_sizes"].map(lambda x: " ".join(map(str, x)))
    ks.to_csv(out_dir / "k_scores.csv", index=False, encoding="utf-8-sig")
    profiles.to_csv(out_dir / "cluster_profiles.csv", index=False, encoding="utf-8-sig")
    aud_prof.to_csv(out_dir / "audio_cluster_profiles.csv", index=False, encoding="utf-8-sig")
    per_seed.to_csv(out_dir / "recommendation_eval.csv", index=False, encoding="utf-8-sig")
    recs.to_csv(out_dir / "recommendations_for_seeds.csv", index=False, encoding="utf-8-sig")
    audio_stats_out = {k: v for k, v in audio_stats.items()}
    _write_json(audio_stats_out, out_dir / "audio_match_stats.json")
    _write_json({"date_window": date_info, "cleaning": clean_stats}, out_dir / "data_quality.json")
    _write_json(eval_summary, out_dir / "recommendation_eval_summary.json")
    pd.DataFrame([{"model": m["key"], "name": m["name"], "best_k": m["best_k"], **m["metrics"]}
                  for m in cmp["models"]]).to_csv(out_dir / "model_comparison.csv", index=False,
                                                  encoding="utf-8-sig")
    _write_json(cmp["agreement"], out_dir / "model_agreement.json")

    if cfg.make_plots:
        from . import plots
        plots.plot_k_scores(res.k_scores, res.best_k, out_dir / "k_silhouette.png")
        plots.plot_pca(songs, res.pca.explained_variance_ratio_, out_dir / "pca_clusters.png", sfx)
        plots.plot_rank_histories(chart, songs, seeds, recs, out_dir / "rank_history_samples.png", sfx)
        plots.plot_audio_profiles(aud_prof, out_dir / "audio_by_cluster.png", sfx)

    summary = {
        "data_source": source,
        "warning": SYNTH_WARNING if synthetic else None,
        "notices": notices,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "charts_file": str(charts_path),
        "songs_file": str(songs_path),
        "region": cfg.region, "chart": cfg.chart,
        "date_window": {k: v for k, v in date_info.items() if k != "missing_days"},
        "n_songs": int(len(songs)),
        "audio_matched": audio_stats["matched"], "audio_matched_pct": audio_stats["matched_pct"],
        "best_k": res.best_k, "best_silhouette": round(best_sil, 4),
        "pca_explained_variance": [round(float(v), 4) for v in res.pca.explained_variance_ratio_],
        "evaluation": eval_summary,
        "models": [{"model": m["key"], "best_k": m["best_k"], **m["metrics"]} for m in cmp["models"]],
        "output_dir": str(out_dir),
    }
    _write_json(summary, out_dir / "run_summary.json")
    dashboard = build_dashboard(songs, chart, res, profiles, aud_prof, per_seed, recs, eval_summary,
                                summary, date_info, clean_stats, audio_stats, cmp)
    _write_json(dashboard, out_dir / "dashboard.json")
    # ส่งต่อให้หน้าเว็บที่ build แล้ว (เฉพาะเมื่อใช้โฟลเดอร์ผลลัพธ์มาตรฐาน)
    dist_data = PROJECT_ROOT / "frontend" / "dist" / "data"
    if cfg.output_dir is None and dist_data.parent.exists():
        dist_data.mkdir(exist_ok=True)
        shutil.copyfile(out_dir / "dashboard.json", dist_data / f"{source}.json")
    log(f"[done] บันทึกผลทั้งหมดที่ {out_dir}")
    return {"summary": summary, "songs": songs, "chart": chart, "k_scores": res.k_scores,
            "profiles": profiles, "audio_profiles": aud_prof, "eval": per_seed, "recs": recs,
            "eval_summary": eval_summary, "date_info": date_info, "clean_stats": clean_stats,
            "audio_stats": audio_stats, "out_dir": out_dir, "cluster_result": res,
            "model_comparison": cmp}


def build_dashboard(songs, chart, res, profiles, aud_prof, per_seed, recs, eval_summary,
                    summary, date_info, clean_stats, audio_stats, cmp=None) -> dict:
    """ข้อมูลสำหรับหน้าเว็บ React (โหลดจาก outputs/<source>/dashboard.json)"""
    start = pd.Timestamp(date_info["actual_first_date"])
    hist = {tid: g.sort_values("date") for tid, g in chart.groupby("track_id")}
    song_rows = []
    for r in songs.itertuples():
        g = hist[r.track_id]
        row = {
            "id": r.track_id, "t": str(r.title), "a": str(r.artist), "c": int(r.cluster),
            "br": int(r.best_rank), "mr": float(r.median_rank), "d": int(r.days_on_chart),
            "dp": int(r.days_to_peak), "fd": r.first_date.strftime("%Y-%m-%d"),
            "pd": r.peak_date.strftime("%Y-%m-%d"),
            "z": [round(float(getattr(r, c)), 5) for c in Z_COLS],
            "x": round(float(r.pca_x), 4), "y": round(float(r.pca_y), 4),
            "hd": (g["date"] - start).dt.days.astype(int).tolist(), "hr": g["rank"].astype(int).tolist(),
        }
        if r.audio_matched:
            row["au"] = {f: round(float(getattr(r, f)), 4) for f in AUDIO_FEATURES}
        song_rows.append(row)
    ks = res.k_scores.replace({np.nan: None}).to_dict("records")
    return {
        "meta": summary,
        "features": CHART_FEATURES,
        "window_start": str(start.date()),
        "data_quality": {"date_window": date_info, "cleaning": clean_stats},
        "audio_stats": audio_stats,
        "k_scores": ks,
        "best_k": res.best_k,
        "clusters": profiles.replace({np.nan: None}).to_dict("records"),
        "audio_profiles": aud_prof.replace({np.nan: None}).to_dict("records"),
        "evaluation": {"summary": eval_summary,
                       "per_seed": per_seed.replace({np.nan: None}).to_dict("records")},
        "songs": song_rows,
        # ป้ายกลุ่มของแต่ละโมเดลเรียงตามลำดับ songs (labels[i] คือกลุ่มของ songs[i])
        "default_model": "kmeans",
        "models": models_for_dashboard(cmp) if cmp else [],
        "model_agreement": cmp["agreement"] if cmp else [],
    }
