'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getCasesForPlanning, uploadFile, createMeasurement, triggerPlan } from '@/lib/api';

const STEPS_2D = ['术后影像导入', '畸形相关测量分析', '提取矫正部位', '矫正数据输入', '矫正路径规划'];
const STEPS_3D = ['术后影像导入', '二维映射', '畸形相关测量分析', '矫正数据输入', '矫正路径规划'];

export default function PostopWorkbenchPage() {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [step, setStep] = useState(0);
  const [tertiaryOpen, setTertiaryOpen] = useState(true);

  const [cases, setCases] = useState<{ id: string; patient?: { name?: string } }[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [measureValues, setMeasureValues] = useState<Record<string, number>>({
    anklePlantarflexion: 0,
    footEversion: 0,
    calcanealForceLine: 0,
    calcanealEversion: 0,
    archHeight: 0,
  });
  const [goalMm, setGoalMm] = useState<[number, number, number]>([0, 0, 0]);
  const [planResult, setPlanResult] = useState<{ totalDays?: number; totalDistance?: number; plan_total_days?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const steps = mode === '2d' ? STEPS_2D : STEPS_3D;
  const maxStep = steps.length - 1;
  const safeStep = Math.min(step, maxStep);

  useEffect(() => {
    getCasesForPlanning().then((d) => setCases(Array.isArray(d) ? (d as any[]) : []));
  }, []);

  useEffect(() => {
    setStep(0);
  }, [mode]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedCaseId) return;
    setLoading(true);
    try {
      await uploadFile(selectedCaseId, file, mode === '2d' ? 'FRONT' : 'STL');
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
      await createMeasurement({ caseId: selectedCaseId, stage: mode === '2d' ? 'POSTOP_2D' : 'POSTOP_3D', values: measureValues });
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
      const r = await triggerPlan(selectedCaseId, mode, { goalMm: [goalMm[0], goalMm[1], goalMm[2]] });
      setPlanResult(r as any);
      setMsg(mode === '2d' ? '矫正路径规划已生成' : '三维矫正路径规划已生成');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '规划失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full">
      <main className="flex-1 overflow-auto p-6">
        <div className="mb-4">
          <h1 className="page-header">术后规划</h1>
          <p className="page-description">{mode === '2d' ? '二维术后规划' : '三维术后规划'} · {steps[safeStep]}</p>
        </div>

        {safeStep === 0 && (
          <div className="card-medical">
            <h3 className="font-medium">术后影像导入</h3>
            <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="input-field mt-2 max-w-md">
              <option value="">请选择病例</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.patient?.name ?? c.id}</option>)}
            </select>
            <p className="mt-2 text-sm text-medical-muted">
              {mode === '2d' ? '上传术后正侧位 X 光片' : '上传术后 STL'}
            </p>
            <input type="file" accept={mode === '2d' ? '.jpg,.jpeg,.png' : '.stl'} onChange={handleUpload} disabled={loading} className="mt-2 block text-sm" />
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        )}

        {mode === '3d' && safeStep === 1 && (
          <div className="card-medical">
            <h3 className="font-medium">二维映射</h3>
            <p className="mt-1 text-sm text-medical-muted">将三维 STL 映射为正位图、侧位图（在术前 3D 或病例 3D 工作台完成）</p>
          </div>
        )}

        {(mode === '2d' && safeStep === 1) || (mode === '3d' && safeStep === 2) && (
          <div className="card-medical">
            <h3 className="font-medium">畸形相关测量分析</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[{ key: 'anklePlantarflexion', label: '踝关节跖屈角度' }, { key: 'footEversion', label: '足内外翻角度' }, { key: 'calcanealForceLine', label: '跟骨力线' }, { key: 'calcanealEversion', label: '跟骨内外翻角度' }, { key: 'archHeight', label: '足弓高度 (mm)' }].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm">{label}</label>
                  <input type="number" value={measureValues[key] ?? 0} onChange={(e) => setMeasureValues((v) => ({ ...v, [key]: Number(e.target.value) }))} className="input-field mt-0.5 w-32" />
                </div>
              ))}
            </div>
            <button type="button" onClick={handleSaveMeasurement} disabled={loading} className="btn-primary mt-4">保存测量数据</button>
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        )}

        {mode === '2d' && safeStep === 2 && (
          <div className="card-medical">
            <h3 className="font-medium">提取矫正部位</h3>
            <p className="mt-1 text-sm text-medical-muted">利用 SAM 分割提取矫正部位骨骼轮廓</p>
            <p className="mt-2 text-sm text-medical-muted">请在病例详情 2D 工作台中使用分割工具</p>
          </div>
        )}

        {(mode === '2d' && safeStep === 3) || (mode === '3d' && safeStep === 3) && (
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

        {safeStep === 4 && (
          <div className="card-medical">
            <h3 className="font-medium">矫正路径规划</h3>
            <p className="mt-1 text-sm text-medical-muted">{mode === '2d' ? '根据目标位移使用内置 A* 算法生成整体方案' : '三维 A* 算法生成整体方案'}</p>
            <button type="button" onClick={handleTriggerPlan} disabled={loading} className="btn-primary mt-3">
              {loading ? '规划中…' : '生成矫正方案'}
            </button>
            {planResult && (
              <p className="mt-2 text-sm">
                总天数: {planResult.totalDays ?? planResult.plan_total_days ?? '—'}
                {mode === '2d' && planResult.totalDistance != null && `，总距离: ${planResult.totalDistance} mm`}
              </p>
            )}
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        )}
      </main>

      <aside className="flex w-56 shrink-0 flex-col border-l border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
        <div className="border-b border-medical-border p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-medical-muted">术后规划</p>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              onClick={() => setMode('2d')}
              className={`flex-1 rounded px-2 py-1.5 text-sm ${mode === '2d' ? 'bg-medical-primary text-white' : 'bg-medical-surface text-medical-muted hover:bg-medical-border'}`}
            >
              二维
            </button>
            <button
              type="button"
              onClick={() => setMode('3d')}
              className={`flex-1 rounded px-2 py-1.5 text-sm ${mode === '3d' ? 'bg-medical-primary text-white' : 'bg-medical-surface text-medical-muted hover:bg-medical-border'}`}
            >
              三维
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => setTertiaryOpen(!tertiaryOpen)}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-medical-surface"
          >
            {tertiaryOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            步骤
          </button>
          {tertiaryOpen && (
            <ul className="mt-1 space-y-0.5">
              {steps.map((label, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${safeStep === i ? 'bg-medical-primary text-white' : 'text-medical-muted hover:bg-medical-surface hover:text-foreground'}`}
                  >
                    {i + 1}. {label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
