/** 品牌标志：足踝 + 定位环意象的 SVG，替代占位字符 ◉，用于登录/首页/侧边栏 */
export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`brand-mark ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* 外定位环（泰勒架意象） */}
        <circle cx="12" cy="12" r="9" opacity="0.45" />
        {/* 足部轮廓 */}
        <path d="M8 7c0 2.2.6 3.8 1.2 5.2.5 1.2.4 2.3-.4 3.1-1 1-2.6.8-3.2-.5" />
        <path d="M8 7c1.6-.5 3.4-.2 4.6.9 1 .9 2.2 1.3 3.4 1.3" />
        <circle cx="16.4" cy="9.4" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
