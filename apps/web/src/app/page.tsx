import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';

const FEATURES = [
  { title: '2D 双平面规划', desc: '正/侧位影像 SAM 分割 + A* 无碰撞路径' },
  { title: '3D 体素规划', desc: 'STL 多骨体素 A*，三角形级碰撞校验' },
  { title: '泰勒架方案', desc: '测量驱动的 6 杆刻度与每日步进报告' },
];

export default function HomePage() {
  return (
    <main className="auth-bg">
      <div className="auth-card max-w-lg text-center">
        <BrandMark size={60} className="mx-auto mb-6" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">足踝畸形矫正智能规划系统</h1>
        <p className="mt-2 text-medical-muted">医疗级足踝畸形矫正 2D / 3D 智能规划平台</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-medical-border bg-white/70 p-4 text-left">
              <p className="text-sm font-semibold text-medical-primary">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-medical-muted">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-4">
          <Link href="/login" className="btn-primary">
            登录
          </Link>
          <Link href="/register" className="btn-secondary">
            注册
          </Link>
        </div>
      </div>
    </main>
  );
}
