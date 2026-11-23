// คำอธิบายโมเดลจัดกลุ่มสำหรับหน้าเปรียบเทียบ (ต้องตรงกับ thai_chart_ml/compare.py)

export const MODEL_INFO = {
  kmeans: {
    short: "จัดเข้าจุดศูนย์กลางที่ใกล้ที่สุด",
    family: "Centroid-based",
    how: [
      "วางจุดศูนย์กลาง k จุด",
      "จัดเพลงเข้าจุดที่ใกล้ที่สุด",
      "ย้ายจุดไปที่ค่าเฉลี่ย วนซ้ำจนนิ่ง",
    ],
    shape: "ทรงกลม ขนาดใกล้กัน",
    assign: "Hard",
    pros: ["เร็ว", "อธิบายง่าย"],
    cons: ["ถนัดแค่กลุ่มทรงกลม", "ไวต่อ outlier"],
    params: "n_init=10, random_state=42",
  },
  agglomerative: {
    short: "รวมเพลงที่คล้ายกันทีละคู่",
    family: "Hierarchical",
    how: [
      "เริ่มให้ทุกเพลงเป็นกลุ่มเดี่ยว",
      "รวมคู่ที่เพิ่มความแปรปรวนน้อยสุด (Ward)",
      "ตัดต้นไม้ให้เหลือ k กลุ่ม",
    ],
    shape: "ตามโครงสร้างต้นไม้",
    assign: "Hard",
    pros: ["ไม่มีการสุ่ม", "ได้ลำดับชั้นของกลุ่ม"],
    cons: ["ช้าเมื่อเพลงเยอะ (O(n²))", "รวมแล้วย้อนกลับไม่ได้"],
    params: "linkage=\"ward\"",
  },
  gmm: {
    short: "ผสมการแจกแจงปกติหลายก้อน",
    family: "Probabilistic",
    how: [
      "สมมติแต่ละกลุ่มเป็นการแจกแจงปกติ",
      "E-step: คำนวณความน่าจะเป็นของสมาชิก",
      "M-step: ปรับค่าเฉลี่ย/ความแปรปรวน วนจนนิ่ง",
    ],
    shape: "วงรี ขนาดต่างกันได้",
    assign: "Soft (ความน่าจะเป็น)",
    pros: ["รองรับกลุ่มวงรี", "บอกความมั่นใจของสมาชิก"],
    cons: ["พารามิเตอร์เยอะ", "ช้ากว่า K-Means"],
    params: "covariance_type=\"full\", n_init=3",
  },
};

export const COMPARE_ROWS = [
  { label: "แนวคิด", get: (k) => MODEL_INFO[k].family },
  { label: "การจัดสมาชิก", get: (k) => MODEL_INFO[k].assign },
  { label: "รูปร่างกลุ่ม", get: (k) => MODEL_INFO[k].shape },
  { label: "การสุ่มเริ่มต้น", get: (k) => (k === "agglomerative" ? "ไม่มี" : "มี") },
  { label: "ต้นทุน", get: (k) => ({ kmeans: "ต่ำ", agglomerative: "สูง", gmm: "กลาง" })[k] },
  { label: "พารามิเตอร์", get: (k) => MODEL_INFO[k].params, mono: true },
];

export const METRIC_INFO = {
  silhouette: { label: "Silhouette", better: "high", desc: "เพลงใกล้กลุ่มตัวเองมากกว่ากลุ่มอื่นแค่ไหน (−1 ถึง 1)" },
  davies_bouldin: { label: "Davies–Bouldin", better: "low", desc: "ความกระจายในกลุ่มเทียบกับระยะห่างระหว่างกลุ่ม" },
  calinski_harabasz: { label: "Calinski–Harabasz", better: "high", desc: "อัตราส่วนความแปรปรวนระหว่างกลุ่มต่อภายในกลุ่ม" },
};

// สีประจำโมเดล (คงที่ตามโมเดล ไม่ขึ้นกับลำดับ)
export const MODEL_COLOR = { kmeans: 0, agglomerative: 1, gmm: 2 };
