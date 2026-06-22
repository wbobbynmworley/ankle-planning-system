'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  UserPlus,
  ClipboardList,
  MapPin,
  CalendarCheck,
  FolderOpen,
  Shield,
  Package,
  LogOut,
  User,
  Activity,
} from 'lucide-react';
import { api } from '@/lib/api';
import { BrandMark } from '@/components/BrandMark';

const PRIMARY_NAV = [
  { href: '/dashboard', label: '工作台', icon: LayoutDashboard },
  { href: '/dashboard/patients/new', label: '新增患者管理', icon: UserPlus },
  { href: '/dashboard/preop', label: '术前预案', icon: ClipboardList },
  { href: '/dashboard/postop', label: '术后规划', icon: MapPin },
  { href: '/dashboard/execution', label: '方案执行监督与调整', icon: CalendarCheck },
  { href: '/dashboard/cases', label: '病例管理', icon: FolderOpen },
  // 权限管理仅管理员可用（后端 /perms 为 ADMIN-only），医生不显示，避免 403
  { href: '/dashboard/perms', label: '权限管理', icon: Shield, adminOnly: true },
  { href: '/dashboard/instruments', label: '器械管理', icon: Package },
];

const PATIENT_NAV = [
  { href: '/dashboard/patient', label: '我的治疗', icon: Activity },
  { href: '/dashboard', label: '返回医生端', icon: LayoutDashboard },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string; role: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ ok: boolean; user?: { id: string; email: string; role: string; name?: string } }>('/auth/me', { method: 'POST' })
      .then((data) => {
        if (data.user) setUser(data.user);
        else router.push('/login');
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('token');
    router.push('/login');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-medical-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-medical-primary border-t-transparent" />
          <span className="text-sm text-medical-muted">加载中…</span>
        </div>
      </div>
    );
  }

  const roleLabel = user?.role === 'ADMIN' ? '管理员' : user?.role === 'DOCTOR' ? '医生' : '患者';
  const NAV = (user?.role === 'PATIENT' ? PATIENT_NAV : PRIMARY_NAV).filter(
    (item) => !('adminOnly' in item && item.adminOnly) || user?.role === 'ADMIN',
  );

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="flex w-56 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-sm">
        <div className="border-b border-medical-border px-3 py-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-base font-semibold text-medical-primary">
            <BrandMark size={32} />
            足踝矫正规划
          </Link>
          <p className="mt-1 text-xs text-medical-muted">微创外固定架 · 智能规划系统</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const isActive =
              pathname === href ||
              (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                  isActive ? 'nav-item-active' : 'nav-item-inactive'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-medical-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-medical-surface text-medical-muted">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{user?.name || user?.email}</p>
              <p className="truncate text-xs text-medical-muted">{roleLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-medical-muted transition-colors hover:bg-red-50 hover:text-medical-danger"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
