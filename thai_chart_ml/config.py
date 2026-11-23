"""ค่าคงที่และตำแหน่งไฟล์ของโปรเจกต์"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
OUTPUT_DIR = PROJECT_ROOT / "outputs"

CHARTS_URL = "https://www.kaggle.com/datasets/dhruvildave/spotify-charts"
SONGS_URL = (
    "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/"
    "data/2020/2020-01-21/spotify_songs.csv"
)

RANDOM_STATE = 42
CHART_FEATURES = ["best_rank", "median_rank", "days_on_chart", "days_to_peak"]
AUDIO_FEATURES = ["danceability", "energy", "acousticness", "valence", "tempo"]

FEATURE_LABELS_TH = {
    "best_rank": "อันดับดีที่สุด",
    "median_rank": "อันดับมัธยฐาน",
    "days_on_chart": "จำนวนวันที่ติดชาร์ต",
    "days_to_peak": "วันจากเปิดตัวถึงอันดับสูงสุด",
}


@dataclass
class PipelineConfig:
    charts_path: Path = RAW_DIR / "charts.csv"
    songs_path: Path = RAW_DIR / "spotify_songs.csv"
    start_date: str | None = None
    end_date: str | None = None
    k_min: int = 2
    k_max: int = 8
    n_eval_seeds: int = 10
    top_n: int = 5
    chunksize: int = 500_000
    region: str = "Thailand"
    chart: str = "top200"
    force_synthetic: bool = False
    refresh_cache: bool = False
    output_dir: Path | None = None  # ถ้าไม่ระบุ จะใช้ outputs/real หรือ outputs/synthetic
    make_plots: bool = True
    log: list[str] = field(default_factory=list)
