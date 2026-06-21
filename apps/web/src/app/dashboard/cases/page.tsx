'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCases, createCaseWithFiles, uploadFile, api } from '@/lib/api';

export default function CasesListPage() {
  const [cases, setCases] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createPatientName, setCreatePatientName] = useState('');
  const [createPatientIdNumber, setCreatePatientIdNumber] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createStlFiles, setCreateStlFiles] = useState<File[]>([]);
  const [createFront, setCreateFront] = useState<File | null>(null);
  const [createSide, setCreateSide] = useState<File | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  const canCreate = userRole === 'DOCTOR' || userRole === 'ADMIN';

  function loadCases() {
    setLoading(true);
    Promise.all([
      getCases({ search: search.trim() || undefined, status: statusFilter || undefined }),
      api<{ user?: { role: string } }>('/auth/me', { method: 'POST' }).then((d) => setUserRole(d.user?.role ?? null)),
    ])
      .then(([data]) => setCases(Array.isArray(data) ? data : []))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCases();
  }, [search, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createPatientIdNumber.trim()) return;
    if (createStlFiles.length === 0 && !createFront && !createSide) {
      setCreateError('请至少上传一种影像数据：STL 模型或正位图/侧位图');
      return;
    }
    setCreateError('');
    setCreateSubmitting(true);
    try {
      const created = await createCaseWithFiles(
        createPatientName.trim(),
        createPatientIdNumber.trim(),
        createDesc || undefined,
        {
          stl: createStlFiles[0] ?? undefined,
          front: createFront ?? undefined,
          side: createSide ?? undefined,
        },
      );
      // 如果选择了多个 STL，创建完病例后把剩余 STL 一并上传到该病例
      if (created && (created as { id?: string }).id && createStlFiles.length > 1) {
        const caseId = (created as { id: string }).id;
        const extra = createStlFiles.slice(1);
        for (const f of extra) {
          try {
            await uploadFile(caseId, f, 'STL');
          } catch {
            // 忽略单个文件失败，后续可在附件里手动补传
          }
        }
      }
      setShowCreate(false);
      setCreatePatientName('');
      setCreatePatientIdNumber('');
      setCreateDesc('');
      setCreateStlFiles([]);
      setCreateFront(null);
      setCreateSide(null);
      loadCases();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreateSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  const list = cases as { id: string; status?: string; patient?: { name?: string; idNumber?: string }; doctor?: { name?: string } }[];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-header">病例管理</h1>
          <p className="page-description">检索全部病例（含已痊愈/已完成规划）</p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
            创建病例
          </button>
        )}
      </div>
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索病例/患者"
          className="input-field w-48"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field w-40">
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PENDING_PLAN">待规划</option>
          <option value="PLANNED">已规划</option>
          <option value="PREOP_DONE">已完成术前</option>
          <option value="POSTOP_DONE">已完成术后</option>
          <option value="COMPLETED">已完成</option>
        </select>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="card-medical w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-foreground">创建病例</h2>
            <p className="mt-1 text-sm text-medical-muted">填写患者信息并至少上传一种影像数据（STL 或正位/侧位图）</p>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">患者姓名</label>
                <input
                  type="text"
                  value={createPatientName}
                  onChange={(e) => setCreatePatientName(e.target.value)}
                  className="input-field mt-1"
                  placeholder="请输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">患者身份证号</label>
                <input
                  type="text"
                  value={createPatientIdNumber}
                  onChange={(e) => setCreatePatientIdNumber(e.target.value)}
                  className="input-field mt-1"
                  placeholder="18 位身份证号"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">影像数据（至少一种）</label>
                <div className="mt-2 space-y-2">
                  <div>
                    <span className="text-xs text-medical-muted">STL 模型（可多选，一次性导入多个骨块）</span>
                    <input
                      type="file"
                      accept=".stl,model/stl,application/octet-stream"
                      multiple
                      onChange={(e) => setCreateStlFiles(e.target.files ? Array.from(e.target.files) : [])}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                    {createStlFiles.length > 0 && (
                      <span className="block text-xs text-medical-muted">
                        已选择 {createStlFiles.length} 个文件：{createStlFiles.map((f) => f.name).join('，')}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-medical-muted">正位图（JPG/PNG）</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      onChange={(e) => setCreateFront(e.target.files?.[0] ?? null)}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                    {createFront && <span className="text-xs text-medical-muted">{createFront.name}</span>}
                  </div>
                  <div>
                    <span className="text-xs text-medical-muted">侧位图（JPG/PNG）</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      onChange={(e) => setCreateSide(e.target.files?.[0] ?? null)}
                      className="input-field mt-0.5 block w-full text-sm"
                    />
                    {createSide && <span className="text-xs text-medical-muted">{createSide.name}</span>}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">备注（选填）</label>
                <textarea
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="input-field mt-1 h-20"
                  placeholder="病情简述等"
                />
              </div>
              {createError && <p className="text-sm text-medical-danger">{createError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={createSubmitting} className="btn-primary">
                  {createSubmitting ? '创建中…' : '创建'}
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
        {list.length === 0 ? (
          <p className="p-8 text-center text-medical-muted">暂无病例</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-medical w-full">
              <thead>
                <tr>
                  <th>病例 ID</th>
                  <th>状态</th>
                  <th>患者</th>
                  <th>医生</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.id}</td>
                    <td>{c.status ?? '—'}</td>
                    <td>{c.patient?.name ?? '—'}</td>
                    <td>{c.doctor?.name ?? '—'}</td>
                    <td>
                      <Link
                        href={`/dashboard/cases/${c.id}`}
                        className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover"
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
