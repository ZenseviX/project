import { useEffect, useRef } from "react";

/** สร้างเลขคงที่จากข้อความ (FNV-1a) — ใช้กำหนดสีปกให้เพลงเดิมได้สีเดิมเสมอ */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * ปกเพลงแบบ generative เคลื่อนไหวเบาๆ: ก้อนสีไล่เฉด + แถบ EQ (ภาพประกอบ ไม่ใช่ข้อมูล)
 * - เคารพ prefers-reduced-motion (วาดภาพนิ่ง)
 * - หยุดวาดเมื่อเลื่อนพ้นจอ หรือเมื่อ playing = false
 */
export default function Cover({ seed, playing = true, className = "", children }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const playRef = useRef(playing);
  playRef.current = playing;

  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    const ctx = cv.getContext("2d");
    const h = hash(seed || "cover");
    const hue1 = h % 360, hue2 = (hue1 + 50 + ((h >> 9) % 90)) % 360, hue3 = (hue1 + 180 + ((h >> 17) % 60)) % 360;
    const phase = (h % 1000) / 100;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let w = 0, ht = 0, raf = 0, visible = true, t0 = performance.now(), frozen = 0;
    const N = 28;
    const bars = new Float32Array(N);

    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, r.width); ht = Math.max(1, r.height);
      cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const accent = () => getComputedStyle(cv).getPropertyValue("--accent").trim() || "#c6f135";

    const draw = (t) => {
      const s = t / 1000 + phase;
      const bg = ctx.createLinearGradient(0, 0, w, ht);
      bg.addColorStop(0, `hsl(${hue1} 55% 16%)`);
      bg.addColorStop(1, `hsl(${hue2} 60% 8%)`);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, ht);

      ctx.globalCompositeOperation = "lighter";
      const blobs = [[hue1, 0.31, 0.9], [hue2, 0.23, 1.7], [hue3, 0.17, 2.9]];
      blobs.forEach(([hue, sp, off], i) => {
        const x = w * (0.5 + 0.34 * Math.sin(s * sp + off));
        const y = ht * (0.42 + 0.3 * Math.cos(s * sp * 1.3 + off * 1.7));
        const r = Math.max(w, ht) * (0.55 + 0.1 * Math.sin(s * 0.5 + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${hue} 85% 58% / 0.55)`);
        g.addColorStop(1, `hsla(${hue} 85% 40% / 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, ht);
      });

      // วงแหวนหมุนช้าๆ คล้ายแผ่นเสียง
      ctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.translate(w * 0.72, ht * 0.36);
      ctx.rotate(s * 0.25);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      for (let k = 1; k <= 5; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(w, ht) * 0.07 * k, 0, Math.PI * 1.6);
        ctx.stroke();
      }
      ctx.restore();

      // แถบ EQ ด้านล่าง
      const base = ht * 0.96, maxH = ht * 0.42, gap = 3;
      const bw = (w * 0.92 - gap * (N - 1)) / N, x0 = w * 0.04;
      ctx.fillStyle = accent();
      for (let i = 0; i < N; i++) {
        const target = 0.12 + 0.88 * Math.abs(Math.sin(s * (2.1 + (i % 5) * 0.37) + i * 0.7) * Math.sin(s * 0.9 + i * 1.3));
        bars[i] += (target - bars[i]) * 0.18;
        const bh = Math.max(3, bars[i] * maxH);
        ctx.globalAlpha = 0.55 + 0.45 * bars[i];
        ctx.beginPath();
        ctx.roundRect(x0 + i * (bw + gap), base - bh, bw, bh, Math.min(3, bw / 2));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now) => {
      if (playRef.current && !reduce) {
        draw(now - t0);
        frozen = now - t0;
      }
      raf = visible ? requestAnimationFrame(loop) : 0;
    };

    resize();
    for (let i = 0; i < 40; i++) draw(4000 + i * 16); // เฟรมแรก (ภาพนิ่งเมื่อ reduce motion)
    const ro = new ResizeObserver(() => { resize(); draw(frozen || 4000); });
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(loop);
    });
    io.observe(box);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [seed]);

  return (
    <div ref={wrap} className={"cover " + className}>
      <canvas ref={canvas} aria-hidden />
      {children}
    </div>
  );
}
