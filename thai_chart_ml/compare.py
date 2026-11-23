"""เปรียบเทียบโมเดลจัดกลุ่มหลายแบบบนคุณลักษณะชาร์ตชุดเดียวกัน (ที่ปรับสเกลแล้ว)

- kmeans          K-Means (ตัวหลักของโปรเจกต์ ใช้ผลจาก run_kmeans ตรงๆ)
- agglomerative   Hierarchical / Agglomerative Clustering แบบ Ward linkage
- gmm             Gaussian Mixture Model (covariance แบบ full) ให้ความน่าจะเป็นของการเป็นสมาชิก

ทุกโมเดลทดลอง k ช่วงเดียวกันและเลือก k ด้วย Silhouette สูงสุดเหมือนกัน เพื่อให้เทียบกันได้ยุติธรรม
ตัวชี้วัดเพิ่มเติม: Davies-Bouldin (ต่ำ = ดี), Calinski-Harabasz (สูง = ดี)
และ Adjusted Rand Index (ARI) ระหว่างคู่โมเดล บอกว่าสองโมเดลแบ่งกลุ่มตรงกันแค่ไหน
"""
from __future__ import annotations

import time
from itertools import combinations

import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.metrics import (adjusted_rand_score, calinski_harabasz_score, davies_bouldin_score,
                             silhouette_score)
from sklearn.mixture import GaussianMixture

from .config import RANDOM_STATE
from .model import ClusterResult, audio_profiles, cluster_profiles, name_clusters, relabel_by_size, valid_k_values

MODEL_SPECS = {
    "kmeans": {"name": "K-Means",
               "make": lambda k: KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)},
    "agglomerative": {"name": "Hierarchical (Ward)",
                      "make": lambda k: AgglomerativeClustering(n_clusters=k, linkage="ward")},
    "gmm": {"name": "Gaussian Mixture",
            "make": lambda k: GaussianMixture(n_components=k, covariance_type="full",
                                              random_state=RANDOM_STATE, n_init=3)},
}


def _metrics(Xs: np.ndarray, lab: np.ndarray) -> dict:
    return {"silhouette": round(float(silhouette_score(Xs, lab)), 4),
            "davies_bouldin": round(float(davies_bouldin_score(Xs, lab)), 4),
            "calinski_harabasz": round(float(calinski_harabasz_score(Xs, lab)), 2)}


def sweep_model(key: str, Xs: np.ndarray, k_min: int, k_max: int, log=print) -> dict | None:
    """ทดลอง k ทุกค่าที่ถูกต้อง เลือก k ที่ Silhouette สูงสุด (เท่ากันเลือก k น้อยกว่า)"""
    spec = MODEL_SPECS[key]
    n = len(Xs)
    n_unique = len(np.unique(np.round(Xs, 10), axis=0))
    ks, skipped = valid_k_values(n, n_unique, k_min, k_max)
    rows, fitted = [], {}
    t0 = time.perf_counter()
    for k in ks:
        est = spec["make"](k)
        lab = est.fit_predict(Xs)
        if len(np.unique(lab)) < 2:
            skipped.append({"k": k, "reason": f"{spec['name']} ได้กลุ่มน้อยกว่า 2 กลุ่ม"})
            continue
        m = _metrics(Xs, lab)
        sizes = sorted(np.bincount(lab).tolist(), reverse=True)
        sizes = [s for s in sizes if s > 0]
        rows.append({"k": k, **m, "cluster_sizes": sizes, "status": "tested"})
        fitted[k] = (est, lab)
    for s in skipped:
        rows.append({"k": s["k"], "silhouette": None, "davies_bouldin": None, "calinski_harabasz": None,
                     "cluster_sizes": [], "status": "skipped: " + s["reason"]})
    if not fitted:
        log(f"[compare] {spec['name']}: ไม่มีค่า k ที่ใช้ได้ — ข้าม")
        return None
    rows.sort(key=lambda r: r["k"])
    tested = [r for r in rows if r["status"] == "tested"]
    best = sorted(tested, key=lambda r: (-r["silhouette"], r["k"]))[0]
    est, lab = fitted[best["k"]]
    conf = None
    if hasattr(est, "predict_proba"):
        conf = est.predict_proba(Xs).max(axis=1)
    log(f"[compare] {spec['name']}: เลือก k={best['k']} silhouette={best['silhouette']:.4f}")
    return {"key": key, "name": spec["name"], "k_scores": rows, "best_k": int(best["k"]),
            "labels": lab, "confidence": conf,
            "metrics": {m: best[m] for m in ("silhouette", "davies_bouldin", "calinski_harabasz")},
            "fit_seconds": round(time.perf_counter() - t0, 3)}


def compare_models(songs: pd.DataFrame, kmeans_res: ClusterResult, k_min: int, k_max: int,
                   log=print) -> dict:
    """คืนผลของทุกโมเดล (ป้ายกลุ่มเรียงตามขนาด, โปรไฟล์กลุ่ม) และ ARI ระหว่างคู่โมเดล

    songs ต้องเรียงแถวตรงกับ kmeans_res.X_scaled และมีคอลัมน์ audio_matched
    """
    Xs = kmeans_res.X_scaled
    out = []
    for key in MODEL_SPECS:
        res = sweep_model(key, Xs, k_min, k_max, log)
        if res is None:
            continue
        if key == "kmeans":
            # ให้ตรงกับคอลัมน์ cluster หลักที่มาจาก run_kmeans เสมอ (พารามิเตอร์เดียวกัน ผลควรเท่ากันอยู่แล้ว)
            res["best_k"], res["labels"] = int(kmeans_res.best_k), kmeans_res.labels
            res["metrics"] = _metrics(Xs, kmeans_res.labels)
        lab = relabel_by_size(res["labels"])
        tmp = songs.copy()
        tmp["cluster"] = lab
        tmp["cluster_name"] = tmp["cluster"].map(name_clusters(tmp))
        res["labels"] = lab
        res["clusters"] = cluster_profiles(tmp)
        res["audio_profiles"] = audio_profiles(tmp)
        out.append(res)

    agreement = [{"a": a["key"], "b": b["key"],
                  "ari": round(float(adjusted_rand_score(a["labels"], b["labels"])), 4)}
                 for a, b in combinations(out, 2)]
    for p in agreement:
        log(f"[compare] ARI {p['a']} vs {p['b']} = {p['ari']:.4f}")
    return {"models": out, "agreement": agreement}


def models_for_dashboard(cmp: dict) -> list[dict]:
    rows = []
    for m in cmp["models"]:
        rows.append({
            "key": m["key"], "name": m["name"], "best_k": m["best_k"], "metrics": m["metrics"],
            "fit_seconds": m["fit_seconds"], "k_scores": m["k_scores"],
            "labels": [int(x) for x in m["labels"]],
            "confidence": None if m["confidence"] is None else [round(float(x), 4) for x in m["confidence"]],
            "clusters": m["clusters"].replace({np.nan: None}).to_dict("records"),
            "audio_profiles": m["audio_profiles"].replace({np.nan: None}).to_dict("records"),
        })
    return rows
