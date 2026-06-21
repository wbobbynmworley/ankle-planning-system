'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getPlan, getCase, downloadPlanPdf } from '@/lib/api';

export default function PdfPreviewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const caseId = params.id as string;
  const planId = searchParams.get('planId');
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<unknown>(null);
  const [planData, setPlanData] = useState<unknown>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!planId) {
        setError('缺少方案ID参数');
        setLoading(false);
        return;
      }
      try {
        const [caseResult, planResult] = await Promise.all([
          getCase(caseId),
          getPlan(planId),
        ]);
        setCaseData(caseResult);
        setPlanData(planResult);
        // 生成PDF预览URL
        const url = `/api/plans/${planId}/pdf`;
        setPdfUrl(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [caseId, planId]);

  async function handleDownloadPdf() {
    if (!planId) return;
    setPdfLoading(true);
    try {
      await downloadPlanPdf(planId);
    } catch (e) {
      alert(e instanceof Error ? e.message : '下载失败');
    } finally {
      setPdfLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Link href={`/dashboard/cases/${caseId}`} className="text-sm text-medical-primary hover:underline">
          ← 返回病例
        </Link>
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800">
          <p className="font-medium">加载失败</p>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const c = caseData as { id: string; patient?: { name: string }; doctor?: { name: string } } | null;
  const p = planData as { id: string; algoType?: string; totalDays?: number; totalDistance?: number } | null;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href={`/dashboard/cases/${caseId}`} className="text-sm text-medical-primary hover:underline">
            ← 返回病例
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">PDF 预览</h1>
          <p className="mt-1 text-sm text-medical-muted">
            病例 {c?.id} · 患者 {c?.patient?.name ?? '—'} · {p?.algoType === 'PLAN_3D' ? '3D' : '2D'}规划
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
          className="btn-primary rounded px-4 py-2"
        >
          {pdfLoading ? '生成中…' : '下载 PDF'}
        </button>
      </div>

      {/* PDF 预览区域 */}
      <div className="flex-1 rounded-lg border border-medical-border bg-white overflow-hidden">
        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            className="h-full w-full"
            title="PDF 预览"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-medical-muted">
            暂无 PDF 预览
          </div>
        )}
      </div>

      {/* 规划摘要信息 */}
      {p && (
        <div className="mt-4 rounded-lg border border-medical-border bg-card p-4">
          <h2 className="text-lg font-semibold text-foreground">规划摘要</h2>
          <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-medical-muted">方案类型：</span>
              <span>{p.algoType === 'PLAN_3D' ? '三维体素A*规划' : '二维双平面A*规划'}</span>
            </div>
            <div>
              <span className="text-medical-muted">总矫正天数：</span>
              <span>{p.totalDays ?? '—'} 天</span>
            </div>
            <div>
              <span className="text-medical-muted">总矫正距离：</span>
              <span>{p.totalDistance != null ? `${p.totalDistance.toFixed(3)} mm` : '—'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
