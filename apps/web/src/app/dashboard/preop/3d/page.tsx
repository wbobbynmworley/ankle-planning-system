'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getCasesForPlanning,
  getInstrumentsRings,
  getInstrumentsRods,
  getInstrumentsCombinations,
  createMeasurement,
  calculateScales,
  ratioBall,
  stlTo2d,
} from '@/lib/api';

const STEPS = [
  '选择待规划病例',
  '二维映射',
  '比例球识别',
  '基本数据测量',
  '选择器械',
  '计算固定架预设刻度',
];

export default function Preop3DPage() {
  const [cases, setCases] = useState<{ id: string; patient?: { name?: string }; status: string }[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [step, setStep] = useState(0);
  const [rings, setRings] = useState<{ id: string; code: string }[]>([]);
  const [rods, setRods] = useState<{ id: string; code: string }[]>([]);
  const [combos, setCombos] = useState<{ id: string; name: string }[]>([]);
  const [refRingId, setRefRingId] = useState('');
  const [movRingId, setMovRingId] = useState('');
  const [rodIds, setRodIds] = useState<string[]>(Array(6).fill(''));
  const [rotationDir, setRotationDir] = useState<'内旋' | '外旋'>('内旋');
  const [rotationAngle, setRotationAngle] = useState(0);
  const [measureValues, setMeasureValues] = useState<Record<string, number>>({
    anklePlantarflexion: 0,
    footEversion: 0,
    calcanealForceLine: 0,
    calcanealEversion: 0,
    archHeight: 0,
  });
  const [scaleResult, setScaleResult] = useState<{ rodIndex: number; scale: number; lengthMm: number }[] | null>(null);
  const [mappedImages, setMappedImages] = useState<{ front?: string; side?: string }>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getCasesForPlanning().then((d) => setCases(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRings().then((d) => setRings(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRods().then((d) => setRods(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsCombinations().then((d) => setCombos(Array.isArray(d) ? (d as any[]) : []));
  }, []);

  async function handleStlTo2d() {
    if (!selectedCaseId) { setMsg('请先选择病例'); return; }
    setLoading(true);
    setMsg('');
    try {
      const r = await stlTo2d({ case_id: selectedCaseId });
      if (r.front_base64) setMappedImages((prev) => ({ ...prev, front: r.front_base64 }));
      if (r.side_base64) setMappedImages((prev) => ({ ...prev, side: r.side_base64 }));
      setMsg(r.error || '二维映射完成');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '映射失败（需提供 stl_paths）');
    } finally {
      setLoading(false);
    }
  }

  async function handleRatioBall() {
    setLoading(true);
    setMsg('');
    try {
      const r = await ratioBall({});
      setMsg(`比例球识别：mm/px=${r.mm_per_px?.toFixed(4) ?? '—'}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '识别失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMeasurement() {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      await createMeasurement({ caseId: selectedCaseId, stage: 'PREOP_3D', values: measureValues });
      setMsg('测量数据已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCalculateScales() {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      const res = await calculateScales({
        caseId: selectedCaseId,
        measurementSummary: measureValues,
        instrumentConfig: {
          referenceRingId: refRingId || undefined,
          movingRingId: movRingId || undefined,
          rotationDirection: rotationDir,
          rotationAngle,
          rodIds: rodIds.filter(Boolean),
        },
      });
      setScaleResult(res.rods);
      setMsg('六杆刻度已计算（1 刻度 = 1mm）');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '计算失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">术前预案</h1>
        <p className="page-description">二级：三维前期预案 · 三级步骤</p>
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
          <h3 className="font-medium">选择待规划病例</h3>
          <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="input-field mt-2 max-w-md">
            <option value="">请选择</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.patient?.name ?? c.id}</option>
            ))}
          </select>
        </div>
      )}

      {step === 1 && (
        <div className="card-medical">
          <h3 className="font-medium">二维映射</h3>
          <p className="mt-1 text-sm text-medical-muted">将三维 STL 视图映射为正位图、侧位图</p>
          <button type="button" onClick={handleStlTo2d} disabled={loading} className="btn-primary mt-3">
            {loading ? '映射中…' : '生成正侧位图'}
          </button>
          {mappedImages.front && (
            <div className="mt-4">
              <p className="text-sm">正位图</p>
              <img src={`data:image/png;base64,${mappedImages.front}`} alt="正位" className="max-h-64 object-contain" />
            </div>
          )}
          {mappedImages.side && (
            <div className="mt-2">
              <p className="text-sm">侧位图</p>
              <img src={`data:image/png;base64,${mappedImages.side}`} alt="侧位" className="max-h-64 object-contain" />
            </div>
          )}
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="card-medical">
          <h3 className="font-medium">比例球识别</h3>
          <button type="button" onClick={handleRatioBall} disabled={loading} className="btn-primary mt-2">
            {loading ? '识别中…' : '识别比例球'}
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      {step === 3 && (
        <div className="card-medical">
          <h3 className="font-medium">基本数据测量</h3>
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

      {step === 4 && (
        <div className="card-medical">
          <h3 className="font-medium">选择器械</h3>
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm">参考环</label>
              <select value={refRingId} onChange={(e) => setRefRingId(e.target.value)} className="input-field mt-1">
                <option value="">请选择</option>
                {rings.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm">动环</label>
              <select value={movRingId} onChange={(e) => setMovRingId(e.target.value)} className="input-field mt-1">
                <option value="">请选择</option>
                {rings.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm">旋转方向 / 角度</label>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setRotationDir('内旋')} className={rotationDir === '内旋' ? 'btn-primary' : 'btn-secondary'}>内旋</button>
                <button type="button" onClick={() => setRotationDir('外旋')} className={rotationDir === '外旋' ? 'btn-primary' : 'btn-secondary'}>外旋</button>
                <input type="number" value={rotationAngle} onChange={(e) => setRotationAngle(Number(e.target.value))} className="input-field w-20" />
              </div>
            </div>
            <div>
              <label className="block text-sm">1–6 号杆</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <select
                    key={i}
                    value={rodIds[i] ?? ''}
                    onChange={(e) => setRodIds((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                    className="input-field w-36"
                  >
                    <option value="">请选择</option>
                    {rods.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                  </select>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card-medical">
          <h3 className="font-medium">计算固定架预设刻度</h3>
          <button type="button" onClick={handleCalculateScales} disabled={loading} className="btn-primary mt-3">
            {loading ? '计算中…' : '计算六杆刻度'}
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
          {scaleResult && scaleResult.length > 0 && (
            <table className="table-medical mt-4 w-full">
              <thead>
                <tr><th>杆号</th><th>刻度 (1=1mm)</th><th>杆长 (mm)</th></tr>
              </thead>
              <tbody>
                {scaleResult.map((r) => (
                  <tr key={r.rodIndex}>
                    <td>{r.rodIndex} 号杆</td>
                    <td>{r.scale}</td>
                    <td>{r.lengthMm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="mt-6">
        <Link href="/dashboard/preop/2d" className="text-sm text-medical-primary hover:underline">
          ← 切换到二维前预案
        </Link>
      </div>
    </div>
  );
}
