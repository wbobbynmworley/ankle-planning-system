'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUsers, getLogs } from '@/lib/api';

export default function AdminPage() {
  const [users, setUsers] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<unknown[]>([]);
  const [tab, setTab] = useState<'users' | 'logs'>('users');

  useEffect(() => {
    (async () => {
      try {
        const u = await getUsers();
        setUsers(Array.isArray(u) ? u : []);
        const l = await getLogs(100);
        setLogs(Array.isArray(l) ? l : []);
      } catch {
        // not admin or not logged in
      }
    })();
  }, []);

  const usersList = users as { email: string; name?: string; role: string; doctorCode?: string; patientIdNumber?: string }[];
  const logsList = logs as { createdAt: string; action: string; user?: { email: string } }[];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">系统管理</h1>
        <p className="mt-1 text-sm text-medical-muted">用户与系统日志</p>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'users' ? 'bg-medical-primary text-white' : 'bg-white border border-medical-border text-medical-muted hover:bg-medical-surface'
          }`}
        >
          用户管理
        </button>
        <button
          type="button"
          onClick={() => setTab('logs')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'logs' ? 'bg-medical-primary text-white' : 'bg-white border border-medical-border text-medical-muted hover:bg-medical-surface'
          }`}
        >
          系统日志
        </button>
        <Link
          href="/dashboard/admin/import"
          className="btn-secondary"
        >
          批量导入医生
        </Link>
      </div>
      {tab === 'users' && (
        <div className="card-medical overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table-medical w-full">
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>工号/身份证</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => (
                  <tr key={u.email}>
                    <td>{u.email}</td>
                    <td>{u.name ?? '—'}</td>
                    <td>{u.role}</td>
                    <td>{u.doctorCode ?? u.patientIdNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'logs' && (
        <div className="card-medical overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table-medical w-full">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>用户</th>
                </tr>
              </thead>
              <tbody>
                {logsList.map((l, i) => (
                  <tr key={i}>
                    <td>{l.createdAt}</td>
                    <td>{l.action}</td>
                    <td>{l.user?.email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
