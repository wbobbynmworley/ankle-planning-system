'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, TrendingUp, FileText, LogOut, User } from 'lucide-react';
import { api, getPatientProgressOverview, recordExecution } from '@/lib/api';

const PATIENT_NAV = [
  { href: '/dashboard/patient', label: '我的治疗', icon: LayoutDashboard },
  { href: '/dashboard/patient/progress', label: '进度查看', icon: TrendingUp },
  { href: '/dashboard/patient/daily', label: '每日记录', icon: CalendarCheck },
  { href: '/dashboard/patient/report', label: '我的报告', icon: FileText },
];

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string; role: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ ok: boolean; user?: { id: string; email: string; role: string; name?: string } }>('/auth/me', { method: 'POST' })
      .then((data) => {
        if (data.user) {
          // Redirect non-patients to doctor dashboard
          if (data.user.role !== 'PATIENT') {
            router.push('/dashboard');
            return;
          }
          setUser(data.user);
        } else {
          router.push('/login');
        }
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

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="flex w-56 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-sm">
        <div className="border-b border-medical-border px-3 py-4">
          <Link href="/dashboard/patient" className="flex items-center gap-2 text-base font-semibold text-medical-primary">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-medical-primary/10 text-medical-primary">
              <LayoutDashboard className="h-4 w-4" />
            </span>
            患者端
          </Link>
          <p className="mt-1 text-xs text-medical-muted">骨畸形矫正平台</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {PATIENT_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-medical-muted transition-colors hover:bg-medical-surface hover:text-medical-primary"
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-medical-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-medical-surface text-medical-muted">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{user?.name || user?.email}</p>
              <p className="truncate text-xs text-medical-muted">患者</p>
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
