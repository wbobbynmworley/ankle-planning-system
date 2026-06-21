'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerDoctor, registerPatient } from '@/lib/api';
import { BrandMark } from '@/components/BrandMark';

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<'doctor' | 'patient'>('doctor');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [doctorCode, setDoctorCode] = useState('');
  const [patientIdNumber, setPatientIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (role === 'doctor') {
        await registerDoctor({ email, password, name, doctorCode, phone: phone || undefined });
      } else {
        await registerPatient({
          email,
          password,
          name,
          patientIdNumber,
          phone: phone || undefined,
        });
      }
      router.push('/login');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-bg">
      <div className="auth-card max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size={44} />
          <div>
            <h1 className="text-xl font-semibold text-foreground">注册账号</h1>
            <p className="text-sm text-medical-muted">选择身份后填写信息</p>
          </div>
        </div>
        <div className="mb-4 flex rounded-lg border border-medical-border p-0.5">
          <button
            type="button"
            onClick={() => setRole('doctor')}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              role === 'doctor' ? 'bg-medical-primary text-white' : 'text-medical-muted hover:bg-medical-surface'
            }`}
          >
            医护人员
          </button>
          <button
            type="button"
            onClick={() => setRole('patient')}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              role === 'patient' ? 'bg-medical-primary text-white' : 'text-medical-muted hover:bg-medical-surface'
            }`}
          >
            患者
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground">邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field mt-1" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">密码（至少8位）</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field mt-1" minLength={8} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">姓名</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field mt-1" required />
          </div>
          {role === 'doctor' && (
            <div>
              <label className="block text-sm font-medium text-foreground">工号</label>
              <input type="text" value={doctorCode} onChange={(e) => setDoctorCode(e.target.value)} className="input-field mt-1" required />
            </div>
          )}
          {role === 'patient' && (
            <>
              <p className="text-xs text-medical-muted">患者注册仅为与系统数据对齐、便于检索；一名患者只能查看自己的规划报告。请使用医生建病历时登记的身份证号注册。</p>
              <div>
                <label className="block text-sm font-medium text-foreground">身份证号</label>
                <input type="text" value={patientIdNumber} onChange={(e) => setPatientIdNumber(e.target.value)} className="input-field mt-1" placeholder="与病历一致" required />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground">手机（选填）</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field mt-1" />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-medical-danger">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? '注册中…' : '注册'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-medical-muted">
          已有账号？{' '}
          <Link href="/login" className="font-medium text-medical-primary hover:text-medical-primary-hover">登录</Link>
        </p>
      </div>
    </main>
  );
}
