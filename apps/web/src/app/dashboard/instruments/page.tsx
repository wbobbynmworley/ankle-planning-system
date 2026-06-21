'use client';

import { useState, useEffect } from 'react';
import {
  getInstrumentsRings,
  getInstrumentsRods,
  getInstrumentsCombinations,
  api,
} from '@/lib/api';

type Ring = { id: string; name: string; code: string; diameterMm?: number };
type Rod = { id: string; name: string; code: string; lengthMm?: number };
type Combo = { id: string; name: string; code: string };

export default function InstrumentsPage() {
  const [tab, setTab] = useState<'add' | 'maintain' | 'params'>('add');
  const [rings, setRings] = useState<Ring[]>([]);
  const [rods, setRods] = useState<Rod[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      getInstrumentsRings(false),
      getInstrumentsRods(false),
      getInstrumentsCombinations(false),
    ])
      .then(([r, d, c]) => {
        setRings(Array.isArray(r) ? (r as Ring[]) : []);
        setRods(Array.isArray(d) ? (d as Rod[]) : []);
        setCombos(Array.isArray(c) ? (c as Combo[]) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">器械管理</h1>
        <p className="page-description">器械新增、器械运维、器械参数更新</p>
      </div>
      <div className="mb-4 flex gap-2 border-b border-medical-border pb-2">
        {(['add', 'maintain', 'params'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-medical-primary text-white' : 'bg-medical-surface'}`}
          >
            {t === 'add' && '器械新增'}
            {t === 'maintain' && '器械运维'}
            {t === 'params' && '器械参数更新'}
          </button>
        ))}
      </div>

      {tab === 'add' && (
        <div className="card-medical">
          <h3 className="font-medium">器械新增</h3>
          <p className="mt-1 text-sm text-medical-muted">通过 API 新增环、杆、组合方式（见后端 POST /instruments/rings、/rods、/combinations）</p>
          <p className="mt-2 text-sm">当前环: {rings.length} 个，杆: {rods.length} 个，组合: {combos.length} 个</p>
        </div>
      )}

      {tab === 'maintain' && (
        <div className="card-medical">
          <h3 className="font-medium">器械运维</h3>
          <p className="mt-1 text-sm text-medical-muted">查看与维护器械列表</p>
          {loading ? (
            <p className="mt-2 text-medical-muted">加载中…</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div>
                <h4 className="text-sm font-medium">环</h4>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {rings.map((r) => (
                    <li key={r.id}>{r.code} - {r.name} {r.diameterMm != null ? `(${r.diameterMm}mm)` : ''}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium">杆</h4>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {rods.map((r) => (
                    <li key={r.id}>{r.code} - {r.name} {r.lengthMm != null ? `(${r.lengthMm}mm)` : ''}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium">组合方式</h4>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {combos.map((c) => (
                    <li key={c.id}>{c.code} - {c.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'params' && (
        <div className="card-medical">
          <h3 className="font-medium">器械参数更新</h3>
          <p className="mt-1 text-sm text-medical-muted">通过 API PATCH /instruments/rings/:id、/rods/:id、/combinations/:id 更新参数</p>
          <p className="mt-2 text-sm">刻度统一为 1 刻度 = 1mm，无内/外刻度区分</p>
        </div>
      )}

      {msg && <p className="mt-4 text-sm">{msg}</p>}
    </div>
  );
}
