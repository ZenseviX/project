# การวิเคราะห์และจัดกลุ่มรูปแบบความนิยมของเพลงบนชาร์ต Spotify ประเทศไทยด้วย Machine Learning

**Thailand Spotify Chart Analysis Using Machine Learning**

โปรเจกต์นี้จัดกลุ่มเพลงบนชาร์ต Spotify Top 200 รายวันของประเทศไทยตามรูปแบบการติดชาร์ต เช่น ขึ้นอันดับสูงเร็ว ติดชาร์ตนาน หรือขึ้นสูงแค่ช่วงสั้น ผู้ใช้เลือกเพลงหนึ่งเพลงเพื่อดู 5 เพลงที่มีรูปแบบการติดชาร์ตใกล้เคียงกันได้ หน่วยวิเคราะห์คือเพลง 1 รายการต่อ Spotify Track ID ซึ่งมีทั้งเพลงไทยและเพลงต่างประเทศที่ติดชาร์ตไทย

- เทรนบน CPU ได้ ไม่ต้องใช้ GPU, Spotify API หรือบริการ Cloud
- ใช้ Python, pandas, scikit-learn, Matplotlib และ Jupyter
- มีหน้าเว็บ React (Vite) สำหรับนำเสนอและค้นหาเพลง

---

## 1. โครงสร้างโปรเจกต์

```
thailand-spotify-chart-ml/
├─ thai_chart_ml/            โค้ด Python (ใช้ร่วมกันทั้ง CLI และ Notebook)
│  ├─ data.py                ตรวจคอลัมน์, กรองไทยแบบ chunksize, ช่วงวัน, track_id, ลบซ้ำ, join ข้อมูลเสียง
│  ├─ features.py            สรุปหนึ่งแถวต่อเพลง
│  ├─ model.py               StandardScaler + K-Means (k=2–8) + Silhouette + PCA + ตั้งชื่อกลุ่ม
│  ├─ compare.py             เปรียบเทียบ K-Means / Hierarchical (Ward) / Gaussian Mixture + ARI
│  ├─ recommend.py           ค้นชื่อเพลง / Cosine Similarity Top 5
│  ├─ evaluate.py            ประเมินเทียบการสุ่ม (เชิงสำรวจ)
│  ├─ plots.py               กราฟ PNG
│  ├─ pipeline.py            run_pipeline() เส้นทางหลักทั้งหมด
│  ├─ synthetic.py           ข้อมูลจำลองสำหรับทดสอบ
│  └─ cli.py                 คำสั่ง run / inspect / search / serve
├─ notebooks/Thailand_Spotify_Chart_Analysis.ipynb   Notebook นำเสนอ (เรียก run_pipeline ตัวเดียวกัน)
├─ frontend/                 หน้าเว็บ React (src/) และไฟล์ที่ build แล้ว (dist/)
├─ tests/test_pipeline.py    ทดสอบด้วย pytest
├─ data/raw/                 << วาง charts.csv และ spotify_songs.csv ที่นี่
├─ data/processed/           ไฟล์ชาร์ตไทยที่กรองแล้ว (สร้างอัตโนมัติ ใช้ซ้ำได้)
├─ data/synthetic/           ข้อมูลจำลอง (สร้างอัตโนมัติ)
├─ outputs/real/             ผลจากข้อมูลจริง
├─ outputs/synthetic/        ผลจากข้อมูลจำลอง (ไม่ใช่ผลชาร์ตไทย)
├─ report.md                 รายงานส่งอาจารย์
└─ requirements.txt
```

## 2. ดาวน์โหลดและวางไฟล์ CSV

| ไฟล์ | แหล่ง | วางไว้ที่ |
|---|---|---|
| `charts.csv` (ประมาณ 3.4 GB หลังแตกไฟล์) | https://www.kaggle.com/datasets/dhruvildave/spotify-charts (ต้องล็อกอิน Kaggle แล้วกด Download จะได้ไฟล์ zip) | `data\raw\charts.csv` |
| `spotify_songs.csv` | https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2020/2020-01-21/spotify_songs.csv | `data\raw\spotify_songs.csv` |

ดาวน์โหลด `spotify_songs.csv` ผ่าน PowerShell (รันในโฟลเดอร์โปรเจกต์):

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2020/2020-01-21/spotify_songs.csv" -OutFile "data\raw\spotify_songs.csv"
```

แตกไฟล์ zip จาก Kaggle (สมมติว่าดาวน์โหลดไว้ที่ Downloads):

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\archive.zip" -DestinationPath "data\raw" -Force
Get-ChildItem data\raw
```

> ถ้าไม่มี `charts.csv` โปรแกรมจะแจ้งตำแหน่งวางไฟล์กับลิงก์ดาวน์โหลด แล้วรันต่อด้วย **ข้อมูลจำลอง** ผลจะอยู่ใน `outputs\synthetic\` และมีคำเตือนกำกับทุกจุด
> ถ้ามี `charts.csv` แต่ไม่มี `spotify_songs.csv` จะรันต่อโดยไม่มีข้อมูลเสียง และไม่เติมค่าใดแทน

## 3. ติดตั้ง (Windows PowerShell)

ต้องมี Python 3.10 ขึ้นไป (ทดสอบกับ 3.15)

```powershell
cd "$env:USERPROFILE\Desktop\thailand-spotify-chart-ml"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

ถ้า PowerShell ไม่ยอมให้รัน `Activate.ps1` ให้รันคำสั่งนี้ก่อน หรือเรียก `.\.venv\Scripts\python.exe` ตรงๆ แทน:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 4. ตรวจไฟล์ก่อนเทรน

```powershell
python -m thai_chart_ml inspect                 # ดูคอลัมน์ ตัวอย่างวันที่ ค่า region/chart จากส่วนต้นไฟล์
python -m thai_chart_ml inspect --filter        # กรองทั้งไฟล์ บันทึกไฟล์ไทยไว้ใช้ซ้ำ และรายงานช่วงวัน/วันที่ขาด
```

ถ้ากรองแล้วไม่พบข้อมูล โปรแกรมจะแสดงชื่อคอลัมน์และค่า `region` / `chart` ที่พบจริง ให้แก้ด้วย `--region` และ `--chart` เช่น `--region "Thailand" --chart "top200"`

## 5. เทรนบน CPU (คำสั่งเดียว ตั้งแต่ CSV ถึงผลลัพธ์)

```powershell
python -m thai_chart_ml run
```

- ค่าเริ่มต้นจะใช้ช่วงย้อนหลังไม่เกิน 12 เดือนจากวันล่าสุดที่พบในชาร์ตไทย
- กำหนดช่วงวันเอง: `python -m thai_chart_ml run --start 2021-01-01 --end 2021-12-31`
- ครั้งแรกจะอ่าน `charts.csv` ทีละ 500,000 แถว (ปรับได้ด้วย `--chunksize`) ซึ่งอาจใช้เวลาหลายนาที ครั้งถัดไปจะใช้ `data\processed\thailand_top200_filtered.csv` เลย (ถ้าต้องการกรองใหม่ให้ใส่ `--refresh-cache`)
- ดูตัวเลือกทั้งหมดได้ด้วย `python -m thai_chart_ml run --help`
- ทดสอบด้วยข้อมูลจำลอง: `python -m thai_chart_ml run --synthetic`

### ไฟล์ผลลัพธ์ (`outputs\real\`)

| ไฟล์ | เนื้อหา |
|---|---|
| `song_clusters.csv` | ตารางเพลงพร้อมกลุ่ม คุณลักษณะชาร์ต ค่าที่ปรับสเกลแล้ว (z_*) พิกัด PCA และข้อมูลเสียง (เว้นว่างถ้าจับคู่ไม่ได้) |
| `k_scores.csv` | Silhouette Score, inertia และขนาดกลุ่มของแต่ละ k รวมถึง k ที่ข้ามพร้อมเหตุผล |
| `cluster_profiles.csv` | จำนวนเพลง และค่ามัธยฐาน/ค่าเฉลี่ยของคุณลักษณะในแต่ละกลุ่ม |
| `audio_match_stats.json` | จำนวนและร้อยละของเพลงที่จับคู่ข้อมูลเสียงได้ |
| `audio_cluster_profiles.csv` | ค่าเฉลี่ยข้อมูลเสียงต่อกลุ่ม คิดเฉพาะเพลงที่จับคู่ได้ พร้อม n |
| `data_quality.json` | ช่วงวันจริง วันที่ข้อมูลขาด และสถิติแถวที่ตัดออก |
| `recommendation_eval.csv`, `recommendation_eval_summary.json` | ผลประเมินเทียบการสุ่ม (เชิงสำรวจ) |
| `recommendations_for_seeds.csv` | Top 5 ของเพลงตั้งต้น 10 เพลง |
| `k_silhouette.png`, `pca_clusters.png`, `rank_history_samples.png`, `audio_by_cluster.png` | กราฟ |
| `dashboard.json`, `run_summary.json` | ข้อมูลสำหรับหน้าเว็บและสรุปการรัน |

## 6. ค้นหาเพลงที่คล้ายกัน

```powershell
python -m thai_chart_ml search "ชื่อเพลง"
python -m thai_chart_ml search "ชื่อเพลง" --track-id <TRACK_ID>   # ใช้เมื่อชื่อซ้ำ (คัดลอก ID จากรายการที่โปรแกรมแสดง)
python -m thai_chart_ml search "Synthetic Duplicate" --source synthetic         # ลองกับข้อมูลจำลอง
```

ค้นด้วยชื่อเพลงบางส่วนได้และไม่สนตัวพิมพ์เล็กใหญ่ ถ้ามีหลายเพลงตรงกัน โปรแกรมจะแสดง Track ID ให้เลือก

## 7. หน้าเว็บ React

> คู่มือหน้าเว็บฉบับเต็ม (ทุกหน้า ทุกปุ่ม การอัปโหลดไฟล์ API และการแก้ไข) อยู่ที่ [`frontend/README.md`](frontend/README.md)

หน้าเว็บที่ build แล้วอยู่ใน `frontend\dist` เปิดดูได้โดยไม่ต้องติดตั้ง Node.js:

```powershell
python -m thai_chart_ml serve          # เปิด http://127.0.0.1:8000/ ในเบราว์เซอร์
python -m thai_chart_ml serve --port 8010   # ถ้าพอร์ต 8000 มีโปรแกรมอื่นใช้อยู่
```

หน้าเว็บมีแถบเมนูด้านซ้าย 5 หน้า (ลิงก์ตรงได้ เช่น `#climbers`, `#models`) และแถบด้านขวาแสดงโมเดลที่ใช้อยู่ เพลงที่ไต่แรงสุด และเพลงตั้งต้น:
- **ภาพรวม** — KPI, Silhouette ของแต่ละ k, การ์ดโปรไฟล์กลุ่ม และแผนที่ PCA (คลิกจุดเพื่อเลือกเพลงตั้งต้น)
- **ไต่อันดับ (Chart Climbers)** — เทียบอันดับ ณ วันที่เลือกกับ 1 / 7 / 30 วันก่อน แยกเป็นไต่ขึ้น เข้าใหม่ ร่วงลง
  พร้อมเส้นอันดับของ 5 เพลงแรก และการเปลี่ยนอันดับเฉลี่ยของแต่ละกลุ่ม (คำนวณจากประวัติอันดับจริง ไม่ใช่การทำนาย)
- **โมเดล** — เปรียบเทียบ K-Means, Hierarchical (Ward) และ Gaussian Mixture: หลักการทำงาน จุดเด่น/ข้อจำกัด
  ตารางตัวชี้วัด (Silhouette, Davies–Bouldin, Calinski–Harabasz), Silhouette ต่อ k, ความสอดคล้อง (ARI) และ PCA แยกตามโมเดล
- **เพลงคล้าย** — ค้นหาเพลง (บอกเมื่อชื่อซ้ำ) Top 5 ด้วย Cosine Similarity เลือกให้แนะนำเฉพาะกลุ่มเดียวกันได้ และตารางประเมินเทียบการสุ่ม
- **ข้อมูล** — ลากไฟล์มาวางเพื่ออัปโหลด `charts.csv` / `spotify_songs.csv` (หรือ `archive.zip` จาก Kaggle ซึ่งจะแตกไฟล์ให้) ลง `data\raw\` แล้วกด **วิเคราะห์ใหม่** ได้จากหน้าเว็บ หรือวาง `dashboard.json` เพื่อเปิดผลลัพธ์โดยตรง (อัปโหลด csv ต้องเปิดผ่าน `serve`) พร้อมตารางคุณภาพข้อมูล
- ตัวเลือก **โมเดล** มุมขวาบนเปลี่ยนการจัดกลุ่มของทุกหน้า (ทุกโมเดลฝึกใน `thai_chart_ml/compare.py` ระหว่าง `run`
  และบันทึกลง `dashboard.json`, `model_comparison.csv`, `model_agreement.json`)
- สลับธีมมืด/สว่างได้ · ถ้ามีผลจากข้อมูลจริงจะแสดงผลนั้นก่อน มิฉะนั้นใช้ข้อมูลจำลอง (ระบุไว้ที่ท้ายหน้า)

แก้ไขหน้าเว็บ (ต้องมี Node.js 18 ขึ้นไป):

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173 อ่าน outputs\*\dashboard.json โดยตรง
npm run build    # สร้าง frontend\dist ใหม่
```

## 8. Notebook

```powershell
jupyter notebook notebooks\Thailand_Spotify_Chart_Analysis.ipynb
```

หรือเปิดใน VS Code แล้วเลือก kernel `.venv` จากนั้นกด Run All ทุกเซลล์ Notebook เรียก `run_pipeline()` ตัวเดียวกับ `python -m thai_chart_ml run` จึงได้ผลเหมือนกัน รันทั้งไฟล์แบบไม่เปิดหน้าต่างได้ด้วยคำสั่งนี้:

```powershell
cd notebooks
jupyter nbconvert --to notebook --execute --inplace Thailand_Spotify_Chart_Analysis.ipynb
cd ..
```

## 9. ทดสอบโค้ด

```powershell
python -m pytest -q
```

ครอบคลุมการดึง track_id, การแจ้งคอลัมน์หรือค่าที่หาไม่พบ, การกรองแบบ chunk และ cache, การลบรายการซ้ำและอันดับขัดแย้ง, ช่วงวันกับวันที่ขาด, days_to_peak เมื่ออันดับดีที่สุดเกิดหลายวัน, left join ที่ไม่เติมค่า, ไฟล์เสียงที่ไม่มีอยู่, ข้อมูลน้อยเกินกว่าจะทดสอบ k บางค่า, เส้นทางหลักทั้งหมด, ชื่อเพลงซ้ำ และการสลับไปใช้ข้อมูลจำลอง

## 10. วิธีอ่านผล

- **Silhouette Score** อยู่ในช่วง −1 ถึง 1 ค่ายิ่งสูงยิ่งแปลว่ากลุ่มแยกจากกันชัด ระบบเลือก k ที่ได้ค่าสูงสุด (ถ้าเท่ากันเลือก k ที่น้อยกว่า) ควรดูขนาดกลุ่มประกอบด้วย กลุ่มที่เล็กมากอาจเป็นเพลงผิดปกติเพียงไม่กี่เพลง
- **ชื่อกลุ่ม** ได้จากกฎที่เทียบค่ามัธยฐานของกลุ่มกับควอนไทล์ของเพลงทั้งหมด (อันดับสูงสุด / ความยาวการติดชาร์ต / ความเร็วถึงจุดสูงสุด) ใช้ช่วยอ่าน ไม่ได้เป็นป้ายที่โมเดลเรียนรู้มา
- **อันดับ** เลขน้อยแปลว่าดี (อันดับ 1 คืออันดับสูงสุด)
- **PCA** ใช้แสดงผลอย่างเดียว ไม่ได้ใช้ในการเทรน
- **Cosine Similarity** ใกล้ 1 แปลว่าทิศทางของเวกเตอร์คุณลักษณะ (หลังปรับสเกล) คล้ายกัน ค่านี้ไม่ได้วัดความใกล้ของขนาด เพลงที่แนะนำจึงอาจอยู่คนละกลุ่ม K-Means ได้
- **trajectory_mad** คือผลต่างอันดับรายวันเฉลี่ยใน 90 วันแรกหลังพบครั้งแรก (วันที่หลุดชาร์ตนับเป็นอันดับ 201) ค่าต่ำกว่าแปลว่าเส้นอันดับคล้ายกันมากกว่า ใช้เทียบเพลงที่แนะนำกับเพลงที่สุ่มมา ผลนี้เป็น **การตรวจเชิงสำรวจ** เพราะยังไม่มีคะแนนจากผู้ประเมิน
- **ข้อมูลเสียง** คำนวณเฉพาะเพลงที่จับคู่ได้ ให้ดูค่า n ของแต่ละกลุ่มก่อนสรุปผล
