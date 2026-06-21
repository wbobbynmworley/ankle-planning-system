'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCase,
  getFiles,
  getPlans,
  getPlan,
  plan3dMulti,
  savePlan3d,
  downloadPlanPdf,
  downloadPlanPdf3d,
  deleteFile,
  validate3dCollision,
  getMeasurements,
} from '@/lib/api';
import { Workbench3DViewer } from '@/components/Workbench3D/Viewer';
import type { PoseTR } from '@/lib/pose3d';
import { formatPoseLabel } from '@/lib/pose3d';

type StlFile = { id: string; type: string; originalName?: string };

export default function Plan3DPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const caseId = params.id as string;
  const planId = searchParams.get('planId');
  const [caseData, setCaseData] = useState<unknown>(null);
  const [files, setFiles] = useState<StlFile[]>([]);
  const [plans, setPlans] = useState<unknown[]>([]);
  const [currentPlan, setCurrentPlan] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // CT3D: mesh state per file (pose = current/display, targetPose = target)
  const [meshStates, setMeshStates] = useState<Record<string, { pose: PoseTR; targetPose: PoseTR }>>({});
  const [refId, setRefId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stepMm, setStepMm] = useState(1.0);
  const [mouseRotateTarget, setMouseRotateTarget] = useState(false);
  const [showTargetWireframe, setShowTargetWireframe] = useState(true);
  const [hideNonRefOriginal, setHideNonRefOriginal] = useState(false);

  // 测量：两模型最小距离
  const [distanceInfo, setDistanceInfo] = useState('');
  // 校验目标碰撞结果（单独显示，避免用户看不到）
  const [validateResult, setValidateResult] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // F2.3: 测量历史记录
  const [measurementHistory, setMeasurementHistory] = useState<Array<{
    id: string;
    createdAt: string;
    values: Record<string, number | string>;
  }>>([]);
  const [measurementLoading, setMeasurementLoading] = useState(false);

  const loadMeasurementHistory = useCallback(async () => {
    setMeasurementLoading(true);
    try {
      const history = await getMeasurements(caseId, 'PREOP_3D');
      const list = Array.isArray(history) ? history : [];
      setMeasurementHistory(
        list.map((m: any) => ({
          id: m.id,
          createdAt: m.createdAt,
          values: (typeof m.values === 'object' && m.values !== null ? m.values : {}) as Record<string, number | string>,
        }))
      );
    } catch (e) {
      console.warn('加载测量历史失败', e);
    } finally {
      setMeasurementLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadMeasurementHistory();
  }, [loadMeasurementHistory]);

  // 规划：每日限制 + 生成结果 + 预览
  const [maxMmPerDay, setMaxMmPerDay] = useState(1.0);
  const [maxDegPerDay, setMaxDegPerDay] = useState(1.0);
  const [planText, setPlanText] = useState('');
  const [planPaths, setPlanPaths] = useState<Record<string, PoseTR[]>>({});
  const [planOffsets, setPlanOffsets] = useState<Record<string, number>>({});
  const [planSteps, setPlanSteps] = useState<Record<string, number>>({});
  const [planStartPoses, setPlanStartPoses] = useState<Record<string, PoseTR>>({});
  const [planGoalPoses, setPlanGoalPoses] = useState<Record<string, PoseTR>>({});
  const [planOrder, setPlanOrder] = useState<string[]>([]);
  const [planTotalDays, setPlanTotalDays] = useState(0);
  const [planTotalCost, setPlanTotalCost] = useState<number | null>(null);
  const [planDayIdx, setPlanDayIdx] = useState(0); // 预览天数索引，勿与 plan-2d 的 currentDay 混淆

  const stlFiles = useMemo(
    () => files.filter((f) => f.type === 'STL') as { id: string; originalName?: string }[],
    [files]
  );

  useEffect(() => {
    Promise.all([
      getCase(caseId)
        .then(setCaseData)
        .catch(() => router.push('/dashboard')),
      getFiles(caseId)
        .then((f) => setFiles(Array.isArray(f) ? (f as StlFile[]) : []))
        .catch(() => setFiles([])),
      getPlans(caseId)
        .then((p) => {
          const list = Array.isArray(p) ? p : [];
          setPlans(list);
          const plan3d = list.find((x: { algoType: string }) => x.algoType === 'PLAN_3D');
          if (planId) {
            getPlan(planId).then(setCurrentPlan).catch(() => setCurrentPlan(plan3d ?? null));
          } else {
            setCurrentPlan(plan3d ?? null);
          }
        })
        .catch(() => setPlans([])),
    ]).finally(() => setLoading(false));
  }, [caseId, planId, router]);

  // Initialize mesh state when STL list changes
  useEffect(() => {
    const identity: PoseTR = { t: [0, 0, 0], q: [1, 0, 0, 0] };
    setMeshStates((prev) => {
      const next = { ...prev };
      for (const f of stlFiles) {
        if (!next[f.id]) {
          next[f.id] = { pose: { ...identity }, targetPose: { ...identity } };
        }
      }
      return next;
    });
  }, [JSON.stringify(stlFiles.map((f) => f.id))]);

  // 从数据库已保存的 3D 方案恢复：参考件、矫正后位姿、按天规划数据
  useEffect(() => {
    const plan = currentPlan as {
      algoType?: string;
      meta?: {
        refId?: string;
        finalPoses?: Record<string, { t: number[]; q: number[] }>;
        planPaths?: Record<string, Array<{ t: number[]; q: number[] }>>;
        planOffsets?: Record<string, number>;
        planSteps?: Record<string, number>;
        planOrder?: string[];
        planStartPoses?: Record<string, { t: number[]; q: number[] }>;
        planGoalPoses?: Record<string, { t: number[]; q: number[] }>;
      };
      totalDays?: number;
      totalDistance?: number;
      dailySteps?: unknown[];
    } | null;
    if (!plan || plan.algoType !== 'PLAN_3D' || !plan.meta || stlFiles.length === 0) return;
    const { refId: savedRefId, finalPoses, planPaths: savedPaths, planOffsets: savedOffsets, planSteps: savedSteps, planOrder: savedOrder, planStartPoses: savedStart, planGoalPoses: savedGoal } = plan.meta;
    if (savedRefId) setRefId(savedRefId);
    if (finalPoses && typeof finalPoses === 'object') {
      setMeshStates((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(finalPoses)) {
          const p = finalPoses[id];
          if (!p || !Array.isArray(p.t) || !Array.isArray(p.q)) continue;
          const pose: PoseTR = {
            t: [p.t[0] ?? 0, p.t[1] ?? 0, p.t[2] ?? 0],
            q: [p.q[0] ?? 1, p.q[1] ?? 0, p.q[2] ?? 0, p.q[3] ?? 0],
          };
          if (next[id]) next[id] = { pose, targetPose: pose };
          else next[id] = { pose, targetPose: pose };
        }
        return next;
      });
    }
    if (savedPaths && savedOffsets && savedSteps && savedOrder && savedStart && savedGoal) {
      const paths: Record<string, PoseTR[]> = {};
      for (const [id, arr] of Object.entries(savedPaths)) {
        if (!Array.isArray(arr)) continue;
        paths[id] = arr.map((x) => ({
          t: [x.t[0] ?? 0, x.t[1] ?? 0, x.t[2] ?? 0] as [number, number, number],
          q: [x.q[0] ?? 1, x.q[1] ?? 0, x.q[2] ?? 0, x.q[3] ?? 0] as [number, number, number, number],
        }));
      }
      setPlanPaths(paths);
      setPlanOffsets(savedOffsets);
      setPlanSteps(savedSteps);
      setPlanOrder(savedOrder);
      const startP: Record<string, PoseTR> = {};
      const goalP: Record<string, PoseTR> = {};
      for (const [id, p] of Object.entries(savedStart)) {
        if (p && Array.isArray(p.t) && Array.isArray(p.q))
          startP[id] = { t: [p.t[0], p.t[1], p.t[2]] as [number, number, number], q: [p.q[0], p.q[1], p.q[2], p.q[3]] as [number, number, number, number] };
      }
      for (const [id, p] of Object.entries(savedGoal)) {
        if (p && Array.isArray(p.t) && Array.isArray(p.q))
          goalP[id] = { t: [p.t[0], p.t[1], p.t[2]] as [number, number, number], q: [p.q[0], p.q[1], p.q[2], p.q[3]] as [number, number, number, number] };
      }
      setPlanStartPoses(startP);
      setPlanGoalPoses(goalP);
      setPlanTotalDays(plan.totalDays ?? 0);
      setPlanTotalCost(plan.totalDistance != null ? plan.totalDistance : null);
      setPlanDayIdx(0);
      setPlanText(
        `已加载已保存方案。参考件：${savedRefId ?? '—'}，总天数：${plan.totalDays ?? 0}。`
      );
    }
  }, [currentPlan, stlFiles.length]);

  const poses = useMemo(() => {
    const p: Record<string, PoseTR> = {};
    const hasPlan = Object.keys(planPaths).length > 0;
    if (hasPlan && planTotalDays >= 0) {
      for (const id of Object.keys(meshStates)) {
        if (planPaths[id]) {
          const offset = planOffsets[id] ?? 0;
          const steps = planSteps[id] ?? 0;
          if (planDayIdx < offset) {
            p[id] = planStartPoses[id] ?? meshStates[id]?.pose ?? { t: [0, 0, 0], q: [1, 0, 0, 0] };
          } else if (planDayIdx > offset + steps) {
            p[id] = planGoalPoses[id] ?? meshStates[id]?.targetPose ?? { t: [0, 0, 0], q: [1, 0, 0, 0] };
          } else {
            const path = planPaths[id]!;
            p[id] = path[planDayIdx - offset] ?? path[path.length - 1]!;
          }
        } else {
          p[id] = planStartPoses[id] ?? meshStates[id]?.pose ?? { t: [0, 0, 0], q: [1, 0, 0, 0] };
        }
      }
    } else {
      for (const id of Object.keys(meshStates)) {
        p[id] = meshStates[id]!.pose;
      }
    }
    return p;
  }, [meshStates, planPaths, planOffsets, planSteps, planStartPoses, planGoalPoses, planDayIdx, planTotalDays]);

  const targetPoses = useMemo(() => {
    const p: Record<string, PoseTR> = {};
    for (const id of Object.keys(meshStates)) {
      p[id] = meshStates[id]!.targetPose;
    }
    return p;
  }, [meshStates]);

  /** 按天规划长表格（与 2D 源代码格式一致）：日序 | 骨(id) | 位姿(x,y,z) mm | 当日平移 mm | 累计平移 mm | 当日旋转 ° */
  const { dailyTableText, dailySteps3D } = useMemo(() => {
    const rows: Array<{
      dayIndex: number;
      boneId: string;
      boneName: string;
      poseMm: [number, number, number];
      deltaMm: number;
      cumulativeMm: number;
      rotDeg: number;
    }> = [];
    const norm = (a: [number, number, number], b: [number, number, number]) =>
      Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    const rotDeltaDeg = (
      q0: [number, number, number, number],
      q1: [number, number, number, number],
    ): number => {
      let dot = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3];
      if (dot < 0) dot = -dot;
      dot = Math.max(-1, Math.min(1, dot));
      const ang = 2 * Math.acos(dot);
      return (ang * 180) / Math.PI;
    };
    for (const boneId of planOrder) {
      const path = planPaths[boneId];
      const offset = planOffsets[boneId] ?? 0;
      const steps = planSteps[boneId] ?? 0;
      if (!path || path.length === 0) continue;
      // 统一使用 STL id（英文+数字），避免中文文件名在不同编码/字体下出现乱码
      const boneName = boneId;
      let cum = 0;
      let prevT: [number, number, number] = [path[0]!.t[0], path[0]!.t[1], path[0]!.t[2]];
      let prevQ: [number, number, number, number] = [
        path[0]!.q[0],
        path[0]!.q[1],
        path[0]!.q[2],
        path[0]!.q[3],
      ];
      for (let i = 0; i <= steps; i++) {
        const dayIdx = offset + i;
        const pose = path[i] ?? path[path.length - 1]!;
        const t: [number, number, number] = [pose.t[0], pose.t[1], pose.t[2]];
        const q: [number, number, number, number] = [
          pose.q[0],
          pose.q[1],
          pose.q[2],
          pose.q[3],
        ];
        const delta = i === 0 ? 0 : norm(t, prevT);
        const rotDeg = i === 0 ? 0 : rotDeltaDeg(prevQ, q);
        cum += delta;
        prevT = t;
        prevQ = q;
        rows.push({
          dayIndex: dayIdx,
          boneId,
          boneName,
          poseMm: t,
          deltaMm: delta,
          cumulativeMm: cum,
          rotDeg,
        });
      }
    }
    rows.sort((a, b) => a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : planOrder.indexOf(a.boneId) - planOrder.indexOf(b.boneId));
    const header = '日序 | 骨(id) | 位姿 (x,y,z) mm | 当日平移 mm | 累计平移 mm | 当日旋转 °';
    const lines = [header, '--------------------------------------------------------------------------------'];
    for (const r of rows) {
      lines.push(
        `${String(r.dayIndex).padStart(4, ' ')} | ${r.boneName
          .slice(0, 12)
          .padEnd(12, ' ')} | (${r.poseMm[0].toFixed(3)}, ${r.poseMm[1].toFixed(3)}, ${r.poseMm[2].toFixed(
          3,
        )}) | ${r.deltaMm.toFixed(3).padStart(8, ' ')} | ${r.cumulativeMm
          .toFixed(3)
          .padStart(8, ' ')} | ${r.rotDeg.toFixed(3).padStart(8, ' ')}`
      );
    }
    const dailySteps3D = rows.map((r) => ({
      dayIndex: r.dayIndex,
      boneId: r.boneId,
      boneName: r.boneName,
      poseMm: r.poseMm,
      deltaMm: r.deltaMm,
      cumulativeMm: r.cumulativeMm,
      rotDeg: r.rotDeg,
    }));
    return { dailyTableText: lines.join('\n'), dailySteps3D };
  }, [planPaths, planOffsets, planSteps, planOrder, stlFiles]);

  const handleRemoveSelected = useCallback(async () => {
    if (selectedIds.length === 0) {
      setStatusMsg('请先选择要删除的文件。');
      return;
    }
    try {
      for (const id of selectedIds) {
        await deleteFile(id);
      }
      const list = await getFiles(caseId);
      setFiles(Array.isArray(list) ? (list as StlFile[]) : []);
      setSelectedIds([]);
      if (refId && selectedIds.includes(refId)) setRefId(null);
      setStatusMsg('已删除所选文件。');
    } catch (e) {
      setStatusMsg('删除失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }, [caseId, selectedIds, refId]);

  const handleClearAll = useCallback(() => {
    setRefId(null);
    setSelectedIds([]);
    setPlanPaths({});
    setPlanOffsets({});
    setPlanSteps({});
    setPlanStartPoses({});
    setPlanGoalPoses({});
    setPlanOrder([]);
    setPlanTotalDays(0);
    setPlanTotalCost(null);
    setPlanDayIdx(0);
    setPlanText('');
    setDistanceInfo('');
    setValidateResult(null);
    setMouseRotateTarget(false);
    setStatusMsg('已清空参考与规划。');
  }, []);

  const handleSetRef = useCallback(() => {
    if (selectedIds.length !== 1) {
      setStatusMsg('请选择 1 个模型作为参考。');
      return;
    }
    setRefId(selectedIds[0]!);
    setStatusMsg('已设为参考件。');
  }, [selectedIds]);

  const handleClearRef = useCallback(() => {
    setRefId(null);
    setStatusMsg('已清除参考。');
  }, []);

  const moveTargetSelected = useCallback(
    (dx: number, dy: number, dz: number) => {
      if (selectedIds.length !== 1) {
        setStatusMsg('请选择且仅选择 1 个模型来移动目标。');
        return;
      }
      const id = selectedIds[0]!;
      if (id === refId) {
        setStatusMsg('参考模型固定，无法移动。');
        return;
      }
      setMeshStates((prev) => {
        const s = prev[id];
        if (!s) return prev;
        const [x, y, z] = s.targetPose.t;
        return {
          ...prev,
          [id]: {
            ...s,
            targetPose: {
              ...s.targetPose,
              t: [x + dx * stepMm, y + dy * stepMm, z + dz * stepMm],
            },
          },
        };
      });
    },
    [selectedIds, refId, stepMm]
  );

  const resetTargetPose = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0]!;
    if (id === refId) {
      setStatusMsg('参考模型固定，无法重置。');
      return;
    }
    setMeshStates((prev) => {
      const s = prev[id];
      if (!s) return prev;
      return {
        ...prev,
        [id]: {
          ...s,
          targetPose: { t: [...s.pose.t], q: [...s.pose.q] },
        },
      };
    });
    setStatusMsg('已重置目标位姿。');
  }, [selectedIds, refId]);

  const handleTargetPoseChange = useCallback((id: string, pose: PoseTR) => {
    setMeshStates((prev) => {
      const s = prev[id];
      if (!s) return prev;
      return { ...prev, [id]: { ...s, targetPose: pose } };
    });
  }, []);

  const toggleMouseRotate = useCallback(() => {
    if (selectedIds.length !== 1) {
      setStatusMsg('在鼠标旋转前请选择 1 个模型。');
      return;
    }
    if (selectedIds[0] === refId) {
      setStatusMsg('参考模型固定，无法旋转。');
      return;
    }
    setMouseRotateTarget((v) => !v);
  }, [selectedIds, refId]);

  // 校验目标碰撞：与 CT3D 一致，调用后端 VTK 三角形级精确碰撞（先包围盒快速排除，再 CollisionDetectionFilter）
  const validateTargets = useCallback(async () => {
    const sorted = [...stlFiles].sort((a, b) => a.id.localeCompare(b.id));
    if (sorted.length < 2) {
      const msg = '请先导入至少 2 个 STL。';
      setValidateResult(msg);
      setStatusMsg(msg);
      alert(msg);
      return;
    }
    setValidating(true);
    setValidateResult(null);
    try {
      const targetPoses = sorted.map((f) => {
        const s = meshStates[f.id];
        const pose = s?.targetPose ?? { t: [0, 0, 0] as [number, number, number], q: [1, 0, 0, 0] as [number, number, number, number] };
        return { t: pose.t, q: pose.q };
      });
      const { collisions } = await validate3dCollision(caseId, targetPoses);
      if (collisions.length === 0) {
        const msg = '目标位姿无碰撞（三角形级精确校验）。';
        setValidateResult(msg);
        setStatusMsg(msg);
        alert(msg);
      } else {
        const names = collisions.map(([i, j]) => `· ${sorted[i]?.originalName ?? sorted[i]?.id ?? i} 与 ${sorted[j]?.originalName ?? sorted[j]?.id ?? j}`);
        const msg = '检测到目标碰撞：\n' + names.join('\n');
        setValidateResult(msg);
        setStatusMsg(msg);
        alert('检测到目标碰撞！\n\n' + names.join('\n'));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setValidateResult('校验失败：' + errMsg);
      setStatusMsg(errMsg);
      alert('校验失败：' + errMsg);
    } finally {
      setValidating(false);
    }
  }, [caseId, stlFiles, meshStates]);

  // 测量：两模型最小距离（需选 2 个；这里用两质心距离近似，与 CT3D 的精确最小距离对应）
  const calcDistance = useCallback(() => {
    if (selectedIds.length !== 2) {
      setStatusMsg('请选择 2 个模型。');
      return;
    }
    const [aId, bId] = selectedIds;
    const pa = meshStates[aId!]?.pose.t ?? [0, 0, 0];
    const pb = meshStates[bId!]?.pose.t ?? [0, 0, 0];
    const dx = pb[0]! - pa[0]!;
    const dy = pb[1]! - pa[1]!;
    const dz = pb[2]! - pa[2]!;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    setDistanceInfo(
      `模型A：${aId}\n模型B：${bId}\n\n最小距离（质心）≈ ${d.toFixed(4)} mm\n\ndx=${dx.toFixed(4)} dy=${dy.toFixed(4)} dz=${dz.toFixed(4)}\n右=${Math.max(0, dx).toFixed(4)} 左=${Math.max(0, -dx).toFixed(4)} 前=${Math.max(0, dy).toFixed(4)} 后=${Math.max(0, -dy).toFixed(4)}\n上=${Math.max(0, dz).toFixed(4)} 下=${Math.max(0, -dz).toFixed(4)}`
    );
  }, [selectedIds, meshStates]);

  const generatePlan = useCallback(async () => {
    if (!refId) {
      setStatusMsg('请先设置参考模型。');
      return;
    }
    if (!stlFiles.some((f) => f.id === refId)) {
      setStatusMsg('参考模型已不存在。');
      return;
    }
    const movingIds = stlFiles.filter((f) => f.id !== refId).map((f) => f.id);
    if (movingIds.length === 0) {
      setStatusMsg('没有可移动模型（已排除参考）。');
      return;
    }
    setPlanning(true);
    setStatusMsg('体素 A* 多骨规划中…');
    try {
      const sorted = [...stlFiles].sort((a, b) => a.id.localeCompare(b.id));
      const identity = { t: [0, 0, 0] as [number, number, number], q: [1, 0, 0, 0] as [number, number, number, number] };
      const startPoses = sorted.map((f) => {
        const s = meshStates[f.id]?.pose ?? identity;
        return { t: [...(s.t ?? [0, 0, 0])], q: [...(s.q ?? [1, 0, 0, 0])] };
      });
      const targetPoses = sorted.map((f) => {
        const s = meshStates[f.id]?.targetPose ?? identity;
        return { t: [...(s.t ?? [0, 0, 0])], q: [...(s.q ?? [1, 0, 0, 0])] };
      });
      const res = await plan3dMulti(caseId, refId, startPoses, targetPoses, {
        max_mm: maxMmPerDay,
        max_deg: maxDegPerDay,
      });
      const idxToId = Object.fromEntries(sorted.map((f, i) => [String(i), f.id]));
      const planPathsById: Record<string, PoseTR[]> = {};
      for (const [idx, path] of Object.entries(res.plan_paths)) {
        const id = idxToId[idx];
        if (id) planPathsById[id] = (path as Array<{ t: number[]; q: number[] }>).map((x) => ({ t: x.t as [number, number, number], q: x.q as [number, number, number, number] }));
      }
      const planOffsetsById: Record<string, number> = {};
      const planStepsById: Record<string, number> = {};
      for (const [idx, v] of Object.entries(res.plan_offsets)) {
        const id = idxToId[idx];
        if (id) planOffsetsById[id] = v as number;
      }
      for (const [idx, v] of Object.entries(res.plan_steps)) {
        const id = idxToId[idx];
        if (id) planStepsById[id] = v as number;
      }
      const planStartPosesById: Record<string, PoseTR> = {};
      const planGoalPosesById: Record<string, PoseTR> = {};
      for (const [idx, pose] of Object.entries(res.plan_start_poses)) {
        const id = idxToId[idx];
        if (id) {
          const p = pose as { t: number[]; q: number[] };
          planStartPosesById[id] = { t: p.t as [number, number, number], q: p.q as [number, number, number, number] };
        }
      }
      for (const [idx, pose] of Object.entries(res.plan_goal_poses)) {
        const id = idxToId[idx];
        if (id) {
          const p = pose as { t: number[]; q: number[] };
          planGoalPosesById[id] = { t: p.t as [number, number, number], q: p.q as [number, number, number, number] };
        }
      }
      const refPose = meshStates[refId]?.pose ?? identity;
      const refTarget = meshStates[refId]?.targetPose ?? identity;
      planStartPosesById[refId] = refPose;
      planGoalPosesById[refId] = refTarget;
      const orderIds = (res.plan_order as string[]).map((idx) => idxToId[idx]).filter(Boolean);
      setPlanPaths(planPathsById);
      setPlanOffsets(planOffsetsById);
      setPlanSteps(planStepsById);
      setPlanStartPoses(planStartPosesById);
      setPlanGoalPoses(planGoalPosesById);
      setPlanOrder(orderIds);
      setPlanTotalDays(res.plan_total_days);
      setPlanTotalCost(typeof res.total_cost === 'number' ? res.total_cost : null);
      setPlanDayIdx(0);
      const infos = (res.plan_infos ?? []) as Array<[string, number, number, string]>;
      const lines = [
        `参考件：${refId}`,
        `可移动：${orderIds.length}，顺序：${orderIds.join(' → ')}`,
        `总天数：${res.plan_total_days}，总代价：${res.total_cost?.toFixed(2) ?? '-'}`,
        '',
        ...infos.map(([name, startDay, endDay, detail]) => {
          const steps = Math.max(0, endDay - startDay);
          return `骨 ${idxToId[name] ?? name}：${steps} 步（第 ${startDay}–${endDay} 天）— ${detail}`;
        }),
      ];
      setPlanText(lines.join('\n'));
      setStatusMsg('规划完成。');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isConnectionError =
        /socket hang up|ECONNRESET|ECONNREFUSED|fetch failed|Failed to fetch|NetworkError/i.test(msg);
      setStatusMsg(
        isConnectionError
          ? `规划请求失败：连接被断开。请确认已用 start.bat 启动全部服务（API 3001、Algo 8000、Web 3000）并等待约 30 秒后再试；体素 A* 规划可能需 30 秒以上，请勿刷新。\n\n原始错误: ${msg}`
          : '规划失败：' + msg
      );
    } finally {
      setPlanning(false);
    }
  }, [caseId, refId, stlFiles, meshStates, maxMmPerDay, maxDegPerDay]);

  const previewDay = useCallback(
    (delta: number) => {
      if (planTotalDays <= 0 && Object.keys(planPaths).length === 0) {
        setStatusMsg('尚未生成规划。');
        return;
      }
      const nextIdx = Math.max(0, Math.min(planTotalDays, planDayIdx + delta));
      setPlanDayIdx(nextIdx);
      setStatusMsg(`预览 第${nextIdx}/${planTotalDays}天`);
    },
    [planTotalDays, planPaths, planDayIdx]
  );

  const poseLabel = useMemo(() => {
    if (selectedIds.length !== 1) return '目标位姿：未单选';
    const id = selectedIds[0]!;
    if (id === refId) return '目标位姿：参考模型固定';
    const s = meshStates[id];
    if (!s) return '目标位姿：未单选';
    return '目标位姿：\n' + formatPoseLabel(s.targetPose);
  }, [selectedIds, refId, meshStates]);

  const transformControlsEnabled =
    selectedIds.length === 1 && selectedIds[0] !== refId;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  const c = caseData as { id: string; patient?: { name: string }; doctor?: { name: string } } | null;
  const refName = refId ? stlFiles.find((f) => f.id === refId)?.originalName ?? refId : '';

  return (
    <div className="p-4">
      <Link
        href={`/dashboard/cases/${caseId}`}
        className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover"
      >
        ← 返回病例
      </Link>
      <div className="mt-4">
        <h1 className="text-xl font-semibold text-foreground">STL 多骨规划器（体素A*）</h1>
        <p className="mt-1 text-sm text-medical-muted">
          病例 {c?.id} · 患者 {c?.patient?.name ?? '—'} · 医生 {c?.doctor?.name ?? '—'}
        </p>
      </div>

      <div className="mt-4 flex gap-4">
        {/* 左侧面板：与 CT3D 一致 */}
        <div className="flex min-w-[420px] max-w-[420px] flex-col gap-4 overflow-y-auto rounded-lg border border-medical-border bg-card p-4">
          {/* 导入/删除/清空 */}
          <div className="flex gap-2">
            <a
              href={`/dashboard/cases/${caseId}`}
              className="btn-secondary flex-1 rounded px-3 py-1.5 text-sm"
            >
              去病例页上传 STL
            </a>
            <button
              type="button"
              onClick={handleRemoveSelected}
              className="btn-secondary rounded px-3 py-1.5 text-sm"
            >
              删除所选
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="btn-secondary rounded px-3 py-1.5 text-sm"
            >
              清空全部
            </button>
          </div>

          {/* 模型列表 */}
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">STL 列表</p>
            <ul className="max-h-32 list-none overflow-auto rounded border border-medical-border bg-muted/30 p-1">
              {stlFiles.length === 0 ? (
                <li className="py-2 text-center text-xs text-medical-muted">暂无 STL，请在病例页上传</li>
              ) : (
                stlFiles.map((f) => (
                  <li
                    key={f.id}
                    onClick={() =>
                      setSelectedIds((prev) =>
                        prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id]
                      )
                    }
                    className={`cursor-pointer rounded px-2 py-1 text-xs ${selectedIds.includes(f.id) ? 'bg-medical-primary/20 text-foreground' : 'text-foreground/80'}`}
                  >
                    {f.originalName ?? f.id}
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* 参考件（固定） */}
          <div className="rounded border border-medical-border p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">参考件（固定）</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-medical-muted">参考件：</span>
              <input
                type="text"
                readOnly
                value={refName}
                className="input-field h-7 flex-1 rounded border border-medical-border bg-muted/30 px-2 text-xs"
              />
              <button type="button" onClick={handleSetRef} className="btn-primary rounded px-2 py-1 text-xs">
                设为参考
              </button>
            </div>
            <button
              type="button"
              onClick={handleClearRef}
              className="mt-2 w-full rounded border border-medical-border px-2 py-1 text-xs hover:bg-muted/50"
            >
              清除参考
            </button>
          </div>

          {/* 目标调整（选择1个模型） */}
          <div className="rounded border border-medical-border p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">目标调整（选择1个模型）</p>
            <div className="flex items-center gap-2 text-xs">
              <span>步长（mm）：</span>
              <input
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                value={stepMm}
                onChange={(e) => setStepMm(Number(e.target.value) || 0.01)}
                className="input-field h-6 w-16 rounded border border-medical-border px-1 text-xs"
              />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(0, 1, 0)}
                className="btn-secondary col-start-2 rounded px-1 py-0.5 text-xs"
              >
                Y+（前）
              </button>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(-1, 0, 0)}
                className="btn-secondary rounded px-1 py-0.5 text-xs"
              >
                X-（左）
              </button>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(1, 0, 0)}
                className="btn-secondary rounded px-1 py-0.5 text-xs"
              >
                X+（右）
              </button>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(0, -1, 0)}
                className="btn-secondary col-start-2 rounded px-1 py-0.5 text-xs"
              >
                Y-（后）
              </button>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(0, 0, 1)}
                className="btn-secondary col-start-4 row-span-2 self-center rounded px-1 py-0.5 text-xs"
              >
                Z+（上）
              </button>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={() => moveTargetSelected(0, 0, -1)}
                className="btn-secondary col-start-4 row-span-2 self-center rounded px-1 py-0.5 text-xs"
              >
                Z-（下）
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={mouseRotateTarget}
                  onChange={() => toggleMouseRotate()}
                />
                鼠标旋转目标
              </label>
              <button
                type="button"
                disabled={!transformControlsEnabled}
                onClick={resetTargetPose}
                className="btn-secondary rounded px-1 py-0.5"
              >
                重置目标
              </button>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={showTargetWireframe}
                  onChange={(e) => setShowTargetWireframe(e.target.checked)}
                />
                显示目标线框
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={hideNonRefOriginal}
                  onChange={(e) => setHideNonRefOriginal(e.target.checked)}
                />
                隐藏非参考原件
              </label>
            </div>
            <button
              type="button"
              onClick={() => validateTargets()}
              disabled={validating}
              className="mt-2 w-full rounded border border-medical-border px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-50"
            >
              {validating ? '校验中…' : '校验目标碰撞（精确）'}
            </button>
            {validateResult != null && (
              <div className="mt-2 whitespace-pre-wrap rounded border border-medical-border bg-muted/30 px-2 py-1.5 text-xs text-foreground">
                {validateResult}
              </div>
            )}
            <p className="mt-2 whitespace-pre-wrap text-xs text-medical-muted">{poseLabel}</p>
          </div>

          {/* 测量：两模型最小距离 */}
          <div className="rounded border border-medical-border p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">测量：两模型最小距离</p>
            <button
              type="button"
              onClick={calcDistance}
              className="w-full rounded border border-medical-border px-2 py-1 text-xs hover:bg-muted/50"
            >
              计算最小距离
            </button>
            <textarea
              readOnly
              value={distanceInfo}
              rows={6}
              className="input-field mt-2 w-full resize-none rounded border border-medical-border bg-muted/30 px-2 py-1 text-xs"
            />
          </div>

          {/* F2.3: 测量历史记录 */}
          <div className="rounded border border-medical-border p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">F2.3) 测量历史记录</p>
            {measurementLoading ? (
              <p className="text-xs text-medical-muted">加载中…</p>
            ) : measurementHistory.length === 0 ? (
              <p className="text-xs text-medical-muted">暂无历史测量记录</p>
            ) : (
              <div className="max-h-40 space-y-2 overflow-auto text-xs">
                {measurementHistory.map((m, idx) => (
                  <div key={m.id} className="rounded border border-medical-border bg-medical-muted/5 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">记录 #{measurementHistory.length - idx}</span>
                      <span className="text-medical-muted">{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                      {Object.entries(m.values).map(([key, val]) => (
                        <span key={key} className="truncate">
                          {key}: <strong>{val}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 规划 */}
          <div className="rounded border border-medical-border p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">
              规划：参考固定；其余顺序移动（每天&lt;=1mm或1度）
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>每日最大平移（mm）：</span>
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={maxMmPerDay}
                onChange={(e) => setMaxMmPerDay(Number(e.target.value) || 0.1)}
                className="input-field h-6 w-14 rounded border border-medical-border px-1"
              />
              <span>每日最大旋转（deg）：</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={maxDegPerDay}
                onChange={(e) => setMaxDegPerDay(Number(e.target.value) || 0.1)}
                className="input-field h-6 w-14 rounded border border-medical-border px-1"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={generatePlan}
                disabled={planning}
                className="btn-primary flex-1 rounded px-2 py-1 text-xs"
              >
                {planning ? '规划中…' : '生成无碰撞规划（体素A*）'}
              </button>
              <button
                type="button"
                onClick={() => previewDay(-1)}
                className="btn-secondary rounded px-2 py-1 text-xs"
              >
                预览：前一天
              </button>
              <button
                type="button"
                onClick={() => previewDay(1)}
                className="btn-secondary rounded px-2 py-1 text-xs"
              >
                预览：后一天
              </button>
            </div>
            <textarea
              readOnly
              value={
                planTotalDays > 0 && dailyTableText
                  ? `${planText}\n\n--- 按天规划 ---\n${dailyTableText}`
                  : planText
              }
              rows={14}
              className="input-field mt-2 w-full resize-y rounded border border-medical-border bg-muted/30 px-2 py-1 text-xs font-mono"
            />
            {/* 术前术后的统计数据（与2D一致） */}
            {planTotalDays > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded border border-medical-border bg-muted/30 px-2 py-1">
                  总天数: <strong>{planTotalDays}</strong>
                </span>
                <span className="rounded border border-medical-border bg-muted/30 px-2 py-1">
                  总代价: <strong>{planTotalCost?.toFixed(2) ?? '—'}</strong>
                </span>
                <span className="rounded border border-medical-border bg-muted/30 px-2 py-1">
                  当前预览: Day <strong>{planDayIdx}</strong>
                </span>
              </div>
            )}
            {/* 快速操作按钮 */}
            {refId && (
              <div className="mt-2 flex flex-wrap gap-2">
                {planTotalDays > 0 && dailySteps3D.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setSavingPlan(true);
                      try {
                        const planPathsSer: Record<string, Array<{ t: number[]; q: number[] }>> = {};
                        for (const [id, path] of Object.entries(planPaths)) {
                          planPathsSer[id] = path.map((p) => ({ t: [...p.t], q: [...p.q] }));
                        }
                        const planStartSer: Record<string, { t: number[]; q: number[] }> = {};
                        const planGoalSer: Record<string, { t: number[]; q: number[] }> = {};
                        for (const id of Object.keys(planStartPoses)) {
                          const s = planStartPoses[id];
                          if (s) planStartSer[id] = { t: [...s.t], q: [...s.q] };
                        }
                        for (const id of Object.keys(planGoalPoses)) {
                          const g = planGoalPoses[id];
                          if (g) planGoalSer[id] = { t: [...g.t], q: [...g.q] };
                        }
                        const saved = await savePlan3d(caseId, {
                          refId,
                          totalDays: planTotalDays,
                          totalCost: planTotalCost ?? undefined,
                          dailySteps3D,
                          planPaths: planPathsSer,
                          planOffsets: { ...planOffsets },
                          planSteps: { ...planSteps },
                          planOrder: [...planOrder],
                          planStartPoses: planStartSer,
                          planGoalPoses: planGoalSer,
                        });
                        setCurrentPlan(saved);
                        setPlans((prev) => {
                          const list = Array.isArray(prev) ? (prev as { id: string; algoType?: string }[]) : [];
                          const without3d = list.filter((p) => p.algoType !== 'PLAN_3D');
                          return [...without3d, saved];
                        });
                        setStatusMsg('方案已保存，已覆盖原 3D 方案；矫正后位姿已写入数据库。');
                        router.push(`/dashboard/cases/${caseId}/pdf-preview?planId=${saved.id}`);
                      } catch (e) {
                        setStatusMsg('保存失败：' + (e instanceof Error ? e.message : String(e)));
                      } finally {
                        setSavingPlan(false);
                      }
                    }}
                    disabled={savingPlan}
                    className="flex-1 rounded bg-medical-primary px-2 py-1.5 text-xs text-white hover:bg-medical-primary-hover disabled:opacity-50"
                  >
                    {savingPlan ? '保存中…' : '保存方案'}
                  </button>
                )}
                {planTotalDays > 0 && dailySteps3D.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setPdfLoading(true);
                      try {
                        await downloadPlanPdf3d(caseId, {
                          totalDays: planTotalDays,
                          totalCost: planTotalCost ?? undefined,
                          dailySteps3D,
                        });
                      } finally {
                        setPdfLoading(false);
                      }
                    }}
                    disabled={pdfLoading}
                    className="flex-1 rounded border border-medical-primary px-2 py-1.5 text-xs text-medical-primary hover:bg-medical-primary/10 disabled:opacity-50"
                  >
                    {pdfLoading ? '生成中…' : '导出PDF报告'}
                  </button>
                )}
              </div>
            )}
          </div>

          {statusMsg && <p className="text-xs text-medical-muted">{statusMsg}</p>}
        </div>

        {/* 右侧：3D 视图 */}
        <div className="min-h-[500px] flex-1">
          {stlFiles.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-medical-border bg-muted/20 text-sm text-medical-muted">
              当前病例下暂无 STL，请在病例详情页上传 STL 后再打开 3D 工作台。
            </div>
          ) : (
            <Workbench3DViewer
              stlFiles={stlFiles}
              poses={poses}
              targetPoses={targetPoses}
              refId={refId}
              selectedIds={selectedIds}
              showTargetWireframe={showTargetWireframe}
              hideNonRefOriginal={hideNonRefOriginal}
              mouseRotateTarget={mouseRotateTarget}
              onTargetPoseChange={handleTargetPoseChange}
            />
          )}
        </div>
      </div>

      {/* 保存方案（覆盖数据库原 3D 方案）+ 导出 PDF */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {refId && planTotalDays > 0 && dailySteps3D.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              setSavingPlan(true);
              try {
                const planPathsSer: Record<string, Array<{ t: number[]; q: number[] }>> = {};
                for (const [id, path] of Object.entries(planPaths)) {
                  planPathsSer[id] = path.map((p) => ({ t: [...p.t], q: [...p.q] }));
                }
                const planStartSer: Record<string, { t: number[]; q: number[] }> = {};
                const planGoalSer: Record<string, { t: number[]; q: number[] }> = {};
                for (const id of Object.keys(planStartPoses)) {
                  const s = planStartPoses[id];
                  if (s) planStartSer[id] = { t: [...s.t], q: [...s.q] };
                }
                for (const id of Object.keys(planGoalPoses)) {
                  const g = planGoalPoses[id];
                  if (g) planGoalSer[id] = { t: [...g.t], q: [...g.q] };
                }
                const saved = await savePlan3d(caseId, {
                  refId,
                  totalDays: planTotalDays,
                  totalCost: planTotalCost ?? undefined,
                  dailySteps3D,
                  planPaths: planPathsSer,
                  planOffsets: { ...planOffsets },
                  planSteps: { ...planSteps },
                  planOrder: [...planOrder],
                  planStartPoses: planStartSer,
                  planGoalPoses: planGoalSer,
                });
                setCurrentPlan(saved);
                setPlans((prev) => {
                  const list = Array.isArray(prev) ? (prev as { id: string; algoType?: string }[]) : [];
                  const without3d = list.filter((p) => p.algoType !== 'PLAN_3D');
                  return [...without3d, saved];
                });
                setStatusMsg('方案已保存，已覆盖原 3D 方案；矫正后位姿已写入数据库，下次打开将自动加载。');
                // F1.3: 规划完成后跳转到PDF预览页面
                router.push(`/dashboard/cases/${caseId}/pdf-preview?planId=${saved.id}`);
              } catch (e) {
                setStatusMsg('保存失败：' + (e instanceof Error ? e.message : String(e)));
              } finally {
                setSavingPlan(false);
              }
            }}
            disabled={savingPlan}
            className="btn-primary rounded px-4 py-2 text-sm"
          >
            {savingPlan ? '保存中…' : '保存方案（覆盖原 3D 方案）'}
          </button>
        )}
        {planTotalDays > 0 && dailySteps3D.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              setPdfLoading(true);
              try {
                await downloadPlanPdf3d(caseId, {
                  totalDays: planTotalDays,
                  totalCost: planTotalCost ?? undefined,
                  dailySteps3D,
                });
              } finally {
                setPdfLoading(false);
              }
            }}
            disabled={pdfLoading}
            className="btn-secondary rounded px-4 py-2 text-sm"
          >
            {pdfLoading ? '生成中…' : '下载规划报告 PDF（3D 按天表格）'}
          </button>
        )}
        {(currentPlan as { id?: string })?.id && (
          <button
            type="button"
            onClick={async () => {
              const p = currentPlan as { id: string };
              setPdfLoading(true);
              try {
                await downloadPlanPdf(p.id);
              } finally {
                setPdfLoading(false);
              }
            }}
            disabled={pdfLoading}
            className="btn-secondary rounded px-4 py-2 text-sm"
          >
            {pdfLoading ? '生成中…' : '导出已保存方案 PDF'}
          </button>
        )}
      </div>
    </div>
  );
}
