'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, Download, Calendar } from 'lucide-react';
import { getExecutionPlan } from '@/lib/api';

interface PlanData {
  caseId: string;
  patient: { name?: string; idNumber?: string };
  doctor: { name?: string };
  initialInstallation: {
    referenceRing: { model?: string };
    movingRing: { model?: string };
    rods: Array<{ model?: string; length: number; scale: number }>;
  };
  dailySteps: Array<{
    stepIndex: number;
    planTime: string;
    completed: boolean;
    actualSteps?: number;
  }>;
}

export default function ReportPage() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get('caseId');
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) {
      setLoading(false);
      return;
    }
    getExecutionPlan(caseId)
      .then((data) => setPlan(data as PlanData))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-medical-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-header">我的报告</h1>
          <p className="page-description">查看您的矫正治疗计划报告</p>
        </div>
      </div>

      {!caseId || !plan ? (
        <div className="card-medical text-center">
          <FileText className="mx-auto h-12 w-12 text-medical-muted opacity-50" />
          <p className="mt-4 text-medical-muted">请从"治疗中心"选择一个病例查看报告</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 基本信息 */}
          <div className="card-medical">
            <h3 className="mb-4 text-lg font-semibold">基本信息</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-medical-muted">患者</p>
                <p className="font-medium">{plan.patient?.name || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-medical-muted">负责医生</p>
                <p className="font-medium">{plan.doctor?.name || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-medical-muted">参考环</p>
                <p className="font-medium">{plan.initialInstallation?.referenceRing?.model || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-medical-muted">动环</p>
                <p className="font-medium">{plan.initialInstallation?.movingRing?.model || '—'}</p>
              </div>
            </div>
          </div>

          {/* 初始安装 */}
          <div className="card-medical">
            <h3 className="mb-4 text-lg font-semibold">初始安装情况</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plan.initialInstallation?.rods?.map((rod, i) => (
                <div key={i} className="rounded-lg border border-medical-border p-3">
                  <p className="text-sm text-medical-muted">杆 {i + 1}</p>
                  <p className="font-medium">{rod.model || '—'}</p>
                  <p className="text-sm text-medical-muted">长度: {rod.length}mm | 刻度: {rod.scale}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 治疗计划 */}
          <div className="card-medical overflow-hidden p-0">
            <div className="border-b border-medical-border px-6 py-4">
              <h3 className="text-lg font-semibold">治疗计划总览</h3>
              <p className="mt-1 text-sm text-medical-muted">
                共 {plan.dailySteps?.length || 0} 天矫正计划
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="table-medical w-full">
                <thead>
                  <tr>
                    <th>天</th>
                    <th>计划日期</th>
                    <th>状态</th>
                    <th>实际步数</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.dailySteps?.map((step) => (
                    <tr key={step.stepIndex}>
                      <td className="font-medium">第 {step.stepIndex} 天</td>
                      <td>{step.planTime?.slice(0, 10) || '—'}</td>
                      <td>
                        {step.completed ? (
                          <span className="badge-success">已完成</span>
                        ) : (
                          <span className="badge-muted">待执行</span>
                        )}
                      </td>
                      <td>{step.actualSteps != null ? `${step.actualSteps} 步` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
