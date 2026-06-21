'use client';

import { useEffect, useState } from 'react';
import { getPatientProgressOverview, recordExecution } from '@/lib/api';
import { CalendarCheck, CheckCircle, Circle } from 'lucide-react';

interface StepData {
  stepIndex?: number;
  planTime?: string;
  completed?: boolean;
  actualSteps?: number;
  recordedAt?: string;
  note?: string;
}

interface PatientProgress {
  caseId: string;
  doctorName: string;
  totalDays: number;
  completedDays: number;
  steps: StepData[];
}

export default function DailyPage() {
  const [cases, setCases] = useState<PatientProgress[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recordModal, setRecordModal] = useState<{ step: StepData; date: string } | null>(null);
  const [form, setForm] = useState({ actualSteps: '', note: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPatientProgressOverview()
      .then((data) => {
        const arr = Array.isArray(data) ? data as PatientProgress[] : [];
        setCases(arr);
        if (arr.length > 0 && !selectedCaseId) {
          setSelectedCaseId(arr[0].caseId);
        }
      })
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = cases.find(c => c.caseId === selectedCaseId);
  const todayStr = new Date().toISOString().slice(0, 10);

  async function handleSave() {
    if (!selectedCaseId || !recordModal) return;
    setSaving(true);
    try {
      await recordExecution({
        caseId: selectedCaseId,
        stepIndex: recordModal.step.stepIndex!,
        completed: true,
        actualSteps: parseInt(form.actualSteps) || 0,
        note: form.note || undefined,
      });
      const data = await getPatientProgressOverview();
      setCases(Array.isArray(data) ? data as PatientProgress[] : []);
      setRecordModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-medical-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">每日记录</h1>
        <p className="page-description">记录您每日完成的矫正步数</p>
      </div>

      {cases.length === 0 ? (
        <div className="card-medical text-center">
          <CalendarCheck className="mx-auto h-12 w-12 text-medical-muted opacity-50" />
          <p className="mt-4 text-medical-muted">暂无治疗计划</p>
        </div>
      ) : (
        <>
          {/* 病例选择 */}
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {cases.map((c) => (
              <button
                key={c.caseId}
                onClick={() => setSelectedCaseId(c.caseId)}
                className={`shrink-0 rounded-lg border px-4 py-2 text-sm transition-all ${
                  selectedCaseId === c.caseId
                    ? 'border-medical-primary bg-medical-primary text-white'
                    : 'border-medical-border bg-white text-medical-muted hover:border-medical-primary/50'
                }`}
              >
                {c.doctorName}的病例
              </button>
            ))}
          </div>

          {selected && (
            <div className="card-medical overflow-hidden p-0">
              <div className="border-b border-medical-border px-6 py-4">
                <h3 className="text-lg font-semibold">每日治疗记录</h3>
                <p className="mt-1 text-sm text-medical-muted">
                  共 {selected.totalDays} 天 · 已完成 {selected.completedDays} 天
                </p>
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
                          <td>{step.actualSteps != null ? `${step.actualSteps} 步` : '—'}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                setRecordModal({ step, date: step.planTime?.slice(0, 10) || '' });
                                setForm({ actualSteps: String(step.actualSteps || ''), note: step.note || '' });
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
          )}
        </>
      )}

      {/* 记录模态框 */}
      {recordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">记录矫正执行</h3>
            <p className="mt-1 text-sm text-medical-muted">
              第 {recordModal.step.stepIndex} 天 · {recordModal.date}
            </p>
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium">实际步数 *</label>
                <input
                  type="number"
                  value={form.actualSteps}
                  onChange={(e) => setForm(f => ({ ...f, actualSteps: e.target.value }))}
                  className="input-field mt-1 w-full"
                  min="0"
                  placeholder="请输入完成步数"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">备注</label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                  className="input-field mt-1 w-full min-h-[80px] resize-none"
                  placeholder="记录当日情况（可选）"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setRecordModal(null)} className="btn-secondary">
                取消
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? '保存中…' : '保存记录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
