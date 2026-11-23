# Thailand Spotify Chart Analysis

โปรเจกต์วิเคราะห์และจัดกลุ่มเพลงบนชาร์ต Spotify ประเทศไทยด้วย Machine Learning

## โครงสร้าง

- `thai_chart_ml/` - โค้ด Python และ pipeline
- `frontend/` - หน้าเว็บ React/Vite
- `notebooks/` - Notebook วิเคราะห์
- `outputs/synthetic/` - ผลลัพธ์ข้อมูลจำลอง
- `frontend/dist/` - หน้าเว็บที่ build แล้ว
- `requirements.txt` - ไลบรารี Python

## รันโปรเจกต์

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m thai_chart_ml run --synthetic
python -m thai_chart_ml serve
```

## หน้าเว็บ

```powershell
cd frontend
npm install
npm run dev
npm run build
```

ไฟล์ผลลัพธ์สำหรับหน้าเว็บอยู่ที่ `frontend/dist/data/synthetic.json`

## Deploy บน Render

โปรเจกต์มี `render.yaml` สำหรับสร้าง Web Service แล้วใช้ `python -m thai_chart_ml serve --no-browser`
เป็น start command โปรแกรมจะอ่านพอร์ตจากตัวแปร `PORT` และ bind ที่ `0.0.0.0` โดยอัตโนมัติ
