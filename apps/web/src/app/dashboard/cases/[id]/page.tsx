'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCase, getFiles, getPlans, getAlgoHealth, uploadFile, deleteFile, downloadPlanPdf, api } from '@/lib/api';

export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [caseData, setCaseData] = useState<unknown>(null);
  const [files, setFiles] = useState<unknown[]>([]);
  const [plans, setPlans] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [algoHealthy, setAlgoHealthy] = useState<boolean | null>(null);

  const canEdit = userRole === 'DOCTOR' || userRole === 'ADMIN';

  function load() {
    return Promise.all([
      getCase(id).then(setCaseData),
      getFiles(id).then((f) => setFiles(Array.isArray(f) ? f : [])),
      getPlans(id).then((p) => setPlans(Array.isArray(p) ? p : [])),
      api<{ user?: { role: string } }>('/auth/me', { method: 'POST' }).then((d) => setUserRole(d.user?.role ?? null)),
      getAlgoHealth().then((h) => setAlgoHealthy(h.ok)).catch(() => setAlgoHealthy(false)),
    ]);
  }

  useEffect(() => {
    load().catch(() => router.push('/dashboard')).finally(() => setLoading(false));
  }, [id, router]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await uploadFile(id, file);
      }
      const f = await getFiles(id);
      setFiles(Array.isArray(f) ? f : []);
      // F1.1: 上传STL成功后自动跳转到3D工作台进行STL转2D测量
      const fileName = fileList[0]?.name.toLowerCase() ?? '';
      if (fileName.endsWith('.stl')) {
        router.push(`/dashboard/cases/${id}/plan-3d`);
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDeleteFile(fileId: string) {
    try {
      await deleteFile(fileId);
      setFiles((prev) => (prev as { id: string }[]).filter((f) => f.id !== fileId));
    } catch {}
  }

  function openWorkbench(type: '2d' | '3d') {
    router.push(`/dashboard/cases/${id}/plan-${type}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  const c = caseData as { id: string; status?: string; description?: string; patient?: { name: string }; doctor?: { name: string } } | null;
  if (!c) return null;

  const filesList = files as { id: string; type: string; originalName?: string }[];
  const plansList = plans as { id: string; algoType: string; totalDays?: number; totalDistance?: number }[];
  const has2D = (filesList as { type: string }[]).some((f) => f.type === 'FRONT' || f.type === 'SIDE');
  const has3D = (filesList as { type: string }[]).some((f) => f.type === 'STL');

  return (
    <div className="p-8">
      <Link href="/dashboard/cases" className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover">
        ← 返回病例列表
      </Link>
      <div className="mt-6">
        <h1 className="text-2xl font-semibold text-foreground">病例 {c.id}</h1>
        <p className="mt-1 text-sm text-medical-muted">状态: {c.status ?? '—'} · 患者: {c.patient?.name ?? '—'} · 医生: {c.doctor?.name ?? '—'}</p>
        {c.description && <p className="mt-2 text-sm text-foreground">{c.description}</p>}
      </div>

      {algoHealthy === false && canEdit && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>规划服务未连接。</strong> 请确认标题为「Algo-8000」的窗口已打开且显示 “Uvicorn running on http://0.0.0.0:8000”。若未打开，请运行项目根目录的 start.bat，或单独在 apps\algo 下执行：uvicorn algo.main:app --host 0.0.0.0 --port 8000
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">附件</h2>
        {canEdit && (
          <div className="mt-2">
            <label className="btn-secondary inline-block cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept=".stl,.jpg,.jpeg,.png"
                multiple
                onChange={handleUpload}
                disabled={uploading}
              />
              {uploading ? '上传中…' : '上传文件'}
            </label>
          </div>
        )}
        <div className="card-medical mt-3">
          {filesList.length === 0 ? (
            <p className="text-medical-muted">暂无附件。上传正侧位片(2D)或 STL(3D)后点击「开始规划」。</p>
          ) : (
            <ul className="divide-y divide-medical-border">
              {filesList.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{f.type} — {f.originalName ?? f.id}</span>
                  {canEdit && (
                    <button type="button" onClick={() => handleDeleteFile(f.id)} className="text-medical-danger hover:underline">
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {canEdit && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground">规划</h2>
          {filesList.length === 0 && (
            <p className="mt-1 text-sm text-medical-muted">请先上传二维(正位+侧位)或三维(STL)数据。</p>
          )}
          {(has2D || has3D) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {has2D && (
                <button type="button" onClick={() => openWorkbench('2d')} className="btn-primary">
                  打开 2D 工作台
                </button>
              )}
              {has3D && (
                <button type="button" onClick={() => openWorkbench('3d')} className="btn-primary">
                  打开 3D 工作台
                </button>
              )}
            </div>
          )}
          {has2D && has3D && (
            <p className="mt-2 text-sm text-medical-muted">在工作台内进行分割、移动、设目标后执行 A* 规划。</p>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">已有规划</h2>
        <div className="card-medical mt-3">
          {plansList.length === 0 ? (
            <p className="text-medical-muted">暂无规划</p>
          ) : (
            <ul className="divide-y divide-medical-border">
              {plansList.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{p.algoType} — 总天数: {p.totalDays ?? '—'}，总距离: {p.totalDistance ?? '—'} mm</span>
                  <span className="flex gap-2">
                    <Link href={`/dashboard/cases/${id}/plan-${p.algoType === 'PLAN_2D' ? '2d' : '3d'}?planId=${p.id}`} className="text-medical-primary hover:underline">
                      查看
                    </Link>
                    <button type="button" onClick={() => downloadPlanPdf(p.id)} className="text-medical-primary hover:underline">
                      下载 PDF
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
