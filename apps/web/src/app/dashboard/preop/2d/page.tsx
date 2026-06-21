'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getCasesForPlanning,
  getInstrumentsRings,
  getInstrumentsRods,
  getInstrumentsCombinations,
  getMeasurements,
  createMeasurement,
  calculateScales,
  ratioBall,
} from '@/lib/api';

const STEPS = [
  '选择待规划病例',
  '比例球识别',
  '基本数据测量',
  '选择器械',
  '计算固定架预设刻度',
];

export default function Preop2DPage() {
  const [cases, setCases] = useState<{ id: string; patient?: { name?: string }; status: string }[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [step, setStep] = useState(0);
  const [rings, setRings] = useState<{ id: string; name: string; code: string }[]>([]);
  const [rods, setRods] = useState<{ id: string; name: string; code: string }[]>([]);
  const [combos, setCombos] = useState<{ id: string; name: string; code: string }[]>([]);
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
  const [mmPerPx, setMmPerPx] = useState<number | null>(null);
  const [ratioBallImage, setRatioBallImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getCasesForPlanning().then((d) => setCases(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRings().then((d) => setRings(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRods().then((d) => setRods(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsCombinations().then((d) => setCombos(Array.isArray(d) ? (d as any[]) : []));
  }, []);

  function onRatioBallFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string)?.split(',')[1] ?? (reader.result as string);
      setRatioBallImage(b64);
    };
    reader.readAsDataURL(file);
  }

  async function handleRatioBall() {
    if (!ratioBallImage) { setMsg('请先上传含比例球的图片'); return; }
    setLoading(true);
    setMsg('');
    try {
      const r = await ratioBall({ image_base64: ratioBallImage });
      setMmPerPx(r.mm_per_px);
      setMsg(`比例球识别完成：${r.diameter_mm}mm，mm/px=${r.mm_per_px.toFixed(4)}`);
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
      await createMeasurement({
        caseId: selectedCaseId,
        stage: 'PREOP_2D',
        values: measureValues,
      });
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
    setMsg('');
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
        <p className="page-description">二级：二维前预案 · 三级步骤</p>
      </div>
      <div className="mb-4 flex gap-2 border-b border-medical-border pb-2">
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
          <select
            value={selectedCaseId}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            className="input-field mt-2 max-w-md"
          >
            <option value="">请选择</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.patient?.name ?? c.id} - {c.status}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === 1 && (
        <div className="card-medical">
          <h3 className="font-medium">比例球识别</h3>
          <p className="mt-1 text-sm text-medical-muted">通过 YOLOv8 识别图中比例球，与 20mm 标准球对比得出 mm/px</p>
          <input type="file" accept=".jpg,.jpeg,.png" onChange={onRatioBallFile} className="mt-2 block text-sm" />
          <button type="button" onClick={handleRatioBall} disabled={loading || !ratioBallImage} className="btn-primary mt-3">
            {loading ? '识别中…' : '识别比例球'}
          </button>
          {mmPerPx != null && <p className="mt-2 text-sm">当前 mm/px: {mmPerPx.toFixed(4)}</p>}
          {msg && <p className="mt-2 text-sm text-medical-muted">{msg}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="card-medical">
          <h3 className="font-medium">基本数据测量</h3>
          <p className="mt-1 text-sm text-medical-muted">踝关节跖屈角度、足内外翻角度、跟骨力线、跟骨内外翻角度、足弓高度（mm）</p>
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

      {step === 3 && (
        <div className="card-medical">
          <h3 className="font-medium">选择器械</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm">参考环</label>
              <select value={refRingId} onChange={(e) => setRefRingId(e.target.value)} className="input-field mt-1">
                <option value="">请选择</option>
                {rings.map((r) => (
                  <option key={r.id} value={r.id}>{r.code}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm">旋转方向</label>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setRotationDir('内旋')} className={rotationDir === '内旋' ? 'btn-primary' : 'btn-secondary'}>内旋</button>
                <button type="button" onClick={() => setRotationDir('外旋')} className={rotationDir === '外旋' ? 'btn-primary' : 'btn-secondary'}>外旋</button>
              </div>
            </div>
            <div>
              <label className="block text-sm">旋转角度</label>
              <input type="number" value={rotationAngle} onChange={(e) => setRotationAngle(Number(e.target.value))} className="input-field mt-1 w-24" />
            </div>
            <div>
              <label className="block text-sm">动环</label>
              <select value={movRingId} onChange={(e) => setMovRingId(e.target.value)} className="input-field mt-1">
                <option value="">请选择</option>
                {rings.map((r) => (
                  <option key={r.id} value={r.id}>{r.code}</option>
                ))}
              </select>
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
                    {rods.map((r) => (
                      <option key={r.id} value={r.id}>{r.code}</option>
                    ))}
                  </select>
                ))}
              </div>
            </div>
            <p className="text-xs text-medical-muted">组合方式：{combos.map((c) => c.name).join('、')}</p>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card-medical">
          <h3 className="font-medium">计算固定架预设刻度</h3>
          <p className="mt-1 text-sm text-medical-muted">泰勒架公式 + 测量结果，六条杆刻度（1 刻度 = 1mm）</p>
          <button type="button" onClick={handleCalculateScales} disabled={loading} className="btn-primary mt-3">
            {loading ? '计算中…' : '计算六杆刻度'}
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
          {scaleResult && scaleResult.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="table-medical w-full">
                <thead>
                  <tr>
                    <th>杆号</th>
                    <th>刻度 (1=1mm)</th>
                    <th>杆长 (mm)</th>
                  </tr>
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
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <Link href="/dashboard/preop/3d" className="text-sm text-medical-primary hover:underline">
          切换到三维前期预案 →
        </Link>
      </div>
    </div>
  );
}
