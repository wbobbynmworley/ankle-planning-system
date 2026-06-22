/**
 * 器械示意图（SVG 矢量绘制，无需外部图片资源）。
 * 参照泰勒空间外固定架（Taylor Spatial Frame / 六杆 Stewart 平台）的标准结构：
 * 两个环形圈 + 6 根可伸缩斜杆（连杆），连杆带刻度（1 刻度 = 1mm）。
 */

const TEAL = '#0d9488';
const TEAL_LIGHT = '#5eead4';
const SLATE = '#475569';

/** 环形圈：外环 + 内环 + 周向螺孔 */
export function RingArt({ size = 96, holes = 12 }: { size?: number; holes?: number }) {
  const c = size / 2;
  const rOuter = size * 0.42;
  const rInner = size * 0.3;
  const rHole = size * 0.36;
  const holeEls = Array.from({ length: holes }, (_, i) => {
    const a = (i / holes) * Math.PI * 2;
    return (
      <circle
        key={i}
        cx={c + rHole * Math.cos(a)}
        cy={c + rHole * Math.sin(a)}
        r={size * 0.022}
        fill="#fff"
        stroke={SLATE}
        strokeWidth={0.8}
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="环形圈">
      <defs>
        <radialGradient id="ringGrad" cx="40%" cy="35%">
          <stop offset="0%" stopColor={TEAL_LIGHT} />
          <stop offset="100%" stopColor={TEAL} />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={rOuter} fill="url(#ringGrad)" />
      <circle cx={c} cy={c} r={rInner} fill="#fff" />
      {holeEls}
    </svg>
  );
}

/** 连杆：可伸缩套管 + 刻度 + 长度标注（1 刻度 = 1mm） */
export function RodArt({ width = 150, height = 44, ticks = 12 }: { width?: number; height?: number; ticks?: number }) {
  const midY = height / 2;
  const barH = height * 0.34;
  const x0 = width * 0.06;
  const x1 = width * 0.94;
  const innerX0 = width * 0.4;
  const tickEls = Array.from({ length: ticks + 1 }, (_, i) => {
    const x = innerX0 + ((x1 - innerX0) * i) / ticks;
    const major = i % 5 === 0;
    return (
      <line
        key={i}
        x1={x}
        y1={midY - (major ? barH * 0.7 : barH * 0.4)}
        x2={x}
        y2={midY + (major ? barH * 0.7 : barH * 0.4)}
        stroke={major ? TEAL : SLATE}
        strokeWidth={major ? 1.4 : 0.8}
      />
    );
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="连杆">
      {/* 外套管 */}
      <rect x={x0} y={midY - barH / 2} width={innerX0 - x0 + 6} height={barH} rx={barH / 2} fill={TEAL} />
      {/* 内伸缩杆 */}
      <rect x={innerX0} y={midY - barH * 0.32} width={x1 - innerX0} height={barH * 0.64} rx={barH * 0.32} fill="#e2e8f0" stroke={SLATE} strokeWidth={0.8} />
      {tickEls}
      {/* 端部球铰 */}
      <circle cx={x0} cy={midY} r={barH * 0.55} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth={1.2} />
      <circle cx={x1} cy={midY} r={barH * 0.5} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth={1.2} />
    </svg>
  );
}

/** 六杆组合（泰勒架）：上下两环 + 6 根交叉斜杆 */
export function HexapodArt({ size = 132 }: { size?: number }) {
  const w = size;
  const h = size;
  const cx = w / 2;
  const topY = h * 0.26;
  const botY = h * 0.76;
  const rx = w * 0.36;
  const ry = h * 0.1;
  // 上下环上各取 3 对连接点，画 6 根斜杆形成 Stewart 平台交叉
  const topPts = [-1, 1, 0].map((k, i) => ({ x: cx + rx * Math.cos((i * 2 * Math.PI) / 3 - Math.PI / 2) * 0.92, y: topY + ry * Math.sin((i * 2 * Math.PI) / 3 - Math.PI / 2) }));
  const botPts = [0, 1, 2].map((i) => ({ x: cx + rx * Math.cos((i * 2 * Math.PI) / 3 + Math.PI / 6) * 0.92, y: botY + ry * Math.sin((i * 2 * Math.PI) / 3 + Math.PI / 6) }));
  const struts: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  for (let i = 0; i < 3; i++) {
    struts.push([topPts[i]!, botPts[i]!]);
    struts.push([topPts[i]!, botPts[(i + 2) % 3]!]);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="六杆组合（泰勒架）">
      {/* 斜杆 */}
      {struts.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SLATE} strokeWidth={2.2} strokeLinecap="round" />
      ))}
      {/* 下环 */}
      <ellipse cx={cx} cy={botY} rx={rx} ry={ry} fill="none" stroke={TEAL} strokeWidth={5} />
      {/* 上环 */}
      <ellipse cx={cx} cy={topY} rx={rx} ry={ry} fill="none" stroke={TEAL_LIGHT} strokeWidth={5} />
      {/* 铰接点 */}
      {[...topPts, ...botPts].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={TEAL} />
      ))}
    </svg>
  );
}
