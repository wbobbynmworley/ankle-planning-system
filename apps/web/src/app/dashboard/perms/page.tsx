'use client';

import { useState, useEffect } from 'react';
import { getPermsRoles, getPermsFunction, setPermsFunction, getPermsData, setPermsData } from '@/lib/api';

export default function PermsPage() {
  const [tab, setTab] = useState<'roles' | 'function' | 'data'>('roles');
  const [roles, setRoles] = useState<{ role: string; label: string }[]>([]);
  const [funcPerms, setFuncPerms] = useState<{ role: string; resource: string; action: string; allowed: boolean }[]>([]);
  const [dataPerms, setDataPerms] = useState<{ role: string; scope: string; resource?: string }[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [dataScope, setDataScope] = useState('ALL');
  const [dataResource, setDataResource] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getPermsRoles().then((d) => setRoles(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (tab === 'function') {
      getPermsFunction(selectedRole || undefined).then((d) => setFuncPerms(Array.isArray(d) ? (d as any[]) : []));
    } else if (tab === 'data') {
      getPermsData(selectedRole || undefined).then((d) => setDataPerms(Array.isArray(d) ? (d as any[]) : []));
    }
  }, [tab, selectedRole]);

  async function handleSetFunction() {
    if (!selectedRole) return;
    setLoading(true);
    setMsg('');
    try {
      await setPermsFunction(selectedRole, funcPerms.map((p) => ({ resource: p.resource, action: p.action, allowed: p.allowed })));
      setMsg('功能权限已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetData() {
    if (!selectedRole) return;
    setLoading(true);
    setMsg('');
    try {
      await setPermsData(selectedRole, dataScope, dataResource || undefined);
      setMsg('数据权限已保存');
      getPermsData(selectedRole).then((d) => setDataPerms(Array.isArray(d) ? (d as any[]) : []));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">权限管理</h1>
        <p className="page-description">仅针对已注册角色：用户角色设置、功能权限设定、数据权限设定</p>
      </div>
      <div className="mb-4 flex gap-2 border-b border-medical-border pb-2">
        {(['roles', 'function', 'data'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-medical-primary text-white' : 'bg-medical-surface'}`}
          >
            {t === 'roles' && '用户角色设置'}
            {t === 'function' && '功能权限设定'}
            {t === 'data' && '数据权限设定'}
          </button>
        ))}
      </div>

      {tab === 'roles' && (
        <div className="card-medical">
          <h3 className="font-medium">角色列表</h3>
          <ul className="mt-2 list-disc pl-5">
            {roles.map((r) => (
              <li key={r.role}>{r.role} - {r.label}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'function' && (
        <div className="card-medical">
          <h3 className="font-medium">功能权限</h3>
          <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="input-field mt-2 w-40">
            <option value="">选择角色</option>
            {roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
          <p className="mt-2 text-sm text-medical-muted">当前权限条数: {funcPerms.length}</p>
          <button type="button" onClick={handleSetFunction} disabled={loading} className="btn-primary mt-3">
            保存功能权限
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}

      {tab === 'data' && (
        <div className="card-medical">
          <h3 className="font-medium">数据权限</h3>
          <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="input-field mt-2 w-40">
            <option value="">选择角色</option>
            {roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
          <div className="mt-3">
            <label className="block text-sm">范围</label>
            <select value={dataScope} onChange={(e) => setDataScope(e.target.value)} className="input-field mt-1 w-40">
              <option value="ALL">全部</option>
              <option value="OWN">本人</option>
              <option value="DEPT">科室</option>
            </select>
          </div>
          <div className="mt-2">
            <label className="block text-sm">资源（选填）</label>
            <input value={dataResource} onChange={(e) => setDataResource(e.target.value)} className="input-field mt-1 w-48" />
          </div>
          <button type="button" onClick={handleSetData} disabled={loading} className="btn-primary mt-3">
            保存数据权限
          </button>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>
      )}
    </div>
  );
}
