'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getInstrumentsRings,
  getInstrumentsRods,
  getInstrumentsCombinations,
  createInstrumentRing,
  createInstrumentRod,
  createInstrumentCombination,
  updateInstrumentRing,
  updateInstrumentRod,
  updateInstrumentCombination,
} from '@/lib/api';
import { RingArt, RodArt, HexapodArt } from '@/components/InstrumentArt';

type Ring = { id: string; name: string; code: string; diameterMm?: number };
type Rod = { id: string; name: string; code: string; lengthMm?: number };
type Combo = { id: string; name: string; code: string; ringRefIds?: string[]; rodRefIds?: string[] };

// 预设规格（参照泰勒架/Ilizarov 常见规格；刻度统一 1 刻度 = 1mm）
const RING_PRESETS = [
  { name: '155 环形圈', code: '155环形圈', diameterMm: 155 },
  { name: '180 环形圈', code: '180环形圈', diameterMm: 180 },
  { name: '200 环形圈', code: '200环形圈', diameterMm: 200 },
];
const ROD_PRESETS = [
  { name: '120 双套连杆', code: '120双套连杆', lengthMm: 120 },
  { name: '155 双套连杆', code: '155双套连杆', lengthMm: 155 },
  { name: '180 双套连杆', code: '180双套连杆', lengthMm: 180 },
  { name: '240 双套连杆', code: '240双套连杆', lengthMm: 240 },
];

export default function InstrumentsPage() {
  const [tab, setTab] = useState<'maintain' | 'add' | 'params'>('maintain');
  const [rings, setRings] = useState<Ring[]>([]);
  const [rods, setRods] = useState<Rod[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getInstrumentsRings(false), getInstrumentsRods(false), getInstrumentsCombinations(false)])
      .then(([r, d, c]) => {
        setRings(Array.isArray(r) ? (r as Ring[]) : []);
        setRods(Array.isArray(d) ? (d as Rod[]) : []);
        setCombos(Array.isArray(c) ? (c as Combo[]) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(''), 3500);
  };

  // ---- 新增表单状态 ----
  const [ring, setRing] = useState({ name: '', code: '', diameterMm: 180 });
  const [rod, setRod] = useState({ name: '', code: '', lengthMm: 155 });
  const [combo, setCombo] = useState<{ name: string; code: string; ringRefIds: string[]; rodRefIds: string[] }>({
    name: '',
    code: '',
    ringRefIds: [],
    rodRefIds: [],
  });

  async function submitRing(payload: { name: string; code: string; diameterMm?: number }) {
    if (!payload.name || !payload.code) return flash('请填写名称与编码');
    try {
      await createInstrumentRing(payload);
      flash(`已新增环形圈：${payload.name}`);
      load();
    } catch (e) {
      flash('新增失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function submitRod(payload: { name: string; code: string; lengthMm?: number }) {
    if (!payload.name || !payload.code) return flash('请填写名称与编码');
    try {
      await createInstrumentRod(payload);
      flash(`已新增连杆：${payload.name}`);
      load();
    } catch (e) {
      flash('新增失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function submitCombo() {
    if (!combo.name || !combo.code) return flash('请填写组合名称与编码');
    if (combo.ringRefIds.length === 0 || combo.rodRefIds.length === 0)
      return flash('请至少选择 1 个环与 1 根杆');
    try {
      await createInstrumentCombination(combo);
      flash(`已新增组合：${combo.name}`);
      setCombo({ name: '', code: '', ringRefIds: [], rodRefIds: [] });
      load();
    } catch (e) {
      flash('新增失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function deactivate(kind: 'ring' | 'rod' | 'combo', id: string) {
    try {
      if (kind === 'ring') await updateInstrumentRing(id, { isActive: false });
      else if (kind === 'rod') await updateInstrumentRod(id, { isActive: false });
      else await updateInstrumentCombination(id, { isActive: false });
      flash('已停用');
      load();
    } catch (e) {
      flash('操作失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  const toggleIn = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">器械管理</h1>
        <p className="page-description">环形圈、连杆与六杆组合（泰勒架）的查看、新增与刻度参数</p>
      </div>

      <div className="mb-5 flex gap-2 border-b border-medical-border pb-2">
        {([
          ['maintain', '器械运维'],
          ['add', '器械新增'],
          ['params', '预设刻度'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-medical-primary text-white shadow-sm' : 'bg-medical-surface text-medical-muted hover:bg-medical-border'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============ 器械运维：图示卡片 ============ */}
      {tab === 'maintain' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-lg border border-medical-border bg-card px-3 py-1.5">环形圈 <strong>{rings.length}</strong></span>
            <span className="rounded-lg border border-medical-border bg-card px-3 py-1.5">连杆 <strong>{rods.length}</strong></span>
            <span className="rounded-lg border border-medical-border bg-card px-3 py-1.5">组合 <strong>{combos.length}</strong></span>
          </div>

          {loading && <p className="text-sm text-medical-muted">加载中…</p>}

          {!loading && rings.length === 0 && rods.length === 0 && combos.length === 0 && (
            <div className="card-medical flex flex-col items-center gap-3 py-10 text-center">
              <HexapodArt size={120} />
              <p className="text-sm text-medical-muted">暂无器械数据。可在「预设刻度」一键导入标准规格，或在「器械新增」自定义添加。</p>
            </div>
          )}

          {rings.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">环形圈</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {rings.map((r) => (
                  <div key={r.id} className="card-medical flex flex-col items-center gap-2 py-4">
                    <RingArt size={84} />
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">{r.name}</p>
                      <p className="text-xs text-medical-muted">{r.code}{r.diameterMm != null ? ` · ⌀${r.diameterMm}mm` : ''}</p>
                    </div>
                    <button type="button" onClick={() => deactivate('ring', r.id)} className="text-xs text-medical-muted hover:text-red-500">停用</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {rods.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">连杆（1 刻度 = 1mm）</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rods.map((r) => (
                  <div key={r.id} className="card-medical flex items-center gap-3 py-3">
                    <RodArt width={130} height={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                      <p className="text-xs text-medical-muted">{r.code}{r.lengthMm != null ? ` · ${r.lengthMm}mm` : ''}</p>
                    </div>
                    <button type="button" onClick={() => deactivate('rod', r.id)} className="text-xs text-medical-muted hover:text-red-500">停用</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {combos.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">六杆组合（泰勒架）</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {combos.map((c) => (
                  <div key={c.id} className="card-medical flex flex-col items-center gap-2 py-4">
                    <HexapodArt size={104} />
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-medical-muted">
                        {c.code} · {c.ringRefIds?.length ?? 0}环/{c.rodRefIds?.length ?? 0}杆
                      </p>
                    </div>
                    <button type="button" onClick={() => deactivate('combo', c.id)} className="text-xs text-medical-muted hover:text-red-500">停用</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ============ 器械新增：真实表单 ============ */}
      {tab === 'add' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* 环 */}
          <div className="card-medical flex flex-col items-center gap-3">
            <RingArt size={96} />
            <h3 className="font-medium">新增环形圈</h3>
            <input className="input-field w-full" placeholder="名称，如 180 环形圈" value={ring.name} onChange={(e) => setRing({ ...ring, name: e.target.value })} />
            <input className="input-field w-full" placeholder="编码，如 180环形圈" value={ring.code} onChange={(e) => setRing({ ...ring, code: e.target.value })} />
            <label className="flex w-full items-center justify-between text-sm">直径 (mm)
              <input type="number" className="input-field ml-2 w-24" value={ring.diameterMm} onChange={(e) => setRing({ ...ring, diameterMm: Number(e.target.value) })} />
            </label>
            <button type="button" className="btn-primary w-full" onClick={() => submitRing(ring)}>新增环形圈</button>
          </div>

          {/* 杆 */}
          <div className="card-medical flex flex-col items-center gap-3">
            <RodArt width={150} height={48} />
            <h3 className="font-medium">新增连杆</h3>
            <input className="input-field w-full" placeholder="名称，如 155 双套连杆" value={rod.name} onChange={(e) => setRod({ ...rod, name: e.target.value })} />
            <input className="input-field w-full" placeholder="编码，如 155双套连杆" value={rod.code} onChange={(e) => setRod({ ...rod, code: e.target.value })} />
            <label className="flex w-full items-center justify-between text-sm">长度 (mm)
              <input type="number" className="input-field ml-2 w-24" value={rod.lengthMm} onChange={(e) => setRod({ ...rod, lengthMm: Number(e.target.value) })} />
            </label>
            <button type="button" className="btn-primary w-full" onClick={() => submitRod(rod)}>新增连杆</button>
          </div>

          {/* 组合 */}
          <div className="card-medical flex flex-col gap-3">
            <div className="flex items-center justify-center"><HexapodArt size={96} /></div>
            <h3 className="text-center font-medium">新增六杆组合</h3>
            <input className="input-field w-full" placeholder="组合名称，如 双环型" value={combo.name} onChange={(e) => setCombo({ ...combo, name: e.target.value })} />
            <input className="input-field w-full" placeholder="组合编码，如 双环型" value={combo.code} onChange={(e) => setCombo({ ...combo, code: e.target.value })} />
            <div>
              <p className="mb-1 text-xs font-medium text-medical-muted">选择环（可多选）</p>
              <div className="flex flex-wrap gap-1">
                {rings.length === 0 && <span className="text-xs text-medical-muted">先新增环</span>}
                {rings.map((r) => (
                  <button key={r.id} type="button" onClick={() => setCombo({ ...combo, ringRefIds: toggleIn(combo.ringRefIds, r.id) })}
                    className={`rounded border px-2 py-0.5 text-xs ${combo.ringRefIds.includes(r.id) ? 'border-medical-primary bg-medical-primary/10 text-medical-primary' : 'border-medical-border text-medical-muted'}`}>
                    {r.code}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-medical-muted">选择杆（六杆架通常选 6 根）</p>
              <div className="flex flex-wrap gap-1">
                {rods.length === 0 && <span className="text-xs text-medical-muted">先新增杆</span>}
                {rods.map((r) => (
                  <button key={r.id} type="button" onClick={() => setCombo({ ...combo, rodRefIds: toggleIn(combo.rodRefIds, r.id) })}
                    className={`rounded border px-2 py-0.5 text-xs ${combo.rodRefIds.includes(r.id) ? 'border-medical-primary bg-medical-primary/10 text-medical-primary' : 'border-medical-border text-medical-muted'}`}>
                    {r.code}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn-primary w-full" onClick={submitCombo}>新增组合</button>
          </div>
        </div>
      )}

      {/* ============ 预设刻度：参考 + 一键导入 ============ */}
      {tab === 'params' && (
        <div className="space-y-5">
          <div className="card-medical">
            <h3 className="font-medium">刻度规范</h3>
            <p className="mt-1 text-sm text-medical-muted">
              本系统连杆刻度统一为 <strong>1 刻度 = 1mm</strong>，不区分内/外刻度。临床牵伸（distraction）常用速率为
              <strong> 1mm/天</strong>，一般分 4 次完成（每次 0.25mm），以减少软组织牵拉痛与并发症。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <RodArt width={220} height={52} ticks={20} />
              <div className="text-xs text-medical-muted">
                <p>· 长刻度（每 5mm）：粗线</p>
                <p>· 短刻度（每 1mm）：细线</p>
                <p>· 两端球铰：连接环形圈万向节</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card-medical">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">环形圈预设</h3>
                <button type="button" className="btn-secondary text-xs"
                  onClick={async () => {
                    for (const p of RING_PRESETS) { try { await createInstrumentRing(p); } catch { /* 已存在则跳过 */ } }
                    flash('已导入环形圈预设'); load();
                  }}>一键导入</button>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-medical-muted"><th className="py-1">规格</th><th>直径</th><th>适用</th></tr></thead>
                <tbody>
                  <tr className="border-t border-medical-border"><td className="py-1">155</td><td>155mm</td><td className="text-medical-muted">儿童 / 细小骨段</td></tr>
                  <tr className="border-t border-medical-border"><td className="py-1">180</td><td>180mm</td><td className="text-medical-muted">成人常规</td></tr>
                  <tr className="border-t border-medical-border"><td className="py-1">200</td><td>200mm</td><td className="text-medical-muted">粗大肢段 / 水肿</td></tr>
                </tbody>
              </table>
            </div>

            <div className="card-medical">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">连杆预设</h3>
                <button type="button" className="btn-secondary text-xs"
                  onClick={async () => {
                    for (const p of ROD_PRESETS) { try { await createInstrumentRod(p); } catch { /* 已存在则跳过 */ } }
                    flash('已导入连杆预设'); load();
                  }}>一键导入</button>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-medical-muted"><th className="py-1">规格</th><th>长度</th><th>可调范围</th></tr></thead>
                <tbody>
                  <tr className="border-t border-medical-border"><td className="py-1">120</td><td>120mm</td><td className="text-medical-muted">短</td></tr>
                  <tr className="border-t border-medical-border"><td className="py-1">155</td><td>155mm</td><td className="text-medical-muted">中</td></tr>
                  <tr className="border-t border-medical-border"><td className="py-1">180</td><td>180mm</td><td className="text-medical-muted">中长</td></tr>
                  <tr className="border-t border-medical-border"><td className="py-1">240</td><td>240mm</td><td className="text-medical-muted">长</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {msg}
        </div>
      )}
    </div>
  );
}
