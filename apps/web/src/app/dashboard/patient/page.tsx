'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getPatientProgressOverview, recordExecution } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Calendar, CheckCircle, Clock, TrendingUp, Activity, ChevronRight } from 'lucide-react';

interface ChartDataPoint {
  day: number;
  planned: number;
  actual: number;
  date: string;
  completed: boolean;
}

interface PatientProgress {
  caseId: string;
  caseStatus: string;
  doctorName: string;
  planId: string;
  totalDays: number;
  completedDays: number;
  progressPercent: number;
  totalSteps: number;
  chartData: ChartDataPoint[];
  steps: Array<{
    stepIndex?: number;
    planTime?: string;
    completed?: boolean;
    actualSteps?: number;
    recordedAt?: string;
    note?: string;
  }>;
}

export default function PatientDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name?: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<PatientProgress[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [recordModal, setRecordModal] = useState<{ stepIndex: number; date: string } | null>(null);
  const [recordForm, setRecordForm] = useState({ actualSteps: '', note: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ user?: { id: string; name?: string; role: string } }>('/auth/me', { method: 'POST' })
      .then((data) => {
        if (data.user?.role !== 'PATIENT') {
          router.push('/dashboard');
          return;
        }
        setUser(data.user);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    getPatientProgressOverview()
      .then((data) => {
        setProgress(Array.isArray(data) ? data as PatientProgress[] : []);
        if (Array.isArray(data) && data.length > 0) {
          setSelectedCaseId((data as PatientProgress[])[0].caseId);
        }
      })
      .catch(() => setProgress([]));
  }, [user]);

  async function handleRecord() {
    if (!selectedCaseId || !recordModal) return;
    setSaving(true);
    try {
      await recordExecution({
        caseId: selectedCaseId,
        stepIndex: recordModal.stepIndex,
        completed: true,
        actualSteps: parseInt(recordForm.actualSteps) || 0,
        note: recordForm.note || undefined,
      });
      // 刷新数据
      const data = await getPatientProgressOverview();
      setProgress(Array.isArray(data) ? data as PatientProgress[] : []);
      setRecordModal(null);
      setRecordForm({ actualSteps: '', note: '' });
    } catch (e) {
      console.error('记录失败', e);
    } finally {
      setSaving(false);
    }
  }

  const selected = progress.find((p) => p.caseId === selectedCaseId);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-medical-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-medical-primary border-t-transparent" />
          <span className="text-sm text-medical-muted">加载中…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-medical-surface">
      {/* 顶部导航 */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">治疗中心</h1>
              <p className="mt-1 text-sm text-medical-muted">您好，{user?.name || '患者'} · 矫正治疗进度</p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-medical-primary-light px-4 py-2 text-sm font-medium text-medical-primary">
              <Activity className="h-4 w-4" />
              治疗中
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* 病例选择 */}
        {progress.length > 0 && (
          <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
            {progress.map((p) => (
              <button
                key={p.caseId}
                onClick={() => setSelectedCaseId(p.caseId)}
                className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                  selectedCaseId === p.caseId
                    ? 'border-medical-primary bg-medical-primary text-white'
                    : 'border-medical-border bg-white text-medical-muted hover:border-medical-primary/50'
                }`}
              >
                <span className="block text-xs opacity-75">病例</span>
                <span className="block">{p.doctorName}</span>
              </button>
            ))}
          </div>
        )}

        {progress.length === 0 ? (
          <div className="card-medical text-center">
            <Calendar className="mx-auto h-12 w-12 text-medical-muted opacity-50" />
            <h3 className="mt-4 text-lg font-medium text-foreground">暂无治疗计划</h3>
            <p className="mt-2 text-sm text-medical-muted">您的医生尚未发布矫正计划，请耐心等待。</p>
          </div>
        ) : selected ? (
          <div className="space-y-6">
            {/* 概览卡片 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card-medical">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-medical-primary-light">
                    <TrendingUp className="h-5 w-5 text-medical-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-medical-muted">总进度</p>
                    <p className="text-2xl font-semibold text-foreground">{selected.progressPercent}%</p>
                  </div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-medical-surface">
                  <div
                    className="h-full rounded-full bg-medical-primary transition-all duration-500"
                    style={{ width: `${selected.progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="card-medical">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                    <CheckCircle className="h-5 w-5 text-medical-success" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-medical-muted">已完成</p>
                    <p className="text-2xl font-semibold text-foreground">{selected.completedDays} 天</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-medical-muted">共 {selected.totalDays} 天矫正计划</p>
              </div>

              <div className="card-medical">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                    <Clock className="h-5 w-5 text-medical-warning" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-medical-muted">剩余</p>
                    <p className="text-2xl font-semibold text-foreground">{selected.totalDays - selected.completedDays} 天</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-medical-muted">继续坚持完成矫正</p>
              </div>

              <div className="card-medical">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                    <Activity className="h-5 w-5 text-medical-secondary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-medical-muted">累计步数</p>
                    <p className="text-2xl font-semibold text-foreground">{selected.totalSteps}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-medical-muted">矫正执行总步数</p>
              </div>
            </div>

            {/* 进度图表 */}
            <div className="card-medical">
              <h3 className="mb-4 text-lg font-semibold text-foreground">矫正进度对比</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selected.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#64748b" />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(value, name) => [value, name === 'planned' ? '计划步数' : '实际步数']}
                    />
                    <Legend formatter={(value) => (value === 'planned' ? '计划步数' : '实际步数')} />
                    <Bar dataKey="planned" fill="#0d9488" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 趋势图 */}
            <div className="card-medical">
              <h3 className="mb-4 text-lg font-semibold text-foreground">完成趋势</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selected.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#64748b" />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(value, name) => [value, name === 'planned' ? '计划步数' : '实际步数']}
                    />
                    <Legend formatter={(value) => (value === 'planned' ? '计划步数' : '实际步数')} />
                    <Line type="monotone" dataKey="planned" stroke="#0d9488" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    <Line type="monotone" dataKey="actual" stroke="#0d9488" strokeWidth={2} dot={{ fill: '#0d9488', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 每日执行记录表格 */}
            <div className="card-medical overflow-hidden p-0">
              <div className="border-b border-medical-border px-6 py-4">
                <h3 className="text-lg font-semibold text-foreground">每日执行记录</h3>
                <p className="mt-1 text-sm text-medical-muted">记录每日完成的矫正步数，点击"记录"按钮填写</p>
              </div>
              <div className="overflow-x-auto">
                <table className="table-medical w-full">
                  <thead>
                    <tr>
                      <th>天</th>
                      <th>计划日期</th>
                      <th>状态</th>
                      <th>实际步数</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.steps.map((step) => {
                      const isToday = step.planTime?.slice(0, 10) === todayStr;
                      const isPast = step.planTime ? step.planTime.slice(0, 10) < todayStr : false;
                      return (
                        <tr key={step.stepIndex}>
                          <td className="font-medium">第 {step.stepIndex} 天</td>
                          <td>{step.planTime?.slice(0, 10) || '—'}</td>
                          <td>
                            {step.completed ? (
                              <span className="badge-success">已完成</span>
                            ) : isToday ? (
                              <span className="badge-primary">今日任务</span>
                            ) : isPast ? (
                              <span className="badge-danger">未完成</span>
                            ) : (
                              <span className="badge-muted">待执行</span>
                            )}
                          </td>
                          <td>{step.actualSteps != null ? step.actualSteps : '—'}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                setRecordModal({ stepIndex: step.stepIndex!, date: step.planTime?.slice(0, 10) || '' });
                                setRecordForm({ actualSteps: '', note: '' });
                              }}
                              className="text-sm text-medical-primary hover:underline"
                            >
                              {step.completed ? '修改' : '记录'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* 记录模态框 */}
      {recordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">记录矫正执行</h3>
            <p className="mt-1 text-sm text-medical-muted">第 {recordModal.stepIndex} 天 · {recordModal.date}</p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">实际步数 *</label>
                <input
                  type="number"
                  value={recordForm.actualSteps}
                  onChange={(e) => setRecordForm((f) => ({ ...f, actualSteps: e.target.value }))}
                  placeholder="请输入完成步数"
                  className="input-field mt-1"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">备注（可选）</label>
                <textarea
                  value={recordForm.note}
                  onChange={(e) => setRecordForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="记录当日情况"
                  className="input-field mt-1 min-h-[80px] resize-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setRecordModal(null)} className="btn-secondary">
                取消
              </button>
              <button type="button" onClick={handleRecord} disabled={saving} className="btn-primary">
                {saving ? '保存中…' : '保存记录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}