'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCases } from '@/lib/api';

export default function DashboardPage() {
  const [cases, setCases] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCases()
      .then((data) => setCases(Array.isArray(data) ? data : []))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  const list = (cases as { id: string; status?: string; patient?: { name?: string }; doctor?: { name?: string }; createdAt?: string }[]).slice(0, 10);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="page-header">工作台</h1>
        <p className="page-description">查看最近病例与快捷入口</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/dashboard/patients/new" className="card-medical flex flex-col transition-shadow hover:shadow-card-hover">
          <span className="text-2xl font-semibold text-medical-primary">新增患者</span>
          <span className="mt-0.5 text-xs text-medical-muted">新增病例、待规划列表</span>
        </Link>
        <Link href="/dashboard/preop/2d" className="card-medical flex flex-col transition-shadow hover:shadow-card-hover">
          <span className="text-2xl font-semibold text-medical-primary">术前预案</span>
          <span className="mt-0.5 text-xs text-medical-muted">二维 / 三维前期预案</span>
        </Link>
        <Link href="/dashboard/postop/2d" className="card-medical flex flex-col transition-shadow hover:shadow-card-hover">
          <span className="text-2xl font-semibold text-medical-primary">术后规划</span>
          <span className="mt-0.5 text-xs text-medical-muted">二维 / 三维术后规划</span>
        </Link>
        <Link href="/dashboard/cases" className="card-medical flex flex-col transition-shadow hover:shadow-card-hover">
          <span className="text-3xl font-semibold text-medical-primary">{cases.length}</span>
          <span className="mt-1 text-sm font-medium text-foreground">全部病例</span>
          <span className="mt-0.5 text-xs text-medical-muted">病例管理</span>
        </Link>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">最近病例</h2>
          <Link
            href="/dashboard/cases"
            className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover"
          >
            查看全部
          </Link>
        </div>
        <div className="card-medical mt-4 overflow-hidden p-0">
          {list.length === 0 ? (
            <p className="p-6 text-center text-sm text-medical-muted">暂无病例</p>
          ) : (
            <ul className="divide-y divide-medical-border">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/cases/${c.id}`}
                    className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-medical-surface/50"
                  >
                    <span className="font-medium text-foreground">病例 {c.id}</span>
                    <span className="text-sm text-medical-muted">{c.status ?? '—'}</span>
                    <span className="text-sm text-medical-muted">{c.patient?.name ?? c.doctor?.name ?? '—'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
