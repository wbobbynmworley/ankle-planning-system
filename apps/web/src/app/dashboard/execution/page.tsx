'use client';

import { useState, useEffect } from 'react';
import {
  getExecutionPatients,
  getExecutionPlan,
  updateExecutionStep,
} from '@/lib/api';

type PatientRow = {
  id: string;
  patient?: { name?: string; idNumber?: string };
  doctor?: { name?: string };
};

type RodStep = { rodLength: number; scale: number };
type DailyRow = {
  stepIndex: number;
  planTime: string;
  rod1: RodStep;
  rod2: RodStep;
  rod3: RodStep;
  rod4: RodStep;
  rod5: RodStep;
  rod6: RodStep;
  note?: string;
  completed: boolean;
};

export default function ExecutionPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [plan, setPlan] = useState<{
    initialInstallation: { referenceRing: { model?: string }; movingRing: { model?: string }; rods: { model?: string; length: number; scale: number }[] };
    dailySteps: DailyRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<{ step: number; field: string } | null>(null);

  useEffect(() => {
    getExecutionPatients()
      .then((d) => setPatients(Array.isArray(d) ? (d as PatientRow[]) : []))
      .catch(() => setPatients([]));
  }, []);

  useEffect(() => {
    if (!selectedCaseId) {
      setPlan(null);
      return;
    }
    setLoading(true);
    getExecutionPlan(selectedCaseId)
      .then((d) => setPlan(d as any))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, [selectedCaseId]);

  async function handleUpdateStep(
    stepIndex: number,
    body: { planTime?: string; rod1Scale?: number; rod2Scale?: number; rod3Scale?: number; rod4Scale?: number; rod5Scale?: number; rod6Scale?: number; rod1Length?: number; rod2Length?: number; rod3Length?: number; rod4Length?: number; rod5Length?: number; rod6Length?: number; completed?: boolean }
  ) {
    if (!selectedCaseId) return;
    setLoading(true);
    setMsg('');
    try {
      const updated = await updateExecutionStep(selectedCaseId, stepIndex, body);
      setPlan(updated as any);
      setEditing(null);
      setMsg('已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">方案执行监督与调整</h1>
        <p className="page-description">选中已完成术后规划的患者，展示每日矫正方案表后可进行时间/读数/换杆调整</p>
      </div>

      <div className="card-medical mb-6">
        <h3 className="font-medium">选择患者</h3>
        <select
          value={selectedCaseId}
          onChange={(e) => setSelectedCaseId(e.target.value)}
          className="input-field mt-2 max-w-md"
        >
          <option value="">请选择已完成术后规划的患者</option>
          {patients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.patient?.name ?? '—'} / {c.patient?.idNumber ?? c.id}
            </option>
          ))}
        </select>
      </div>

      {loading && !plan && <p className="text-medical-muted">加载中…</p>}
      {selectedCaseId && !loading && !plan && <p className="text-medical-muted">该病例暂无方案数据</p>}

      {plan && (
        <>
          <div className="card-medical mb-4">
            <h3 className="font-medium">初始安装情况</h3>
            <p className="mt-1 text-sm text-medical-muted">
              参考环: {plan.initialInstallation?.referenceRing?.model ?? '—'}，动环: {plan.initialInstallation?.movingRing?.model ?? '—'}
            </p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {plan.initialInstallation?.rods?.map((r: any, i: number) => (
                <span key={i}>
                  杆{i + 1}: {r.model ?? '—'} 长度{r.length} 刻度{r.scale}
                </span>
              ))}
            </div>
          </div>

          <div className="card-medical overflow-hidden p-0">
            <div className="border-b border-medical-border px-4 py-2 text-sm font-medium text-medical-muted">
              每日方案表 · 可编辑：计划时间（时间调整）、刻度（读数调整）、当前杆长（换杆调整）
            </div>
            <div className="overflow-x-auto">
              <table className="table-medical w-full">
                <thead>
                  <tr>
                    <th>步数</th>
                    <th>计划时间</th>
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <th key={i}>杆{i} 杆长/刻度</th>
                    ))}
                    <th>完成</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.dailySteps?.map((row) => (
                    <tr key={row.stepIndex}>
                      <td>{row.stepIndex}</td>
                      <td>
                        {editing?.step === row.stepIndex && editing?.field === 'planTime' ? (
                          <input
                            type="date"
                            defaultValue={row.planTime?.slice(0, 10)}
                            onBlur={(e) => {
                              handleUpdateStep(row.stepIndex, { planTime: e.target.value });
                            }}
                            className="input-field w-36"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing({ step: row.stepIndex, field: 'planTime' })}
                            className="text-left underline"
                          >
                            {row.planTime?.slice(0, 10) ?? '—'}
                          </button>
                        )}
                      </td>
                      {([1, 2, 3, 4, 5, 6] as const).map((i) => (
                        <td key={i} className="whitespace-nowrap">
                          <span className="text-amber-600">{(row[`rod${i}` as keyof DailyRow] as RodStep | undefined)?.rodLength ?? '—'}</span>
                          {' / '}
                          <span className="text-green-700">{(row[`rod${i}` as keyof DailyRow] as RodStep | undefined)?.scale ?? '—'}</span>
                        </td>
                      ))}
                      <td>{row.completed ? '是' : '否'}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleUpdateStep(row.stepIndex, { completed: true })}
                          className="text-sm text-medical-primary hover:underline"
                        >
                          完成
                        </button>
                        <span className="mx-1 text-medical-muted">|</span>
                        <button
                          type="button"
                          onClick={() => setEditing({ step: row.stepIndex, field: 'adjust' })}
                          className="text-sm text-medical-primary hover:underline"
                        >
                          调整
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2 text-sm text-medical-muted">刻度统一为 1 刻度 = 1mm</p>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </>
      )}
    </div>
  );
}
