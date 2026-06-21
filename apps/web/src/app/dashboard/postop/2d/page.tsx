'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getCasesForPlanning, uploadFile, createMeasurement, triggerPlan } from '@/lib/api';

const STEPS = ['术后影像导入', '畸形相关测量分析', '提取矫正部位', '矫正数据输入', '矫正路径规划'];

export default function Postop2DPage() {
  const [cases, setCases] = useState<{ id: string; patient?: { name?: string } }[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [step, setStep] = useState(0);
  const [measureValues, setMeasureValues] = useState<Record<string, number>>({
    anklePlantarflexion: 0,
    footEversion: 0,
    calcanealForceLine: 0,
    calcanealEversion: 0,
    archHeight: 0,
  });
  const [goalMm, setGoalMm] = useState<[number, number, number]>([0, 0, 0]);
  const [planResult, setPlanResult] = useState<{ totalDays?: number; totalDistance?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getCasesForPlanning().then((d) => setCases(Array.isArray(d) ? (d as any[]) : []));
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedCaseId) return;
    setLoading(true);
    try {
      await uploadFile(selectedCaseId, file, 'FRONT');
      setMsg('上传成功');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMeasurement() {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      await createMeasurement({ caseId: selectedCaseId, stage: 'POSTOP_2D', values: measureValues });
      setMsg('测量数据已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleTriggerPlan() {
    if (!selectedCaseId) return;
    setLoading(true);
    setMsg('');
    try {
      const r = await triggerPlan(selectedCaseId, '2d', { goalMm: [goalMm[0], goalMm[1], goalMm[2]] });
      setPlanResult(r as any);
      setMsg('矫正路径规划已生成');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '规划失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">术后规划</h1>
        <p className="page-description">二级：二维术后规划</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-medical-border pb-2">
        {STEPS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded px-3 py-1.5 text-sm ${step === i ? 'bg-medical-primary text-white' : 'bg-medical-surface'}`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="card-medical">
          <h3 className="font-medium">术后影像导入</h3>
          <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="input-field mt-2 max-w-md">
            <option value="">请选择病例</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.patient?.name ?? c.id}</option>)}
          </select>
          <p className="mt-2 text-sm text-medical-muted">上传术后正侧位 X 光片</p>
          <input type="file" accept=".jpg,.jpeg,.png" onChange={handleUpload} disabled={loading} className="mt-2 block text-sm" />
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      {step === 1 && (
        <div className="card-medical">
          <h3 className="font-medium">畸形相关测量分析</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { key: 'anklePlantarflexion', label: '踝关节跖屈角度' },
              { key: 'footEversion', label: '足内外翻角度' },
              { key: 'calcanealForceLine', label: '跟骨力线' },
              { key: 'calcanealEversion', label: '跟骨内外翻角度' },
              { key: 'archHeight', label: '足弓高度 (mm)' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm">{label}</label>
                <input
                  type="number"
                  value={measureValues[key] ?? 0}
                  onChange={(e) => setMeasureValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
                  className="input-field mt-0.5 w-32"
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={handleSaveMeasurement} disabled={loading} className="btn-primary mt-4">
            保存测量数据
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="card-medical">
          <h3 className="font-medium">提取矫正部位</h3>
          <p className="mt-1 text-sm text-medical-muted">利用 SAM 分割提取矫正部位骨骼轮廓</p>
          <p className="mt-2 text-sm text-medical-muted">请在病例详情 2D 工作台中使用分割工具</p>
        </div>
      )}

      {step === 3 && (
        <div className="card-medical">
          <h3 className="font-medium">矫正数据输入</h3>
          <p className="mt-1 text-sm text-medical-muted">目标位移量 (mm)</p>
          <div className="mt-2 flex gap-2">
            <input type="number" value={goalMm[0]} onChange={(e) => setGoalMm(([_, y, z]) => [Number(e.target.value), y, z])} className="input-field w-24" placeholder="X" />
            <input type="number" value={goalMm[1]} onChange={(e) => setGoalMm(([x, _, z]) => [x, Number(e.target.value), z])} className="input-field w-24" placeholder="Y" />
            <input type="number" value={goalMm[2]} onChange={(e) => setGoalMm(([x, y, _]) => [x, y, Number(e.target.value)])} className="input-field w-24" placeholder="Z" />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card-medical">
          <h3 className="font-medium">矫正路径规划</h3>
          <p className="mt-1 text-sm text-medical-muted">根据目标位移使用内置 A* 算法生成整体方案</p>
          <button type="button" onClick={handleTriggerPlan} disabled={loading} className="btn-primary mt-3">
            {loading ? '规划中…' : '生成矫正方案'}
          </button>
          {planResult && (
            <p className="mt-2 text-sm">
              总天数: {planResult.totalDays ?? '—'}，总距离: {planResult.totalDistance ?? '—'} mm
            </p>
          )}
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      <div className="mt-6">
        <Link href="/dashboard/postop/3d" className="text-sm text-medical-primary hover:underline">
          切换到三维术后规划 →
        </Link>
      </div>
    </div>
  );
}
