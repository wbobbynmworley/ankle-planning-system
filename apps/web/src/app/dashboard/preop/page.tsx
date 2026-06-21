'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

const STEPS_2D = ['选择待规划病例', '比例球识别', '基本数据测量', '选择器械', '计算固定架预设刻度'];
const STEPS_3D = ['选择待规划病例', '二维映射', '比例球识别', '基本数据测量', '选择器械', '计算固定架预设刻度'];

export default function PreopWorkbenchPage() {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [step, setStep] = useState(0);
  const [tertiaryOpen, setTertiaryOpen] = useState(true);

  const [cases, setCases] = useState<{ id: string; patient?: { name?: string }; status: string }[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
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
  const [ratioBallResult, setRatioBallResult] = useState<{ center_px: [number, number]; diameter_px: number; diameter_mm: number; mm_per_px: number } | null>(null);
  const [ratioBallImgNaturalSize, setRatioBallImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [ratioBallImgNaturalSizes, setRatioBallImgNaturalSizes] = useState<{ front?: { w: number; h: number }; side?: { w: number; h: number } }>({});
  const [ratioBallImageKey, setRatioBallImageKey] = useState<'front' | 'side' | null>(null);
  const [mappedImages, setMappedImages] = useState<{ front?: string; side?: string }>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const steps = mode === '2d' ? STEPS_2D : STEPS_3D;
  const maxStep = steps.length - 1;
  const safeStep = Math.min(step, maxStep);

  useEffect(() => {
    getCasesForPlanning().then((d) => setCases(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRings().then((d) => setRings(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsRods().then((d) => setRods(Array.isArray(d) ? (d as any[]) : []));
    getInstrumentsCombinations().then((d) => setCombos(Array.isArray(d) ? (d as any[]) : []));
  }, []);

  useEffect(() => {
    setStep(0);
  }, [mode]);

  function onRatioBallFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRatioBallResult(null);
    setRatioBallImgNaturalSize(null);
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string)?.split(',')[1] ?? (reader.result as string);
      setRatioBallImage(b64);
    };
    reader.readAsDataURL(file);
  }

  async function handleRatioBall() {
    if (mode === '2d') {
      if (!ratioBallImage) { setMsg('请先上传含比例球的图片'); return; }
      setLoading(true); setMsg('');
      try {
        const r = await ratioBall({ image_base64: ratioBallImage });
        setMmPerPx(r.mm_per_px);
        setRatioBallResult({ center_px: r.center_px, diameter_px: r.diameter_px, diameter_mm: r.diameter_mm, mm_per_px: r.mm_per_px });
        setMsg(`比例球识别完成：${r.diameter_mm}mm，mm/px=${r.mm_per_px.toFixed(4)}`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : '识别失败');
      } finally { setLoading(false); return; }
    }
    const imgB64 = mappedImages.front ?? mappedImages.side ?? undefined;
    const imageKey = mappedImages.front ? 'front' : 'side';
    if (!imgB64) { setMsg('请先完成二维映射或上传含比例球的图片'); return; }
    setLoading(true); setMsg('');
    try {
      const r = await ratioBall({ image_base64: imgB64 });
      setRatioBallImageKey(imageKey);
      setRatioBallResult({ center_px: r.center_px, diameter_px: r.diameter_px, diameter_mm: r.diameter_mm, mm_per_px: r.mm_per_px });
      setMsg(`比例球识别：mm/px=${r.mm_per_px?.toFixed(4) ?? '—'}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '识别失败');
    } finally { setLoading(false); }
  }

  async function handleSaveMeasurement() {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      await createMeasurement({
        caseId: selectedCaseId,
        stage: mode === '2d' ? 'PREOP_2D' : 'PREOP_3D',
        values: measureValues,
      });
      setMsg('测量数据已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally { setLoading(false); }
  }

  async function handleStlTo2d() {
    if (!selectedCaseId) { setMsg('请先选择病例'); return; }
    setLoading(true); setMsg('');
    try {
      const r = await stlTo2d({ case_id: selectedCaseId });
      if (r.front_base64) setMappedImages((prev) => ({ ...prev, front: r.front_base64 }));
      if (r.side_base64) setMappedImages((prev) => ({ ...prev, side: r.side_base64 }));
      setMsg(r.error || '二维映射完成');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '映射失败');
    } finally { setLoading(false); }
  }

  async function handleCalculateScales() {
    if (!selectedCaseId) return;
    setLoading(true); setMsg('');
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
    } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-full">
      <main className="flex-1 overflow-auto p-6">
        <div className="mb-4">
          <h1 className="page-header">术前预案</h1>
          <p className="page-description">{mode === '2d' ? '二维术前预案' : '三维术前预案'} · {steps[safeStep]}</p>
        </div>

        {mode === '2d' && safeStep === 0 && (
          <div className="card-medical">
            <h3 className="font-medium">选择待规划病例</h3>
            <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="input-field mt-2 max-w-md">
              <option value="">请选择</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.patient?.name ?? c.id} - {c.status}</option>)}
            </select>
          </div>
        )}
        {mode === '3d' && safeStep === 0 && (
          <div className="card-medical">
            <h3 className="font-medium">选择待规划病例</h3>
            <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="input-field mt-2 max-w-md">
              <option value="">请选择</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.patient?.name ?? c.id}</option>)}
            </select>
          </div>
        )}

        {mode === '2d' && safeStep === 1 && (
          <div className="card-medical">
            <h3 className="font-medium">比例球识别</h3>
            <p className="mt-1 text-sm text-medical-muted">通过 YOLOv8 识别图中比例球，与 20mm 标准球对比得出 mm/px</p>
            <input type="file" accept=".jpg,.jpeg,.png" onChange={onRatioBallFile} className="mt-2 block text-sm" />
            {ratioBallImage && (
              <div className="relative mt-3 inline-block max-w-full">
                <img
                  src={`data:image/jpeg;base64,${ratioBallImage}`}
                  alt="比例球"
                  className="block max-h-80 w-auto rounded-lg border border-medical-border object-contain"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setRatioBallImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />
                {ratioBallResult && ratioBallImgNaturalSize && (
                  <svg
                    className="absolute left-0 top-0 h-full w-full pointer-events-none"
                    viewBox={`0 0 ${ratioBallImgNaturalSize.w} ${ratioBallImgNaturalSize.h}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <circle
                      cx={ratioBallResult.center_px[0]}
                      cy={ratioBallResult.center_px[1]}
                      r={ratioBallResult.diameter_px / 2}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={Math.max(2, ratioBallResult.diameter_px / 50)}
                    />
                    <circle cx={ratioBallResult.center_px[0]} cy={ratioBallResult.center_px[1]} r={4} fill="var(--primary)" />
                  </svg>
                )}
              </div>
            )}
            <button type="button" onClick={handleRatioBall} disabled={loading || !ratioBallImage} className="btn-primary mt-3">
              {loading ? '识别中…' : '识别比例球'}
            </button>
            {mmPerPx != null && <p className="mt-2 text-sm">当前 mm/px: {mmPerPx.toFixed(4)}</p>}
            {ratioBallResult && <p className="mt-1 text-sm text-medical-muted">圆心 (px): ({ratioBallResult.center_px[0].toFixed(0)}, {ratioBallResult.center_px[1].toFixed(0)})，直径 {ratioBallResult.diameter_mm} mm</p>}
            {msg && <p className="mt-2 text-sm text-medical-muted">{msg}</p>}
          </div>
        )}
        {mode === '3d' && safeStep === 1 && (
          <div className="card-medical">
            <h3 className="font-medium">二维映射</h3>
            <p className="mt-1 text-sm text-medical-muted">将三维 STL 视图映射为正位图、侧位图</p>
            <button type="button" onClick={handleStlTo2d} disabled={loading} className="btn-primary mt-3">
              {loading ? '映射中…' : '生成正侧位图'}
            </button>
            {mappedImages.front && <div className="mt-4"><p className="text-sm">正位图</p><img src={`data:image/png;base64,${mappedImages.front}`} alt="正位" className="max-h-64 object-contain" /></div>}
            {mappedImages.side && <div className="mt-2"><p className="text-sm">侧位图</p><img src={`data:image/png;base64,${mappedImages.side}`} alt="侧位" className="max-h-64 object-contain" /></div>}
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        )}
        {mode === '3d' && safeStep === 2 && (
          <div className="card-medical">
            <h3 className="font-medium">比例球识别</h3>
            <p className="mt-1 text-sm text-medical-muted">对二维映射得到的正位图或侧位图识别比例球</p>
            {(mappedImages.front || mappedImages.side) && (
              <div className="mt-3 flex flex-wrap gap-4">
                {(['front', 'side'] as const).map((key) => {
                  const b64 = key === 'front' ? mappedImages.front : mappedImages.side;
                  if (!b64) return null;
                  const isUsed = ratioBallImageKey === key && ratioBallResult;
                  const nat = ratioBallImgNaturalSizes[key];
                  return (
                    <div key={key} className="relative inline-block max-w-full">
                      <img
                        src={`data:image/png;base64,${b64}`}
                        alt={key === 'front' ? '正位' : '侧位'}
                        className="block max-h-64 w-auto rounded-lg border border-medical-border object-contain"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setRatioBallImgNaturalSizes((prev) => ({ ...prev, [key]: { w: img.naturalWidth, h: img.naturalHeight } }));
                        }}
                      />
                      {isUsed && ratioBallResult && nat && (
                        <svg
                          className="absolute left-0 top-0 h-full w-full pointer-events-none"
                          viewBox={`0 0 ${nat.w} ${nat.h}`}
                          preserveAspectRatio="xMidYMid meet"
                        >
                          <circle
                            cx={ratioBallResult.center_px[0]}
                            cy={ratioBallResult.center_px[1]}
                            r={ratioBallResult.diameter_px / 2}
                            fill="none"
                            stroke="var(--primary)"
                            strokeWidth={Math.max(2, ratioBallResult.diameter_px / 50)}
                          />
                          <circle cx={ratioBallResult.center_px[0]} cy={ratioBallResult.center_px[1]} r={4} fill="var(--primary)" />
                        </svg>
                      )}
                      <p className="mt-1 text-xs text-medical-muted">{key === 'front' ? '正位图' : '侧位图'}{isUsed ? ' · 已识别' : ''}</p>
                    </div>
                  );
                })}
              </div>
            )}
            <button type="button" onClick={handleRatioBall} disabled={loading} className="btn-primary mt-3">
              {loading ? '识别中…' : '识别比例球'}
            </button>
            {ratioBallResult && <p className="mt-2 text-sm">mm/px: {ratioBallResult.mm_per_px.toFixed(4)}，直径 {ratioBallResult.diameter_mm} mm，圆心 (px): ({ratioBallResult.center_px[0].toFixed(0)}, {ratioBallResult.center_px[1].toFixed(0)})</p>}
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        )}

        {(mode === '2d' && safeStep === 2) || (mode === '3d' && safeStep === 3) && (
          <div className="card-medical">
            <h3 className="font-medium">基本数据测量</h3>
            <p className="mt-1 text-sm text-medical-muted">踝关节跖屈角度、足内外翻角度、跟骨力线、跟骨内外翻角度、足弓高度（mm）</p>
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

        {(mode === '2d' && safeStep === 3) || (mode === '3d' && safeStep === 4) && (
          <div className="card-medical">
            <h3 className="font-medium">选择器械</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm">参考环</label>
                <select value={refRingId} onChange={(e) => setRefRingId(e.target.value)} className="input-field mt-1">
                  <option value="">请选择</option>
                  {rings.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
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
                  {rings.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm">1–6 号杆</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <select key={i} value={rodIds[i] ?? ''} onChange={(e) => setRodIds((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })} className="input-field w-36">
                      <option value="">请选择</option>
                      {rods.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                    </select>
                  ))}
                </div>
              </div>
              <p className="text-xs text-medical-muted">组合方式：{combos.map((c) => c.name).join('、')}</p>
            </div>
          </div>
        )}

        {(mode === '2d' && safeStep === 4) || (mode === '3d' && safeStep === 5) && (
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
              </div>
            )}
          </div>
        )}
      </main>

      <aside className="flex w-56 shrink-0 flex-col border-l border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
        <div className="border-b border-medical-border p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-medical-muted">术前预案</p>
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
