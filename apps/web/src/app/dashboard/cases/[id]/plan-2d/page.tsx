'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCase, getFiles, getPlans, getFileBlob, triggerPlan, updatePlan, downloadPlanPdf, predictSegmentation, saveMask, loadSavedMask, logClientAction, getMeasurements, createMeasurement } from '@/lib/api';
import {
  ImageCanvas,
  maskFromBox,
  shiftMask,
  dilateMask,
  overlapCount,
  maskShiftInBounds,
  computeOverlapMask,
  type Box,
  type Mask,
} from '@/components/Workbench2D/ImageCanvas';

type Pose = { lr: number; ud: number; fb: number };
type ViewKey = 'front' | 'side';
type RoleKey = 'reference' | 'moving';

const defaultPose: Pose = { lr: 0, ud: 0, fb: 0 };

type SegmentState = { reference?: Mask; moving?: Mask };
type SegmentsState = { front: SegmentState; side: SegmentState };

// 与 2dmax round_half_up 一致
function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

// 与 2dmax _pose_mm_to_px 完全一致（dx, dy 语义与 shift_bool_mask 一致）：
// 正位：dx=左右(lr)，dy=上下(ud)；侧位：dx=-前后(fb)，dy=上下(ud)
const FALLBACK_MM_PER_PX = 0.1;
function poseMmToPx(pose: Pose, view: ViewKey, frontMmPerPx: number, sideMmPerPx: number): [number, number] {
  const fp = Number.isFinite(frontMmPerPx) && frontMmPerPx > 0 ? frontMmPerPx : FALLBACK_MM_PER_PX;
  const sp = Number.isFinite(sideMmPerPx) && sideMmPerPx > 0 ? sideMmPerPx : FALLBACK_MM_PER_PX;
  if (view === 'front') {
    return [roundHalfUp(pose.lr / fp), roundHalfUp(pose.ud / fp)];
  }
  return [roundHalfUp(-pose.fb / sp), roundHalfUp(pose.ud / sp)];
}

/** Blob URL 转 base64（用于 SAM 请求） */
async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      const base64 = dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1]! : dataUrl;
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** 服务端返回的 mask PNG base64 解码为 0/1 二维数组 */
function decodeMaskBase64ToMask(b64: string): Promise<Mask> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2d 不可用'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const mask: Mask = Array(h)
        .fill(0)
        .map(() => Array(w).fill(0));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          mask[y][x] = data[i]! > 128 ? 1 : 0;
        }
      }
      resolve(mask);
    };
    img.onerror = () => reject(new Error('掩码图像加载失败'));
    img.src = `data:image/png;base64,${b64}`;
  });
}

/** Mask 转为 PNG base64（与 Python 保存格式一致：u8*255） */
function maskToPngBase64(mask: Mask): string {
  const h = mask.length;
  const w = mask[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d 不可用');
  const imgData = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = mask[y][x] ? 255 : 0;
      const i = (y * w + x) * 4;
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1]! : dataUrl;
}

export default function Plan2DWorkbenchPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;

  const [caseData, setCaseData] = useState<unknown>(null);
  const [files, setFiles] = useState<{ id: string; type: string }[]>([]);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [sideUrl, setSideUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [frontMmPerPx, setFrontMmPerPx] = useState(0.1);
  const [sideMmPerPx, setSideMmPerPx] = useState(0.1);
  const [imageSizes, setImageSizes] = useState<{ front?: { w: number; h: number }; side?: { w: number; h: number } }>({});

  const [segments, setSegments] = useState<SegmentsState>({ front: {}, side: {} });
  const [segView, setSegView] = useState<ViewKey>('front');
  const [segRole, setSegRole] = useState<RoleKey>('reference');
  const [segEngine, setSegEngine] = useState<'classic' | 'sam'>('sam');
  const [frontBox, setFrontBox] = useState<Box | null>(null);
  const [sideBox, setSideBox] = useState<Box | null>(null);
  const [boxUndo, setBoxUndo] = useState<{ front: Box[]; side: Box[] }>({ front: [], side: [] });
  const [boxRedo, setBoxRedo] = useState<{ front: Box[]; side: Box[] }>({ front: [], side: [] });
  const [candidates, setCandidates] = useState<{ mask: Mask; score: number }[]>([]);
  const [selectedCandIndices, setSelectedCandIndices] = useState<number[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [predictLoading, setPredictLoading] = useState(false);
  const [maskFilePaths, setMaskFilePaths] = useState<{ front: { reference: string; moving: string }; side: { reference: string; moving: string } }>({
    front: { reference: '', moving: '' },
    side: { reference: '', moving: '' },
  });
  const [maskSaveRoot, setMaskSaveRoot] = useState('');
  const [saveMaskLoading, setSaveMaskLoading] = useState(false);

  const [pose, setPose] = useState<Pose>({ ...defaultPose });
  const [stepMm, setStepMm] = useState(0.5);
  const [targetPose, setTargetPose] = useState<Pose>({ ...defaultPose });
  const [targetInputs, setTargetInputs] = useState({ left: 0, right: 0, up: 0, down: 0, front: 0, back: 0 });
  const [overlapDetails, setOverlapDetails] = useState<{
    front?: { overlapMask: Mask; overlap: number; inBounds: boolean };
    side?: { overlapMask: Mask; overlap: number; inBounds: boolean };
  }>({});

  const [plans, setPlans] = useState<unknown[]>([]);
  const [currentPlan, setCurrentPlan] = useState<unknown>(null);
  const [triggering, setTriggering] = useState(false);
  const [currentDay, setCurrentDay] = useState(0);
  const [dayPreviewActive, setDayPreviewActive] = useState(false); // true = 画布显示「当前 Day」的规划位姿；false = 画布显示当前 pose（箭头生效）
  const [pdfLoading, setPdfLoading] = useState(false);
  const [savePlanLoading, setSavePlanLoading] = useState(false);
  const frontUrlRef = useRef<string | null>(null);
  const sideUrlRef = useRef<string | null>(null);

  // F2.1: 掩码自动保存 debounce（500ms）——当 segments/maskFilePaths 变化时触发
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveLockRef = useRef(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('');

  const cancelAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const scheduleAutoSave = useCallback(
    (planId: string, maskPaths: typeof maskFilePaths, segmentsData: typeof segments) => {
      cancelAutoSave();
      autoSaveTimerRef.current = setTimeout(async () => {
        if (autoSaveLockRef.current) return;
        autoSaveLockRef.current = true;
        setAutoSaveStatus('自动保存中…');
        try {
          await updatePlan(planId, {
            meta: {
              maskPathsUsed: {
                frontRef: maskPaths.front.reference || null,
                frontMov: maskPaths.front.moving || null,
                sideRef: maskPaths.side.reference || null,
                sideMov: maskPaths.side.moving || null,
              },
            },
          });
          setAutoSaveStatus('已自动保存 ' + new Date().toLocaleTimeString());
          logClientAction('autoSaveMask', planId, 'ok');
        } catch (e) {
          setAutoSaveStatus('自动保存失败');
          logClientAction('autoSaveMask', planId, `err: ${e instanceof Error ? e.message : e}`);
        } finally {
          autoSaveLockRef.current = false;
          autoSaveTimerRef.current = null;
        }
      }, 500);
    },
    [cancelAutoSave]
  );

  // F2.2: 当 segments 或 maskFilePaths 变化时，自动保存到当前方案
  useEffect(() => {
    const p = currentPlan as { id: string } | null;
    if (!p?.id || !maskFilePaths) return;
    scheduleAutoSave(p.id, maskFilePaths, segments);
    return () => cancelAutoSave();
  }, [segments, maskFilePaths, currentPlan, scheduleAutoSave, cancelAutoSave]);

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
      const history = await getMeasurements(caseId, 'PREOP_2D');
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

  // F2.3 记录当前测量（用户确认时调用）
  const saveCurrentMeasurement = useCallback(
    async (values: Record<string, number | string>) => {
      try {
        await createMeasurement({ caseId, stage: 'PREOP_2D', values });
        await loadMeasurementHistory();
        logClientAction('saveMeasurement', caseId, 'ok');
      } catch (e) {
        logClientAction('saveMeasurement', caseId, `err: ${e instanceof Error ? e.message : e}`);
      }
    },
    [caseId, loadMeasurementHistory]
  );

  useEffect(() => {
    getCase(caseId).then(setCaseData).catch(() => router.push('/dashboard'));
    getFiles(caseId)
      .then((list: unknown) => {
        const arr = Array.isArray(list) ? list : [];
        setFiles(arr as { id: string; type: string }[]);
        return arr as { id: string; type: string }[];
      })
      .catch(() => [])
      .finally(() => setLoading(false));
  }, [caseId, router]);

  // F2.2: 组件卸载时清理 auto-save timer
  useEffect(() => {
    return () => {
      cancelAutoSave();
    };
  }, [cancelAutoSave]);

  // F2.2: 工作台状态恢复（已在 mount 时通过 getPlans 加载 plan.meta.maskPathsUsed 并恢复掩码）
  // 此 useEffect 确保 segments 变化时自动保存到当前方案

  useEffect(() => {
    const fl = files as { id: string; type: string }[];
    const front = fl.find((f) => f.type === 'FRONT');
    const side = fl.find((f) => f.type === 'SIDE');
    let cancelled = false;
    if (front) {
      getFileBlob(front.id).then((blob) => {
        if (cancelled) return;
        if (frontUrlRef.current) URL.revokeObjectURL(frontUrlRef.current);
        const url = URL.createObjectURL(blob);
        frontUrlRef.current = url;
        setFrontUrl(url);
      });
    } else {
      if (frontUrlRef.current) {
        URL.revokeObjectURL(frontUrlRef.current);
        frontUrlRef.current = null;
      }
      setFrontUrl(null);
    }
    if (side) {
      getFileBlob(side.id).then((blob) => {
        if (cancelled) return;
        if (sideUrlRef.current) URL.revokeObjectURL(sideUrlRef.current);
        const url = URL.createObjectURL(blob);
        sideUrlRef.current = url;
        setSideUrl(url);
      });
    } else {
      if (sideUrlRef.current) {
        URL.revokeObjectURL(sideUrlRef.current);
        sideUrlRef.current = null;
      }
      setSideUrl(null);
    }
    return () => {
      cancelled = true;
      if (frontUrlRef.current) URL.revokeObjectURL(frontUrlRef.current);
      frontUrlRef.current = null;
      if (sideUrlRef.current) URL.revokeObjectURL(sideUrlRef.current);
      sideUrlRef.current = null;
    };
  }, [files]);

  useEffect(() => {
    let cancelled = false;
    getPlans(caseId)
      .then(async (p) => {
        const list = Array.isArray(p) ? p : [];
        if (cancelled) return;
        setPlans(list);
        const plan2d = list.find((x: { algoType: string }) => x.algoType === 'PLAN_2D') as
          | {
              id: string;
              algoType: string;
              meta?: { maskPathsUsed?: { frontRef?: string | null; frontMov?: string | null; sideRef?: string | null; sideMov?: string | null } } | null;
            }
          | undefined;
        setCurrentPlan(plan2d ?? null);
        if (!plan2d || !plan2d.meta || typeof plan2d.meta !== 'object') return;
        const maskPathsUsed = (plan2d.meta as any).maskPathsUsed ?? {};
        const nextPaths = {
          front: {
            reference: (maskPathsUsed.frontRef as string | undefined) || '',
            moving: (maskPathsUsed.frontMov as string | undefined) || '',
          },
          side: {
            reference: (maskPathsUsed.sideRef as string | undefined) || '',
            moving: (maskPathsUsed.sideMov as string | undefined) || '',
          },
        };
        setMaskFilePaths(nextPaths);

        // 恢复掩码到画布
        const loadOne = async (p: string | '') => {
          if (!p) return null;
          try {
            const res = await loadSavedMask(p);
            const m = await decodeMaskBase64ToMask(res.mask_base64);
            return m;
          } catch {
            return null;
          }
        };
        const [frontRefMask, frontMovMask, sideRefMask, sideMovMask] = await Promise.all([
          loadOne(nextPaths.front.reference),
          loadOne(nextPaths.front.moving),
          loadOne(nextPaths.side.reference),
          loadOne(nextPaths.side.moving),
        ]);
        if (cancelled) return;
        setSegments((s) => ({
          front: {
            reference: frontRefMask ?? s.front.reference,
            moving: frontMovMask ?? s.front.moving,
          },
          side: {
            reference: sideRefMask ?? s.side.reference,
            moving: sideMovMask ?? s.side.moving,
          },
        }));
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const handleImageSize = useCallback((viewKey: ViewKey, w: number, h: number) => {
    setImageSizes((prev) => ({ ...prev, [viewKey]: { w, h } }));
  }, []);

  // 与 2dmax _regions_complete 一致：两视图均有 image 且 reference+moving
  const regionsComplete = !!frontUrl && !!sideUrl && !!segments.front.reference && !!segments.front.moving && !!segments.side.reference && !!segments.side.moving;

  // 与 2dmax _pose_valid 一致：仅要求 image + reference + moving（尺寸用 mask 或 imageSizes）
  const poseValid = useCallback(
    (p: Pose, drawOverlay: boolean): { ok: boolean; details: Record<ViewKey, { overlapMask: Mask; overlap: number; inBounds: boolean } | undefined>; message?: string } => {
      const details: Record<ViewKey, { overlapMask: Mask; overlap: number; inBounds: boolean } | undefined> = { front: undefined, side: undefined };
      let checked = 0;
      let okAll = true;
      const reasons: string[] = [];
      for (const v of ['front', 'side'] as ViewKey[]) {
        const ref = segments[v].reference;
        const mov = segments[v].moving;
        if (!ref || !mov) {
          details[v] = undefined;
          continue;
        }
        // 2dmax 用 vd.image.gray_u8.shape；无 imageSizes 时用 mask 尺寸（与 2dmax 一致）
        const sz = imageSizes[v] ?? { w: mov[0].length, h: mov.length };
        checked += 1;
        const [dx, dy] = poseMmToPx(p, v, frontMmPerPx, sideMmPerPx);
        const inBounds = maskShiftInBounds(mov, dx, dy, sz.w, sz.h); // 与 2dmax _bbox_shift_in_bounds(mov, shift, shape) 一致
        const moved = shiftMask(mov, dx, dy);
        const refD = dilateMask(ref, 1);
        const om = refD.map((row, y) => row.map((_, x) => (moved[y]?.[x] && refD[y][x] ? 1 : 0)));
        const overlap = overlapCount(moved, refD);
        const ok = inBounds && overlap === 0;
        if (!ok) {
          okAll = false;
          const label = v === 'front' ? '正位' : '侧位';
          if (!inBounds) reasons.push(`${label}: 越界`);
          if (overlap > 0) reasons.push(`${label}: 碰撞`);
        }
        details[v] = { overlapMask: om, overlap, inBounds };
      }
      if (drawOverlay) setOverlapDetails(details);
      const message = reasons.length ? reasons.join('；') : undefined;
      if (checked < 2) return { ok: false, details, message: '请先完成四个掩码（正Ref/正Mov/侧Ref/侧Mov）。' };
      return { ok: okAll, details, message };
    },
    [segments, imageSizes, frontMmPerPx, sideMmPerPx]
  );

  /** 与 2dmax 一致：画框松开后立即做 SAM/Classic 预测（set_box → request_predict） */
  const runPredictForBox = useCallback(
    async (viewKey: ViewKey, box: Box) => {
      const imageUrl = viewKey === 'front' ? frontUrl : sideUrl;
      const sz = imageSizes[viewKey];
      if (!sz) {
        setStatusMsg('当前视图尺寸未知，请等待图像加载。');
        return;
      }
      if (segEngine === 'classic') {
        const mask = maskFromBox(box, sz.w, sz.h);
        setCandidates([{ mask, score: 1.0 }]);
        setSelectedCandIndices([0]);
        setStatusMsg('经典分割：生成1个候选。');
        return;
      }
      if (!imageUrl) {
        setStatusMsg('当前视图无图像，无法调用 SAM。');
        return;
      }
      setPredictLoading(true);
      setStatusMsg('SAM 预测中…');
      try {
        const base64 = await blobUrlToBase64(imageUrl);
        const res = await predictSegmentation(base64, [box[0], box[1], box[2], box[3]]);
        const decoded: { mask: Mask; score: number }[] = [];
        for (const c of res.candidates) {
          try {
            const mask = await decodeMaskBase64ToMask(c.mask_base64);
            decoded.push({ mask, score: c.score });
          } catch {
            /* skip */
          }
        }
        if (decoded.length === 0) {
          setStatusMsg('SAM 未返回有效候选或解码失败。');
          setCandidates([]);
          logClientAction('predict', viewKey, 'fail: 无候选或解码失败');
        } else {
          setCandidates(decoded);
          setSelectedCandIndices([0]);
          setStatusMsg(`SAM 生成 ${decoded.length} 个候选。`);
          logClientAction('predict', viewKey, `ok: ${decoded.length} 候选`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatusMsg(`SAM 预测失败：${msg}`);
        setCandidates([]);
        logClientAction('predict', viewKey, `err: ${msg}`);
      } finally {
        setPredictLoading(false);
      }
    },
    [frontUrl, sideUrl, imageSizes, segEngine]
  );

  const handleBoxFinal = useCallback(
    (viewKey: ViewKey, box: Box) => {
      if (viewKey === 'front') {
        setFrontBox(box);
        setBoxUndo((u) => ({ ...u, front: [...u.front, frontBox].filter(Boolean) as Box[] }));
        setBoxRedo((r) => ({ ...r, front: [] }));
      } else {
        setSideBox(box);
        setBoxUndo((u) => ({ ...u, side: [...u.side, sideBox].filter(Boolean) as Box[] }));
        setBoxRedo((r) => ({ ...r, side: [] }));
      }
      setSegView(viewKey);
      setCandidates([]);
      setStatusMsg(`Box: (${box[0]},${box[1]})-(${box[2]},${box[3]})`);
      runPredictForBox(viewKey, box);
    },
    [frontBox, sideBox, runPredictForBox]
  );

  const predictPrompt = useCallback(async () => {
    const box = segView === 'front' ? frontBox : sideBox;
    const sz = imageSizes[segView];
    const imageUrl = segView === 'front' ? frontUrl : sideUrl;
    if (!box || !sz) {
      setStatusMsg('请先在画布上拖拽绘制矩形框。');
      return;
    }
    if (segEngine === 'classic') {
      const mask = maskFromBox(box, sz.w, sz.h);
      setCandidates([{ mask, score: 1.0 }]);
      setSelectedCandIndices([0]);
      setStatusMsg('经典分割：生成1个候选。');
      return;
    }
    if (!imageUrl) {
      setStatusMsg('当前视图无图像，无法调用 SAM。');
      return;
    }
    setPredictLoading(true);
    setStatusMsg('SAM 预测中…');
    try {
      const base64 = await blobUrlToBase64(imageUrl);
      const res = await predictSegmentation(base64, [box[0], box[1], box[2], box[3]]);
      const decoded: { mask: Mask; score: number }[] = [];
      for (const c of res.candidates) {
        try {
          const mask = await decodeMaskBase64ToMask(c.mask_base64);
          decoded.push({ mask, score: c.score });
        } catch {
          /* skip decode fail */
        }
      }
      if (decoded.length === 0) {
        setStatusMsg('SAM 未返回有效候选或解码失败。');
        setCandidates([]);
      } else {
        setCandidates(decoded);
        setSelectedCandIndices([0]);
        setStatusMsg(`SAM 生成 ${decoded.length} 个候选。`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMsg(`SAM 预测失败：${msg}`);
      setCandidates([]);
    } finally {
      setPredictLoading(false);
    }
  }, [segView, frontBox, sideBox, frontUrl, sideUrl, imageSizes, segEngine]);

  const clearPrompts = useCallback(() => {
    if (segView === 'front') {
      setFrontBox(null);
      setBoxUndo((u) => ({ ...u, front: [] }));
      setBoxRedo((r) => ({ ...r, front: [] }));
    } else {
      setSideBox(null);
      setBoxUndo((u) => ({ ...u, side: [] }));
      setBoxRedo((r) => ({ ...r, side: [] }));
    }
    setCandidates([]);
    setSelectedCandIndices([]);
    setStatusMsg('已清空。');
  }, [segView]);

  const undoPrompt = useCallback(() => {
    const stack = segView === 'front' ? boxUndo.front : boxUndo.side;
    if (stack.length === 0) {
      setStatusMsg('无可撤销。');
      return;
    }
    const prev = stack[stack.length - 1];
    const currentBox = segView === 'front' ? frontBox : sideBox;
    if (segView === 'front') {
      setBoxUndo((u) => ({ ...u, front: u.front.slice(0, -1) }));
      setBoxRedo((r) => ({ ...r, front: currentBox != null ? [...r.front, currentBox] : r.front }));
      setFrontBox(prev);
    } else {
      setBoxUndo((u) => ({ ...u, side: u.side.slice(0, -1) }));
      setBoxRedo((r) => ({ ...r, side: currentBox != null ? [...r.side, currentBox] : r.side }));
      setSideBox(prev);
    }
    setCandidates([]);
    const sz = imageSizes[segView];
    if (sz) {
      const mask = maskFromBox(prev, sz.w, sz.h);
      setCandidates([{ mask, score: 1.0 }]);
      setSelectedCandIndices([0]);
    }
    setStatusMsg('已撤销。');
  }, [segView, boxUndo, frontBox, sideBox, imageSizes]);

  const redoPrompt = useCallback(() => {
    const redoStack = segView === 'front' ? boxRedo.front : boxRedo.side;
    if (redoStack.length === 0) {
      setStatusMsg('无可重做。');
      return;
    }
    const next = redoStack[redoStack.length - 1];
    const currentBox = segView === 'front' ? frontBox : sideBox;
    if (segView === 'front') {
      setBoxRedo((r) => ({ ...r, front: r.front.slice(0, -1) }));
      setBoxUndo((u) => ({ ...u, front: currentBox != null ? [...u.front, currentBox] : u.front }));
      setFrontBox(next);
    } else {
      setBoxRedo((r) => ({ ...r, side: r.side.slice(0, -1) }));
      setBoxUndo((u) => ({ ...u, side: currentBox != null ? [...u.side, currentBox] : u.side }));
      setSideBox(next);
    }
    setCandidates([]);
    const sz = imageSizes[segView];
    if (sz) {
      const mask = maskFromBox(next, sz.w, sz.h);
      setCandidates([{ mask, score: 1.0 }]);
      setSelectedCandIndices([0]);
    }
    setStatusMsg('已重做。');
  }, [segView, boxRedo, frontBox, sideBox, imageSizes]);

  const commitSeparate = useCallback(async () => {
    if (candidates.length === 0) {
      setStatusMsg('无候选，请先预测。');
      return;
    }
    const idx = selectedCandIndices[0] ?? 0;
    const cand = candidates[Math.min(idx, candidates.length - 1)];
    if (!cand) return;
    const area = cand.mask.flat().filter(Boolean).length;
    const old = maskFilePaths[segView][segRole];
    const msg = `保存目标：${segView === 'front' ? '正位' : '侧位'} - ${segRole === 'reference' ? '基准(reference)' : '矫正(moving)'}\n来源：分别候选#${idx}\n前景像素：${area}${old ? `\n该部位已有掩码，将覆盖记录：\n${old}\n` : ''}\n确认保存？`;
    if (!window.confirm(msg)) return;
    setSaveMaskLoading(true);
    try {
      const b64 = maskToPngBase64(cand.mask);
      const res = await saveMask(caseId, segView, segRole, segEngine, b64);
      setMaskSaveRoot(res.mask_save_root);
      setMaskFilePaths((p) => ({
        ...p,
        [segView]: { ...p[segView], [segRole]: res.path },
      }));
      setSegments((s) => ({ ...s, [segView]: { ...s[segView], [segRole]: cand.mask } }));
      // 掩码发生变化时，当前规划结果失效，清空以避免脏数据
      setPlans([]);
      setCurrentPlan(null);
      setCurrentDay(0);
      setStatusMsg(
        `${segView === 'front' ? '正位' : '侧位'}-${segRole === 'reference' ? '基准' : '矫正'} 已保存：${res.path}（已清空旧规划）`,
      );
      logClientAction('saveMask', `${segView}-${segRole}`, `ok: ${res.path}, planInvalidated`);
    } catch (e) {
      setStatusMsg(`已应用内存，写盘失败：${e instanceof Error ? e.message : e}`);
      setSegments((s) => ({ ...s, [segView]: { ...s[segView], [segRole]: cand.mask } }));
      logClientAction('saveMask', `${segView}-${segRole}`, `err: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaveMaskLoading(false);
      setOverlapDetails({});
      poseValid(pose, true);
    }
  }, [caseId, segView, segRole, segEngine, candidates, selectedCandIndices, maskFilePaths, pose, poseValid]);

  const commitUnion = useCallback(async () => {
    if (candidates.length === 0 || selectedCandIndices.length === 0) {
      setStatusMsg('请勾选至少一个候选。');
      return;
    }
    const sz = imageSizes[segView];
    if (!sz) return;
    const h = sz.h;
    const w = sz.w;
    const mask: Mask = Array(h)
      .fill(0)
      .map(() => Array(w).fill(0));
    for (const i of selectedCandIndices) {
      const c = candidates[i];
      if (!c) continue;
      for (let y = 0; y < Math.min(h, c.mask.length); y++) {
        for (let x = 0; x < Math.min(w, c.mask[0].length); x++) {
          if (c.mask[y][x]) mask[y][x] = 1;
        }
      }
    }
    const area = mask.flat().filter(Boolean).length;
    const old = maskFilePaths[segView][segRole];
    const msg = `保存目标：${segView === 'front' ? '正位' : '侧位'} - ${segRole === 'reference' ? '基准(reference)' : '矫正(moving)'}\n来源：合并候选${selectedCandIndices.join(',')}\n前景像素：${area}${old ? `\n该部位已有掩码，将覆盖记录：\n${old}\n` : ''}\n确认保存？`;
    if (!window.confirm(msg)) return;
    setSaveMaskLoading(true);
    try {
      const b64 = maskToPngBase64(mask);
      const res = await saveMask(caseId, segView, segRole, segEngine, b64);
      setMaskSaveRoot(res.mask_save_root);
      setMaskFilePaths((p) => ({
        ...p,
        [segView]: { ...p[segView], [segRole]: res.path },
      }));
      setSegments((s) => ({ ...s, [segView]: { ...s[segView], [segRole]: mask } }));
      setPlans([]);
      setCurrentPlan(null);
      setCurrentDay(0);
      setStatusMsg(
        `${segView === 'front' ? '正位' : '侧位'}-${
          segRole === 'reference' ? '基准' : '矫正'
        } 已合并保存：${res.path}（已清空旧规划）`,
      );
      logClientAction('saveMask', `${segView}-${segRole}(union)`, `ok: ${res.path}, planInvalidated`);
    } catch (e) {
      setStatusMsg(`已应用内存，写盘失败：${e instanceof Error ? e.message : e}`);
      setSegments((s) => ({ ...s, [segView]: { ...s[segView], [segRole]: mask } }));
      logClientAction('saveMask', `${segView}-${segRole}(union)`, `err: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaveMaskLoading(false);
      setOverlapDetails({});
      poseValid(pose, true);
    }
  }, [caseId, segView, segRole, segEngine, candidates, selectedCandIndices, maskFilePaths, imageSizes, pose, poseValid]);

  // 与 2dmax _move_arrow 一致：先校验 new_pose 不画 overlay，通过后更新 pose 并同步显示
  const move = useCallback(
    (dlr: number, dud: number, dfb: number) => {
      const detail = `dlr=${dlr} dud=${dud} dfb=${dfb}`;
      if (!regionsComplete) {
        setStatusMsg('请先完成四个掩码（正Ref/正Mov/侧Ref/侧Mov）。');
        logClientAction('move', detail, 'skip: 四掩码未齐');
        return;
      }
      const newPose = {
        lr: pose.lr + dlr,
        ud: pose.ud + dud,
        fb: pose.fb + dfb,
      };
      const { ok, details, message } = poseValid(newPose, false);
      if (!ok) {
        if (details) setOverlapDetails(details);
        const result = message ? `blocked: ${message}` : 'blocked: 碰撞或越界';
        setStatusMsg(message ? `移动被阻止：${message}` : '移动被阻止：检测到碰撞或越界。');
        logClientAction('move', detail, result);
        return;
      }
      setPose(newPose);
      setDayPreviewActive(false); // 一旦按箭头就退出「按天预览」，画布跟当前 pose 走
      setOverlapDetails({});
      setStatusMsg('当前姿态：无碰撞。');
      logClientAction('move', detail, 'ok');
    },
    [pose, regionsComplete, poseValid]
  );

  const setTargetFromInputs = useCallback(() => {
    const lr = targetInputs.right - targetInputs.left;
    const ud = targetInputs.down - targetInputs.up;
    const fb = targetInputs.front - targetInputs.back;
    setTargetPose({ lr, ud, fb });
    setStatusMsg('目标位姿已更新。');
  }, [targetInputs]);

  const setAsTarget = useCallback(() => {
    setTargetPose({ ...pose });
    setStatusMsg('已将当前位姿设为目标。');
  }, [pose]);

  const runPlan = useCallback(async () => {
    if (!regionsComplete) {
      setStatusMsg('请先完成四个掩码后再规划。');
      logClientAction('triggerPlan', caseId, 'skip: 四掩码未齐');
      return;
    }
    const startOk = poseValid(pose, false).ok;
    if (!startOk) {
      setStatusMsg('当前姿态已碰撞/越界，无法开始 A*。');
      logClientAction('triggerPlan', caseId, 'blocked: 当前姿态碰撞/越界');
      return;
    }
    const goalOk = poseValid(targetPose, false).ok;
    if (!goalOk) {
      setStatusMsg('目标位姿不可达（碰撞/越界）。');
      logClientAction('triggerPlan', caseId, 'blocked: 目标位姿不可达');
      return;
    }
    setTriggering(true);
    try {
      await triggerPlan(caseId, '2d', {
        startMm: [pose.lr, pose.ud, pose.fb],
        goalMm: [targetPose.lr, targetPose.ud, targetPose.fb],
        frontMmPerPx: frontMmPerPx,
        sideMmPerPx: sideMmPerPx,
        frontRefMaskPath: maskFilePaths.front.reference || undefined,
        frontMovMaskPath: maskFilePaths.front.moving || undefined,
        sideRefMaskPath: maskFilePaths.side.reference || undefined,
        sideMovMaskPath: maskFilePaths.side.moving || undefined,
      });
      const p = await getPlans(caseId);
      const list = Array.isArray(p) ? p : [];
      setPlans(list);
      const plan2d = list.find((x: { algoType: string }) => x.algoType === 'PLAN_2D');
      setCurrentPlan(plan2d ?? null);
      setCurrentDay(0);
      setStatusMsg('A*规划完成。');
      logClientAction('triggerPlan', caseId, 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logClientAction('triggerPlan', caseId, `err: ${msg}`);
    } finally {
      setTriggering(false);
    }
  }, [caseId, regionsComplete, pose, targetPose, poseValid, frontMmPerPx, sideMmPerPx, maskFilePaths]);

  async function handleExportPdf() {
    if (!currentPlan) return;
    const p = currentPlan as { id: string };
    setPdfLoading(true);
    try {
      await downloadPlanPdf(p.id);
    } finally {
      setPdfLoading(false);
    }
  }

  /** 保存方案与最终掩码位置到数据库（更新当前方案的 meta），保存后跳转到3D工作台（如有STL）或保持2D工作台 */
  async function handleSavePlanAndMasks() {
    const p = currentPlan as {
      id: string;
      dailySteps?: Array<{ dayIndex?: number; poseMm?: number[]; deltaMm?: number; cumulativeMm?: number }>;
    } | null;
    if (!p?.id) return;
    const steps = Array.isArray(p.dailySteps) ? p.dailySteps : [];
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : undefined;
    const finalPoseMm = lastStep?.poseMm && lastStep.poseMm.length >= 3 ? lastStep.poseMm : undefined;
    setSavePlanLoading(true);
    try {
      await updatePlan(p.id, {
        meta: {
          maskPathsUsed: {
            frontRef: maskFilePaths.front.reference || null,
            frontMov: maskFilePaths.front.moving || null,
            sideRef: maskFilePaths.side.reference || null,
            sideMov: maskFilePaths.side.moving || null,
          },
          finalPoseMm: finalPoseMm ?? null,
        },
      });
      setStatusMsg('已保存方案与最终掩码位置到数据库。');
      logClientAction('savePlanAndMasks', p.id, 'ok');
      // F1.2: 2D测量保存后，根据是否有STL文件决定跳转方向
      const hasSTL = (files as { type: string }[]).some((f) => f.type === 'STL');
      if (hasSTL) {
        router.push(`/dashboard/cases/${caseId}/plan-3d`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMsg(`保存失败：${msg}`);
      logClientAction('savePlanAndMasks', p.id, `err: ${msg}`);
    } finally {
      setSavePlanLoading(false);
    }
  }

  const activeCandidateMask =
    segView === 'front' && candidates.length > 0 && selectedCandIndices.length > 0
      ? (() => {
          const idx = selectedCandIndices[0];
          const c = candidates[idx];
          return c?.mask ?? null;
        })()
      : segView === 'side' && candidates.length > 0 && selectedCandIndices.length > 0
        ? (() => {
            const idx = selectedCandIndices[0];
            const c = candidates[idx];
            return c?.mask ?? null;
          })()
        : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-medical-muted">加载中…</div>
      </div>
    );
  }

  const c = caseData as { id: string; patient?: { name: string }; doctor?: { name: string } } | null;
  const plan = currentPlan as {
    id: string;
    totalDays?: number;
    totalDistance?: number;
    dailySteps?: unknown[];
    rawPath?: unknown[];
  } | null;
  const dailySteps = plan?.dailySteps && Array.isArray(plan.dailySteps) ? plan.dailySteps : [];
  const maxDayIndex = Math.max(0, dailySteps.length > 0 ? dailySteps.length - 1 : 0);
  const dayIndex = Math.max(0, Math.min(currentDay, maxDayIndex));
  // 演示顺序：Day 0 = 起始，下一天 = 向末位。用反向索引使 Day0 对应路径起点、Day max 对应终点
  const dayStep = dailySteps[maxDayIndex - dayIndex] as
    | {
        dayIndex?: number;
        poseMm?: [number, number, number];
        deltaMm?: number;
        cumulativeMm?: number;
      }
    | undefined;

  const planText =
    plan && dailySteps.length > 0
      ? (() => {
          const rawPath = Array.isArray(plan.rawPath) ? (plan.rawPath as unknown[]) : [];
          const ds = dailySteps as Array<{
            dayIndex?: number;
            poseMm?: [number, number, number];
            deltaMm?: number;
            cumulativeMm?: number;
          }>;
          const lines: string[] = [];
          lines.push(`Path points: ${rawPath.length}`);
          const totalLen =
            typeof plan.totalDistance === 'number'
              ? plan.totalDistance
              : typeof plan.totalDays === 'number' && ds.length > 0
                ? ds[ds.length - 1]!.cumulativeMm ?? 0
                : 0;
          lines.push(`Total length: ${totalLen.toFixed(3)} mm`);
          lines.push(`Days: ${ds.length}`);
          lines.push('--------------------------------------------------------------------------------');
          lines.push('Day | Delta(mm) | Cum(mm) | Pose(mm: lr,ud,fb)');
          for (const d of ds) {
            const idx = typeof d.dayIndex === 'number' ? d.dayIndex : 0;
            const poseMm = Array.isArray(d.poseMm) ? d.poseMm : [0, 0, 0];
            const delta = typeof d.deltaMm === 'number' ? d.deltaMm : 0;
            const cum = typeof d.cumulativeMm === 'number' ? d.cumulativeMm : 0;
            lines.push(
              `${String(idx).padStart(3, ' ')} | ${delta.toFixed(3).padStart(8, ' ')} | ${cum
                .toFixed(3)
                .padStart(7, ' ')} | (${poseMm[0]?.toFixed(3)}, ${poseMm[1]?.toFixed(
                  3,
                )}, ${poseMm[2]?.toFixed(3)})`,
            );
          }
          return lines.join('\n');
        })()
      : '';

  // 画布显示位姿：仅在「按天预览」且当日有 poseMm 时显示该日位姿，否则显示当前 pose（箭头可正常移动）
  const canvasPose: Pose =
    dayPreviewActive && plan && dayStep && Array.isArray(dayStep.poseMm) && dayStep.poseMm.length >= 3
      ? { lr: dayStep.poseMm[0] ?? 0, ud: dayStep.poseMm[1] ?? 0, fb: dayStep.poseMm[2] ?? 0 }
      : pose;

  const posePxFront = poseMmToPx(canvasPose, 'front', frontMmPerPx, sideMmPerPx);
  const posePxSide = poseMmToPx(canvasPose, 'side', frontMmPerPx, sideMmPerPx);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center gap-4">
        <Link
          href={`/dashboard/cases/${caseId}`}
          className="text-sm font-medium text-medical-primary hover:text-medical-primary-hover"
        >
          ← 返回病例
        </Link>
        <h1 className="text-xl font-semibold text-foreground">2D 规划工作台</h1>
        <span className="text-sm text-medical-muted">
          病例 {c?.id} · 患者 {c?.patient?.name ?? '—'} · 医生 {c?.doctor?.name ?? '—'}
        </span>
        {autoSaveStatus && (
          <span className="ml-4 text-xs text-green-600">{autoSaveStatus}</span>
        )}
      </div>
      {statusMsg && <p className="mt-1 text-xs text-medical-muted">{statusMsg}</p>}

      <div className="mt-4 flex flex-1 gap-2 overflow-hidden">
        {/* 左侧：1) 图像+标定 1.5) 四掩码 2) 分割（与 2dmax.py 并排布局一致） */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-medical-border bg-medical-card p-3">
          <section>
            <h2 className="text-sm font-semibold text-foreground">1) 图像导入 + 标定</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs">
                正位 mm/px
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={frontMmPerPx}
                  onChange={(e) => setFrontMmPerPx(Number(e.target.value) || 0.0001)}
                  className="ml-1 w-20 rounded border bg-background px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs">
                侧位 mm/px
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={sideMmPerPx}
                  onChange={(e) => setSideMmPerPx(Number(e.target.value) || 0.0001)}
                  className="ml-1 w-20 rounded border bg-background px-2 py-1 text-sm"
                />
              </label>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">1.5) 四掩码保存记录</h2>
            <p className="text-xs text-medical-muted">正位/侧位 各 Reference + Moving：</p>
            <ul className="mt-1 min-h-[130px] list-none space-y-0.5 text-xs">
              <li>正位 - 基准(reference): {maskFilePaths.front.reference || '未保存'}</li>
              <li>正位 - 矫正(moving): {maskFilePaths.front.moving || '未保存'}</li>
              <li>侧位 - 基准(reference): {maskFilePaths.side.reference || '未保存'}</li>
              <li>侧位 - 矫正(moving): {maskFilePaths.side.moving || '未保存'}</li>
            </ul>
            {maskSaveRoot && <p className="mt-1 truncate text-xs text-medical-muted" title={maskSaveRoot}>保存目录：{maskSaveRoot}</p>}
            <p className="text-xs text-amber-700">
              四区域状态：正位[Ref {segments.front.reference ? '✅' : '❌'} / Mov {segments.front.moving ? '✅' : '❌'}] 侧位[Ref {segments.side.reference ? '✅' : '❌'} / Mov {segments.side.moving ? '✅' : '❌'}]
            </p>
          </section>

          {/* F2.3: 测量历史记录 */}
          <section>
            <h2 className="text-sm font-semibold text-foreground">F2.3) 测量历史记录</h2>
            {measurementLoading ? (
              <p className="text-xs text-medical-muted">加载中…</p>
            ) : measurementHistory.length === 0 ? (
              <p className="text-xs text-medical-muted">暂无历史测量记录</p>
            ) : (
              <div className="mt-1 max-h-40 space-y-2 overflow-auto text-xs">
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
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">2) 分割（正/侧独立）</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                value={segView}
                onChange={(e) => setSegView(e.target.value as ViewKey)}
                className="rounded border bg-background px-2 py-1 text-xs"
              >
                <option value="front">正位(front)</option>
                <option value="side">侧位(side)</option>
              </select>
              <select
                value={segRole}
                onChange={(e) => setSegRole(e.target.value as RoleKey)}
                className="rounded border bg-background px-2 py-1 text-xs"
              >
                <option value="reference">基准区域 Reference</option>
                <option value="moving">矫正区域 Moving</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-medical-muted">
              当前保存目标：{segView === 'front' ? '正位' : '侧位'} - {segRole === 'reference' ? '基准(reference)' : '矫正(moving)'}
            </p>
            <div className="mt-2 flex gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="radio" checked={segEngine === 'classic'} onChange={() => setSegEngine('classic')} />
                Classic
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input type="radio" checked={segEngine === 'sam'} onChange={() => setSegEngine('sam')} />
                SAM(Box)
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={clearPrompts} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20">
                清空
              </button>
              <button type="button" onClick={undoPrompt} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20">
                Undo
              </button>
              <button type="button" onClick={redoPrompt} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20">
                Redo
              </button>
              <button type="button" disabled={predictLoading} onClick={() => predictPrompt()} className="rounded border bg-medical-primary px-2 py-1 text-xs text-white hover:bg-medical-primary-hover disabled:opacity-50">
                {predictLoading ? '预测中…' : '预测'}
              </button>
            </div>
            {candidates.length > 0 && (
              <>
                <p className="mt-2 text-xs">候选（勾选后保存合并）：</p>
                <ul className="max-h-24 overflow-auto">
                  {candidates.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedCandIndices.includes(i)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedCandIndices((prev) => [...prev, i]);
                          else setSelectedCandIndices((prev) => prev.filter((x) => x !== i));
                        }}
                      />
                      [{i}] score={c.score.toFixed(4)}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={saveMaskLoading} onClick={() => commitSeparate()} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">
                    {saveMaskLoading ? '保存中…' : '保存（分别）到当前部位'}
                  </button>
                  <button type="button" disabled={saveMaskLoading} onClick={() => commitUnion()} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">
                    {saveMaskLoading ? '保存中…' : '保存（合并）到当前部位'}
                  </button>
                </div>
              </>
            )}
            <p className="mt-2 text-xs text-medical-muted">
              四区域状态（分割独立/移动协同）：正位[Ref {segments.front.reference ? '✅' : '❌'} / Mov {segments.front.moving ? '✅' : '❌'}] 侧位[Ref {segments.side.reference ? '✅' : '❌'} / Mov {segments.side.moving ? '✅' : '❌'}]
            </p>
          </section>
        </div>

        {/* 中间：正位 | 侧位 并排（与 2dmax splitter 一致） */}
        <div className="flex min-w-0 flex-1 flex-row gap-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-medical-border bg-medical-card p-2">
            <h3 className="text-sm font-medium text-foreground">正位视图（水平=左右，垂直=上下）</h3>
            <p className="text-xs text-medical-muted">画布拖拽画框 → 预测 → 保存到当前部位</p>
            <div className="mt-2 min-h-0 flex-1 overflow-auto">
              <ImageCanvas
                key="front"
                imageUrl={frontUrl}
                viewKey="front"
                box={frontBox}
                onBoxFinal={(box) => handleBoxFinal('front', box)}
                onImageSize={handleImageSize}
                segmentRef={segments.front.reference ?? null}
                segmentMov={segments.front.moving ?? null}
                posePx={posePxFront}
                overlapMask={overlapDetails.front?.overlapMask ?? null}
                candidateMask={segView === 'front' ? activeCandidateMask : null}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-medical-border bg-medical-card p-2">
            <h3 className="text-sm font-medium text-foreground">侧位视图（水平=前后，垂直=上下）</h3>
            <div className="mt-2 min-h-0 flex-1 overflow-auto">
              <ImageCanvas
                key="side"
                imageUrl={sideUrl}
                viewKey="side"
                box={sideBox}
                onBoxFinal={(box) => handleBoxFinal('side', box)}
                onImageSize={handleImageSize}
                segmentRef={segments.side.reference ?? null}
                segmentMov={segments.side.moving ?? null}
                posePx={posePxSide}
                overlapMask={overlapDetails.side?.overlapMask ?? null}
                candidateMask={segView === 'side' ? activeCandidateMask : null}
              />
            </div>
          </div>
        </div>

        {/* 右侧：3) 移动 4) 目标 5) A* 规划（与 2dmax 一致） */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-medical-border bg-medical-card p-3">
          <section>
            <h2 className="text-sm font-semibold text-foreground">3) 实时联动矫正（碰撞自动拦截）</h2>
            <p className="text-xs">当前(mm): 左右={pose.lr.toFixed(2)} 上下={pose.ud.toFixed(2)} 前后={pose.fb.toFixed(2)}</p>
            <p className="text-xs">目标(mm): 左右={targetPose.lr.toFixed(2)} 上下={targetPose.ud.toFixed(2)} 前后={targetPose.fb.toFixed(2)}</p>
            <p className="text-xs">
              Front(LR,UD)=({posePxFront[0]}, {posePxFront[1]}) [FB 不体现] | Side(FB,UD)=({posePxSide[0]},{' '}
              {posePxSide[1]}) [LR 不体现]
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs">箭头步长(mm)</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={stepMm}
                onChange={(e) => setStepMm(Number(e.target.value) || 0.1)}
                className="w-16 rounded border bg-background px-2 py-1 text-sm"
              />
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1">
              <span />
              <button type="button" disabled={!regionsComplete} onClick={() => move(0, -stepMm, 0)} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">↑ 上</button>
              <span />
              <span />
              <span />
              <button type="button" disabled={!regionsComplete} onClick={() => move(-stepMm, 0, 0)} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">← 左</button>
              <span />
              <button type="button" disabled={!regionsComplete} onClick={() => move(stepMm, 0, 0)} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">→ 右</button>
              <button type="button" disabled={!regionsComplete} onClick={() => move(0, 0, -stepMm)} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">后</button>
              <button type="button" disabled={!regionsComplete} onClick={() => move(0, 0, stepMm)} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">前</button>
              <span />
              <button type="button" disabled={!regionsComplete} onClick={() => move(0, stepMm, 0)} className="col-start-2 rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20 disabled:opacity-50">↓ 下</button>
            </div>
            {!regionsComplete && <p className="text-xs text-amber-700">请先完成四个掩码后再移动。</p>}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">4) 输入目标（mm）</h2>
            <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
              <span>左</span> <input type="number" step="0.01" value={targetInputs.left} onChange={(e) => setTargetInputs((t) => ({ ...t, left: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
              <span>右</span> <input type="number" step="0.01" value={targetInputs.right} onChange={(e) => setTargetInputs((t) => ({ ...t, right: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
              <span>上</span> <input type="number" step="0.01" value={targetInputs.up} onChange={(e) => setTargetInputs((t) => ({ ...t, up: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
              <span>下</span> <input type="number" step="0.01" value={targetInputs.down} onChange={(e) => setTargetInputs((t) => ({ ...t, down: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
              <span>前</span> <input type="number" step="0.01" value={targetInputs.front} onChange={(e) => setTargetInputs((t) => ({ ...t, front: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
              <span>后</span> <input type="number" step="0.01" value={targetInputs.back} onChange={(e) => setTargetInputs((t) => ({ ...t, back: Number(e.target.value) || 0 }))} className="w-14 rounded border bg-background px-1 py-0.5" />
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={setTargetFromInputs} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20">
                将输入设为目标
              </button>
              <button type="button" onClick={setAsTarget} className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20">
                将当前位姿设为目标
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">5) A*路径 + 每天≤1mm</h2>
            <button
              type="button"
              disabled={!regionsComplete || triggering}
              onClick={runPlan}
              className="mt-2 w-full rounded bg-medical-primary py-2 text-sm font-medium text-white hover:bg-medical-primary-hover disabled:opacity-50"
            >
              {triggering ? '规划中…' : 'A* 规划到目标'}
            </button>
            {!regionsComplete && <p className="mt-1 text-xs text-amber-700">请先完成四个掩码后再规划。</p>}
            {regionsComplete && (
              <>
                <div className="mt-2 text-xs">
                  <p>总矫正距离: {plan ? (typeof plan.totalDistance === 'number' ? plan.totalDistance.toFixed(3) : '—') : '—'} mm</p>
                  <p>总天数: {plan ? (plan.totalDays ?? dailySteps.length ?? '—') : '—'} 天</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20"
                    onClick={() => {
                      setCurrentDay((d) => Math.max(0, d - 1));
                      setDayPreviewActive(true);
                    }}
                  >
                    上一天
                  </button>
                  <span className="text-xs">
                    Day {dayIndex} / {maxDayIndex}（0=起始→末位）
                  </span>
                  <button
                    type="button"
                    className="rounded border bg-background px-2 py-1 text-xs hover:bg-medical-muted/20"
                    onClick={() => {
                      setCurrentDay((d) => Math.min(maxDayIndex, d + 1));
                      setDayPreviewActive(true);
                    }}
                  >
                    下一天
                  </button>
                </div>
                {planText && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-medical-muted/10 p-2 text-[11px] leading-tight">
                    {planText}
                  </pre>
                )}
                <button
                  type="button"
                  disabled={savePlanLoading}
                  onClick={handleSavePlanAndMasks}
                  className="mt-2 w-full rounded bg-medical-primary py-2 text-sm font-medium text-white hover:bg-medical-primary-hover disabled:opacity-50"
                >
                  {savePlanLoading ? '保存中…' : '保存方案与最终掩码'}
                </button>
                <button
                  type="button"
                  disabled={pdfLoading}
                  onClick={handleExportPdf}
                  className="mt-2 w-full rounded border border-medical-primary bg-transparent py-2 text-sm text-medical-primary hover:bg-medical-primary/10 disabled:opacity-50"
                >
                  {pdfLoading ? '生成中…' : '导出PDF报告'}
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
