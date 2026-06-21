'use client';

import { useEffect, useState } from 'react';
import { getPatientProgressOverview } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, CheckCircle, Clock, Activity } from 'lucide-react';

interface ChartDataPoint {
  day: number;
  planned: number;
  actual: number;
  date: string;
  completed: boolean;
}

interface PatientProgress {
  caseId: string;
  caseStatus: string;
  doctorName: string;
  planId: string;
  totalDays: number;
  completedDays: number;
  progressPercent: number;
  totalSteps: number;
  chartData: ChartDataPoint[];
  steps: Array<{
    stepIndex?: number;
    planTime?: string;
    completed?: boolean;
    actualSteps?: number;
  }>;
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<PatientProgress[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPatientProgressOverview()
      .then((data) => {
        const arr = Array.isArray(data) ? data as PatientProgress[] : [];
        setProgress(arr);
        if (arr.length > 0 && !selectedCaseId) {
          setSelectedCaseId(arr[0].caseId);
        }
      })
      .catch(() => setProgress([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = progress.find(p => p.caseId === selectedCaseId);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-medical-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="page-header">进度查看</h1>
        <p className="page-description">查看您的矫正治疗进度和完成情况</p>
      </div>

      {progress.length === 0 ? (
        <div className="card-medical text-center">
          <TrendingUp className="mx-auto h-12 w-12 text-medical-muted opacity-50" />
          <p className="mt-4 text-medical-muted">暂无治疗计划数据</p>
        </div>
      ) : (
        <>
          {/* 病例选择 */}
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {progress.map((p) => (
              <button
                key={p.caseId}
                onClick={() => setSelectedCaseId(p.caseId)}
                className={`shrink-0 rounded-lg border px-4 py-2 text-sm transition-all ${
                  selectedCaseId === p.caseId
                    ? 'border-medical-primary bg-medical-primary text-white'
                    : 'border-medical-border bg-white text-medical-muted hover:border-medical-primary/50'
                }`}
              >
                {p.doctorName}的病例
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-6">
              {/* 概览卡片 */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="card-medical">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-medical-primary-light">
                      <TrendingUp className="h-5 w-5 text-medical-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-medical-muted">总进度</p>
                      <p className="text-2xl font-semibold">{selected.progressPercent}%</p>
                    </div>
                  </div>
                </div>
                <div className="card-medical">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-medical-muted">已完成</p>
                      <p className="text-2xl font-semibold">{selected.completedDays}天</p>
                    </div>
                  </div>
                </div>
                <div className="card-medical">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                      <Clock className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-medical-muted">剩余</p>
                      <p className="text-2xl font-semibold">{selected.totalDays - selected.completedDays}天</p>
                    </div>
                  </div>
                </div>
                <div className="card-medical">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                      <Activity className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-medical-muted">累计步数</p>
                      <p className="text-2xl font-semibold">{selected.totalSteps}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 进度图表 */}
              <div className="card-medical">
                <h3 className="mb-4 text-lg font-semibold">步数对比图</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selected.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value, name) => [value, name === 'planned' ? '计划步数' : '实际步数']} />
                      <Legend formatter={(value) => (value === 'planned' ? '计划步数' : '实际步数')} />
                      <Bar dataKey="planned" fill="#0d9488" fillOpacity={0.3} radius={[4, 4, 0, 0]} name="计划步数" />
                      <Bar dataKey="actual" fill="#0d9488" radius={[4, 4, 0, 0]} name="实际步数" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 趋势线图 */}
              <div className="card-medical">
                <h3 className="mb-4 text-lg font-semibold">完成趋势</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selected.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value, name) => [value, name === 'planned' ? '计划步数' : '实际步数']} />
                      <Legend formatter={(value) => (value === 'planned' ? '计划步数' : '实际步数')} />
                      <Line type="monotone" dataKey="planned" stroke="#0d9488" strokeWidth={2} strokeDasharray="5 5" dot={false} name="计划步数" />
                      <Line type="monotone" dataKey="actual" stroke="#0d9488" strokeWidth={2} dot={{ fill: '#0d9488' }} name="实际步数" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
