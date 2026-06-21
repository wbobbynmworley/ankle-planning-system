'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getCasesForPlanning,
  createCaseWithFiles,
  uploadFile,
  api,
} from '@/lib/api';

type CaseRow = {
  id: string;
  status: string;
  patient?: { name?: string; idNumber?: string };
  doctor?: { name?: string };
  files?: { type: string }[];
  plans?: { id: string; algoType: string }[];
};

function statusLabel(status: string, hasPlan: boolean): string {
  if (status === 'PREOP_DONE' || hasPlan) return '已完成术前预案';
  if (status === 'PENDING_PLAN' || status === 'PLANNED') return '待规划';
  return '待规划';
}

export default function NewPatientsPage() {
  const [list, setList] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientIdNumber, setPatientIdNumber] = useState('');
  const [description, setDescription] = useState('');
  const [stlFiles, setStlFiles] = useState<File[]>([]);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCasesForPlanning()
      .then((data) => setList(Array.isArray(data) ? (data as CaseRow[]) : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!patientIdNumber.trim()) return;
    if (stlFiles.length === 0 && !frontFile && !sideFile) {
      setError('请至少上传一种影像：正侧位 JPG 或三维 STL');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const created = await createCaseWithFiles(
        patientName.trim(),
        patientIdNumber.trim(),
        description || undefined,
        {
          stl: stlFiles[0],
          front: frontFile ?? undefined,
          side: sideFile ?? undefined,
        }
      );
      const caseId = (created as { id?: string }).id;
      if (caseId && stlFiles.length > 1) {
        for (const f of stlFiles.slice(1)) {
          try {
            await uploadFile(caseId, f, 'STL');
          } catch {
            /* ignore */
          }
        }
      }
      setShowCreate(false);
      setPatientName('');
      setPatientIdNumber('');
      setDescription('');
      setStlFiles([]);
      setFrontFile(null);
      setSideFile(null);
      const data = await getCasesForPlanning();
      setList(Array.isArray(data) ? (data as CaseRow[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-header">新增患者管理</h1>
          <p className="page-description">已导入病例但未进行术后规划的患者列表</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="btn-primary"
        >
          新增病例
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="card-medical w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">新增病例</h2>
            <p className="mt-1 text-sm text-medical-muted">导入正侧位 X 光片 JPG 或三维 STL 文件</p>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium">患者姓名</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="input-field mt-1"
                  placeholder="请输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">患者身份证号</label>
                <input
                  type="text"
                  value={patientIdNumber}
                  onChange={(e) => setPatientIdNumber(e.target.value)}
                  className="input-field mt-1"
                  placeholder="18 位身份证号"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">影像数据（至少一种）</label>
                <div className="mt-2 space-y-2">
                  <div>
                    <span className="text-xs text-medical-muted">STL（可多选）</span>
                    <input
                      type="file"
                      accept=".stl,model/stl"
                      multiple
                      onChange={(e) => setStlFiles(e.target.files ? Array.from(e.target.files) : [])}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-medical-muted">正位图 JPG/PNG</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      onChange={(e) => setFrontFile(e.target.files?.[0] ?? null)}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-medical-muted">侧位图 JPG/PNG</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      onChange={(e) => setSideFile(e.target.files?.[0] ?? null)}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium">备注</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field mt-1 h-20"
                  placeholder="选填"
                />
              </div>
              {error && <p className="text-sm text-medical-danger">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? '提交中…' : '创建'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card-medical overflow-hidden p-0">
        <div className="border-b border-medical-border px-4 py-3 text-sm font-medium text-medical-muted">
          二级：新增病例（仅展示待规划、已完成术前预案；已完成术后规划不在此表）
        </div>
        {loading ? (
          <p className="p-8 text-center text-medical-muted">加载中…</p>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-medical-muted">暂无待规划病例</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-medical w-full">
              <thead>
                <tr>
                  <th>病例 ID</th>
                  <th>患者</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.id}</td>
                    <td>{c.patient?.name ?? '—'} / {c.patient?.idNumber ?? '—'}</td>
                    <td>{statusLabel(c.status, (c.plans?.length ?? 0) > 0)}</td>
                    <td>
                      <Link
                        href={`/dashboard/cases/${c.id}`}
                        className="text-sm font-medium text-medical-primary hover:underline"
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
