"""กราฟ Matplotlib (บันทึกเป็น PNG)"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

plt.rcParams["font.family"] = ["Leelawadee UI", "Tahoma", "Noto Sans Thai", "DejaVu Sans"]
plt.rcParams["axes.spines.top"] = False
plt.rcParams["axes.spines.right"] = False

PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"]


def plot_k_scores(k_scores: pd.DataFrame, best_k: int, path: Path) -> None:
    t = k_scores[k_scores["status"] == "tested"]
    fig, ax = plt.subplots(figsize=(7, 4))
    colors = [PALETTE[0] if k == best_k else "#b7c4d6" for k in t["k"]]
    ax.bar(t["k"].astype(str), t["silhouette"], color=colors, width=0.6)
    for k, s in zip(t["k"], t["silhouette"]):
        ax.text(str(k), s, f"{s:.3f}", ha="center", va="bottom", fontsize=9)
    ax.set_xlabel("k")
    ax.set_ylabel("Silhouette Score")
    ax.set_title(f"Silhouette Score ของแต่ละ k (เลือก k={best_k})")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_pca(songs: pd.DataFrame, explained: np.ndarray, path: Path, title_suffix: str = "") -> None:
    fig, ax = plt.subplots(figsize=(8, 6))
    for c, grp in songs.groupby("cluster"):
        ax.scatter(grp["pca_x"], grp["pca_y"], s=22, alpha=0.75, color=PALETTE[c % 8],
                   marker=MARKERS[c % 8], edgecolors="white", linewidths=0.5,
                   label=f"กลุ่ม {c}: {grp['cluster_name'].iloc[0]} (n={len(grp)})")
    ax.set_xlabel(f"PC1 ({explained[0] * 100:.1f}%)")
    ax.set_ylabel(f"PC2 ({explained[1] * 100:.1f}%)")
    ax.set_title("PCA 2 มิติของคุณลักษณะชาร์ต" + title_suffix)
    ax.legend(fontsize=8, loc="best", frameon=False)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_rank_histories(chart: pd.DataFrame, songs: pd.DataFrame, seeds: list[str],
                        recs: pd.DataFrame, path: Path, title_suffix: str = "") -> None:
    """ประวัติอันดับของเพลงตั้งต้น (เส้นหนา) กับ 5 เพลงที่แนะนำ จัดแนวตามวันหลังพบครั้งแรก"""
    n = len(seeds)
    cols = 2
    rows = int(np.ceil(n / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(13, 3.1 * rows), squeeze=False)
    first = songs.set_index("track_id")["first_date"]
    title = songs.set_index("track_id")["title"]
    by_id = {tid: g for tid, g in chart.groupby("track_id")}

    def line(ax, tid, **kw):
        g = by_id[tid].sort_values("date")
        x = (g["date"] - first[tid]).dt.days
        ax.plot(x, g["rank"], **kw)

    for i, s in enumerate(seeds):
        ax = axes[i // cols][i % cols]
        for j, r in enumerate(recs[recs["seed_track_id"] == s].itertuples()):
            line(ax, r.track_id, color=PALETTE[(j + 1) % 8], lw=1.2, alpha=0.8,
                 label=f"{r.title[:22]} ({r.similarity:.2f})")
        line(ax, s, color="#111111", lw=2.4, label=f"ตั้งต้น: {title[s][:22]}")
        ax.set_ylim(205, 0)
        ax.set_xlabel("วันหลังพบครั้งแรก", fontsize=8)
        ax.set_ylabel("อันดับ", fontsize=8)
        ax.set_title(title[s][:40], fontsize=9)
        ax.tick_params(labelsize=7)
        ax.legend(fontsize=6, frameon=False, loc="lower right")
    for j in range(n, rows * cols):
        axes[j // cols][j % cols].axis("off")
    fig.suptitle("ประวัติอันดับ: เพลงตั้งต้นกับ 5 เพลงที่แนะนำ" + title_suffix, fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def plot_audio_profiles(audio_prof: pd.DataFrame, path: Path, title_suffix: str = "") -> None:
    feats = ["danceability", "energy", "acousticness", "valence"]
    data = audio_prof[audio_prof["n_audio_matched"] > 0]
    fig, ax = plt.subplots(figsize=(8, 4))
    if data.empty:
        ax.text(0.5, 0.5, "ไม่มีเพลงที่จับคู่ข้อมูลเสียงได้", ha="center", va="center")
        ax.axis("off")
    else:
        w = 0.8 / len(feats)
        x = np.arange(len(data))
        for i, f in enumerate(feats):
            ax.bar(x + i * w, data[f"mean_{f}"], width=w * 0.92, color=PALETTE[i], label=f)
        ax.set_xticks(x + 0.4 - w / 2)
        ax.set_xticklabels([f"กลุ่ม {c}\n(n={n})" for c, n in zip(data["cluster"], data["n_audio_matched"])], fontsize=8)
        ax.set_ylim(0, 1)
        ax.legend(fontsize=8, frameon=False, ncol=4)
        ax.set_title("ค่าเฉลี่ยคุณลักษณะเสียงเฉพาะเพลงที่จับคู่ได้" + title_suffix)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
