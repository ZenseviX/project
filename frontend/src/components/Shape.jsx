import { SHAPES } from "../lib.js";

/** มาร์กเกอร์ตามรูปทรงของกลุ่ม (ช่วยแยกกลุ่มโดยไม่พึ่งสีอย่างเดียว) */
export default function Shape({ c, x = 0, y = 0, r = 5, fill, stroke = "var(--surface)", sw = 1.5, ...rest }) {
  const kind = SHAPES[c % SHAPES.length];
  const common = { fill, stroke, strokeWidth: sw, ...rest };
  switch (kind) {
    case "square":
      return <rect x={x - r * 0.88} y={y - r * 0.88} width={r * 1.76} height={r * 1.76} rx={1.5} {...common} />;
    case "triangle":
      return <polygon points={`${x},${y - r * 1.1} ${x + r},${y + r * 0.75} ${x - r},${y + r * 0.75}`} {...common} />;
    case "triangleDown":
      return <polygon points={`${x},${y + r * 1.1} ${x + r},${y - r * 0.75} ${x - r},${y - r * 0.75}`} {...common} />;
    case "diamond":
      return <polygon points={`${x},${y - r * 1.15} ${x + r * 1.15},${y} ${x},${y + r * 1.15} ${x - r * 1.15},${y}`} {...common} />;
    case "plus": {
      const a = r * 0.38, b = r * 1.05;
      return <polygon points={`${x - a},${y - b} ${x + a},${y - b} ${x + a},${y - a} ${x + b},${y - a} ${x + b},${y + a} ${x + a},${y + a} ${x + a},${y + b} ${x - a},${y + b} ${x - a},${y + a} ${x - b},${y + a} ${x - b},${y - a} ${x - a},${y - a}`} {...common} />;
    }
    case "cross":
      return <g transform={`rotate(45 ${x} ${y})`}><Shape c={5} x={x} y={y} r={r} fill={fill} stroke={stroke} sw={sw} {...rest} /></g>;
    case "star": {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.5 : r * 1.2;
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${x + rr * Math.cos(ang)},${y + rr * Math.sin(ang)}`);
      }
      return <polygon points={pts.join(" ")} {...common} />;
    }
    default:
      return <circle cx={x} cy={y} r={r} {...common} />;
  }
}
