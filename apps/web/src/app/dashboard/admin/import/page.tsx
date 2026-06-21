'use client';

import { useState } from 'react';
import Link from 'next/link';
import { bulkImportDoctors } from '@/lib/api';

export default function BulkImportPage() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[]; generatedPasswords: { email: string; password: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = text.trim().split(/\n/).filter(Boolean);
    const rows = lines.map((line) => {
      const parts = line.split(/\t/).map((p) => p.trim());
      return { name: parts[0] ?? '', doctorCode: parts[1] ?? '', phone: parts[2] ?? '' };
    }).filter((r) => r.name && r.doctorCode);
    if (rows.length === 0) {
      setResult({ created: 0, skipped: 0, errors: ['没有有效行（每行：姓名\t工号\t手机）'], generatedPasswords: [] });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await bulkImportDoctors(rows);
      setResult(res as typeof result);
    } catch (err) {
      setResult({
        created: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : '导入失败'],
        generatedPasswords: [],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8">
      <Link href="/dashboard/admin" className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover">
        ← 返回系统管理
      </Link>
      <div className="mt-6 mb-8">
        <h1 className="text-2xl font-semibold text-foreground">批量导入医生</h1>
        <p className="mt-1 text-sm text-medical-muted">每行：姓名、工号、手机（Tab 分隔），可粘贴表格</p>
      </div>
      <form onSubmit={handleSubmit} className="card-medical max-w-2xl">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input-field h-40 font-mono text-sm"
          placeholder="张三&#10;D001&#10;13800138000"
        />
        <button type="submit" disabled={loading} className="btn-primary mt-4">
          {loading ? '导入中…' : '导入'}
        </button>
      </form>
      {result && (
        <div className="card-medical mt-6 max-w-2xl">
          <p className="font-medium text-foreground">成功: {result.created}，跳过: {result.skipped}</p>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-medical-danger">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {result.generatedPasswords.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">生成账号与密码（请妥善分发）：</p>
              <pre className="mt-2 overflow-auto rounded-lg border border-medical-border bg-medical-surface p-4 text-sm">
                {result.generatedPasswords.map(({ email, password }) => `${email}\t${password}`).join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
