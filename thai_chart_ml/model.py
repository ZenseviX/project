"""K-Means บนคุณลักษณะชาร์ต: ทดลอง k, เลือก k ด้วย Silhouette, PCA และตั้งชื่อกลุ่ม"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from .config import AUDIO_FEATURES, CHART_FEATURES, RANDOM_STATE


class ModelError(RuntimeError):
    pass


@dataclass
class ClusterResult:
    scaler: StandardScaler
    X_scaled: np.ndarray
    k_scores: pd.DataFrame
    best_k: int
    labels: np.ndarray
    model: KMeans
    pca: PCA
    pca_xy: np.ndarray


def valid_k_values(n_samples: int, n_unique: int, k_min: int = 2, k_max: int = 8) -> tuple[list[int], list[dict]]:
    """Silhouette ต้องการ 2 <= k <= n_samples-1 และ k ไม่เกินจำนวนจุดที่ไม่ซ้ำกัน"""
    ks, skipped = [], []
    for k in range(max(2, k_min), k_max + 1):
        if k > n_samples - 1:
            skipped.append({"k": k, "reason": f"ข้อมูลมี {n_samples} เพลง ต้องมีอย่างน้อย {k + 1} เพลง"})
        elif k > n_unique:
            skipped.append({"k": k, "reason": f"มีจุดข้อมูลที่ไม่ซ้ำกันเพียง {n_unique} จุด"})
        else:
            ks.append(k)
    return ks, skipped


def run_kmeans(features: pd.DataFrame, k_min: int = 2, k_max: int = 8, log=print) -> ClusterResult:
    X = features[CHART_FEATURES].to_numpy(dtype=float)
    n = len(X)
    if n < 3:
        raise ModelError(f"มีเพลงเพียง {n} เพลง ต้องมีอย่างน้อย 3 เพลงจึงจะคำนวณ Silhouette ได้")
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    n_unique = len(np.unique(np.round(Xs, 10), axis=0))
    ks, skipped = valid_k_values(n, n_unique, k_min, k_max)
    if not ks:
        raise ModelError("ไม่มีค่า k ที่ทดสอบได้: " + "; ".join(f"k={s['k']}: {s['reason']}" for s in skipped))

    rows, models = [], {}
    for k in ks:
        km = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
        lab = km.fit_predict(Xs)
        if len(np.unique(lab)) < 2:
            skipped.append({"k": k, "reason": "K-Means ได้กลุ่มน้อยกว่า 2 กลุ่ม"})
            continue
        sil = float(silhouette_score(Xs, lab))
        sizes = sorted(np.bincount(lab, minlength=k).tolist(), reverse=True)
        rows.append({"k": k, "silhouette": round(sil, 4), "inertia": round(float(km.inertia_), 2),
                     "cluster_sizes": sizes, "min_cluster_size": min(sizes), "status": "tested"})
        models[k] = (km, lab)
        log(f"[model] k={k}: silhouette={sil:.4f} ขนาดกลุ่ม={sizes}")
    for s in skipped:
        log(f"[model] ข้าม k={s['k']}: {s['reason']}")
        rows.append({"k": s["k"], "silhouette": np.nan, "inertia": np.nan, "cluster_sizes": [],
                     "min_cluster_size": np.nan, "status": "skipped: " + s["reason"]})
    scores = pd.DataFrame(rows).sort_values("k").reset_index(drop=True)
    tested = scores[scores["status"] == "tested"]
    if tested.empty:
        raise ModelError("ไม่มีค่า k ใดที่คำนวณ Silhouette ได้")
    # Silhouette สูงสุด ถ้าเท่ากันเลือก k ที่น้อยกว่า
    best_k = int(tested.sort_values(["silhouette", "k"], ascending=[False, True]).iloc[0]["k"])
    km, lab = models[best_k]

    pca = PCA(n_components=2, random_state=RANDOM_STATE)
    xy = pca.fit_transform(Xs)
    return ClusterResult(scaler, Xs, scores, best_k, lab, km, pca, xy)


def relabel_by_size(labels: np.ndarray) -> np.ndarray:
    """เรียงหมายเลขกลุ่มให้กลุ่มใหญ่สุดเป็น 0 เพื่อให้อ่านง่ายและคงที่"""
    order = pd.Series(labels).value_counts().sort_index().sort_values(ascending=False, kind="stable").index
    remap = {old: new for new, old in enumerate(order)}
    return np.array([remap[x] for x in labels])


def name_clusters(songs: pd.DataFrame) -> dict[int, str]:
    """ตั้งชื่อกลุ่มแบบกฎ (heuristic) จากค่ามัธยฐานของกลุ่มเทียบกับควอนไทล์ของเพลงทั้งหมด

    - ระดับอันดับสูงสุด: best_rank เทียบควอนไทล์ 1/3 และ 2/3
    - ความยาวการติดชาร์ต: days_on_chart เทียบควอนไทล์ 1/3 และ 2/3
    - ความเร็ว: days_to_peak เทียบค่ามัธยฐานรวม
    ชื่อเป็นคำอธิบายช่วยอ่าน ไม่ใช่ป้ายกำกับที่โมเดลเรียนรู้
    """
    q_best = songs["best_rank"].quantile([1 / 3, 2 / 3]).to_numpy()
    q_days = songs["days_on_chart"].quantile([1 / 3, 2 / 3]).to_numpy()
    med_dp = songs["days_to_peak"].median()
    names = {}
    for c, grp in songs.groupby("cluster"):
        m = grp[CHART_FEATURES].median()
        peak = ("ขึ้นอันดับสูง" if m["best_rank"] <= q_best[0]
                else "อันดับสูงสุดระดับกลาง" if m["best_rank"] <= q_best[1] else "อันดับสูงสุดไม่สูง")
        dur = ("ติดชาร์ตนาน" if m["days_on_chart"] > q_days[1]
               else "ติดชาร์ตปานกลาง" if m["days_on_chart"] > q_days[0] else "ติดชาร์ตช่วงสั้น")
        speed = "ถึงจุดสูงสุดเร็ว" if m["days_to_peak"] <= med_dp else "ค่อยๆ ไต่ขึ้น"
        names[int(c)] = f"{peak} · {dur} · {speed}"
    counts = pd.Series(names).value_counts()
    return {c: (n if counts[n] == 1 else f"{n} (กลุ่ม {c})") for c, n in names.items()}


def cluster_profiles(songs: pd.DataFrame) -> pd.DataFrame:
    g = songs.groupby("cluster")
    prof = g[CHART_FEATURES].median().add_prefix("median_")
    prof = prof.join(g[CHART_FEATURES].mean().round(2).add_prefix("mean_"))
    prof.insert(0, "n_songs", g.size())
    prof.insert(0, "cluster_name", g["cluster_name"].first())
    prof["share_pct"] = (100 * prof["n_songs"] / len(songs)).round(2)
    return prof.reset_index()


def audio_profiles(songs: pd.DataFrame) -> pd.DataFrame:
    """เปรียบเทียบข้อมูลเสียงเฉพาะเพลงที่จับคู่ได้ พร้อมจำนวนตัวอย่างของแต่ละกลุ่ม"""
    rows = []
    for c, grp in songs.groupby("cluster"):
        m = grp[grp["audio_matched"]]
        row = {"cluster": int(c), "cluster_name": grp["cluster_name"].iloc[0],
               "n_songs": len(grp), "n_audio_matched": len(m),
               "matched_pct": round(100 * len(m) / len(grp), 2) if len(grp) else 0.0}
        for f in AUDIO_FEATURES:
            row[f"mean_{f}"] = round(float(m[f].mean()), 4) if len(m) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)
