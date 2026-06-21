/**
 * 统一得到 API 基址，且始终以 /api 结尾。
 * NEXT_PUBLIC_API_URL 约定填“后端来源”（可带或不带 /api，例如 https://ankle-api.onrender.com
 * 或 http://localhost:3001），这里统一规范化，避免出现 :3001/auth/login 这类缺少 /api 的 404。
 */
function getApiBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3001/api';
  return '/api';
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const raw = await res.text();
    let msg: string = res.statusText || 'Request failed';
    try {
      const err = JSON.parse(raw) as { detail?: string; message?: string };
      msg = err?.detail ?? err?.message ?? msg;
    } catch {
      if (raw && raw.length < 500) msg = raw;
    }
    const text = Array.isArray(msg) ? msg.join(' ') : typeof msg === 'string' ? msg : 'Request failed';
    throw new Error(text);
  }
  return res.json();
}

export async function login(email: string, password: string) {
  const data = await api<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (typeof window !== 'undefined') localStorage.setItem('token', data.access_token);
  return data;
}

export async function registerDoctor(body: {
  email: string;
  password: string;
  name: string;
  doctorCode: string;
  phone?: string;
}) {
  return api('/auth/register/doctor', { method: 'POST', body: JSON.stringify(body) });
}

export async function registerPatient(body: {
  email: string;
  password: string;
  name: string;
  patientIdNumber: string;
  phone?: string;
}) {
  return api('/auth/register/patient', { method: 'POST', body: JSON.stringify(body) });
}

export async function me() {
  return api<{ ok: boolean }>('/auth/me', { method: 'POST' });
}

export async function getUsers(role?: string) {
  const q = role ? `?role=${role}` : '';
  return api(`/users${q}`);
}

export async function bulkImportDoctors(rows: { name: string; doctorCode: string; phone: string }[]) {
  return api('/users/bulk-import-doctors', { method: 'POST', body: JSON.stringify({ rows }) });
}

export async function getCases(opts?: { search?: string; status?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.page != null) params.set('page', String(opts.page));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const q = params.toString() ? `?${params}` : '';
  return api(`/cases${q}`);
}

export async function getCasesForPlanning() {
  return api('/cases/for-planning');
}

export async function getCase(id: string) {
  return api(`/cases/${id}`);
}

export async function createCase(patientName: string, patientIdNumber: string, description?: string) {
  return api('/cases', {
    method: 'POST',
    body: JSON.stringify({ patientName, patientIdNumber, description }),
  });
}

/** 创建病例并上传影像（至少一种：STL 或 正位图/侧位图） */
export async function createCaseWithFiles(
  patientName: string,
  patientIdNumber: string,
  description: string | undefined,
  files: { stl?: File; front?: File; side?: File },
) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const form = new FormData();
  form.append('patientName', patientName);
  form.append('patientIdNumber', patientIdNumber);
  if (description) form.append('description', description);
  if (files.stl) form.append('stl', files.stl);
  if (files.front) form.append('front', files.front);
  if (files.side) form.append('side', files.side);
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}/cases/with-files`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = err?.message;
    const text = Array.isArray(msg) ? msg.join(' ') : typeof msg === 'string' ? msg : '创建失败';
    throw new Error(text);
  }
  return res.json();
}

export async function updateCase(caseId: string, body: { status?: string; description?: string }) {
  return api(`/cases/${caseId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteCase(caseId: string) {
  return api(`/cases/${caseId}`, { method: 'DELETE' });
}

export async function getFiles(caseId: string) {
  return api(`/files/case/${caseId}`);
}

export async function uploadFile(caseId: string, file: File, type?: string) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const form = new FormData();
  form.append('file', file);
  if (type) form.append('type', type);
  const res = await fetch(`${getApiBase()}/files/upload/${caseId}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Upload failed');
  }
  return res.json();
}

export async function deleteFile(fileId: string) {
  return api(`/files/${fileId}`, { method: 'DELETE' });
}

/** Fetch file binary for display (e.g. images). Caller should revoke the returned URL when done. */
export async function getFileBlob(fileId: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${getApiBase()}/files/download/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to download file');
  return res.blob();
}

export async function getPlans(caseId: string) {
  return api(`/plans/case/${caseId}`);
}

export async function getPlan(planId: string) {
  return api(`/plans/${planId}`);
}

export async function getAlgoHealth() {
  return api<{ ok: boolean; message?: string }>('/plans/algo-health');
}

/** SAM 分割预测：图像 base64 + box [x1,y1,x2,y2]，返回候选 mask（base64）及 score */
export async function predictSegmentation(
  imageBase64: string,
  box: [number, number, number, number]
): Promise<{ candidates: Array<{ score: number; mask_base64: string }> }> {
  return api('/plans/segmentation/predict', {
    method: 'POST',
    body: JSON.stringify({ image_base64: imageBase64, box }),
  });
}

/** 掩码保存（与 2dmax.py 一致：postprocess 后保存到 YYYYMMDD/view_role_engine_ts.png，返回 path） */
export async function saveMask(
  caseId: string,
  view_key: string,
  role: string,
  engine_name: string,
  mask_base64: string
): Promise<{ path: string; mask_save_root: string }> {
  return api('/plans/segmentation/save-mask', {
    method: 'POST',
    body: JSON.stringify({ caseId, view_key, role, engine_name, mask_base64 }),
  });
}

/** 已保存掩码按路径读取为 base64，供前端恢复掩码使用 */
export async function loadSavedMask(path: string): Promise<{ mask_base64: string }> {
  return api('/plans/segmentation/load-mask', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/** 校验 3D 目标位姿三角形级碰撞（与 CT3D 一致，后端用 VTK CollisionDetectionFilter） */
export async function validate3dCollision(
  caseId: string,
  targetPoses: Array<{ t: [number, number, number]; q: [number, number, number, number] }>,
): Promise<{ collisions: number[][] }> {
  return api('/plans/validate-3d-collision', {
    method: 'POST',
    body: JSON.stringify({ caseId, targetPoses }),
  });
}

/** 与 CT3D 一致：参考固定，其余顺序体素 A* 多骨规划。startPoses/targetPoses 与 stlFiles 顺序一致（按 id 排序） */
export async function plan3dMulti(
  caseId: string,
  refId: string,
  startPoses: Array<{ t: number[]; q: number[] }>,
  targetPoses: Array<{ t: number[]; q: number[] }>,
  options?: { max_mm?: number; max_deg?: number },
): Promise<{
  plan_paths: Record<string, Array<{ t: number[]; q: number[] }>>;
  plan_offsets: Record<string, number>;
  plan_steps: Record<string, number>;
  plan_order: string[];
  plan_total_days: number;
  plan_start_poses: Record<string, { t: number[]; q: number[] }>;
  plan_goal_poses: Record<string, { t: number[]; q: number[] }>;
  plan_infos: Array<[string, number, number, string]>;
  total_cost: number;
}> {
  return api('/plans/plan-3d-multi', {
    method: 'POST',
    body: JSON.stringify({
      caseId,
      refId,
      startPoses,
      targetPoses,
      max_mm: options?.max_mm ?? 1,
      max_deg: options?.max_deg ?? 1,
    }),
  });
}

export async function triggerPlan(
  caseId: string,
  algoType: '2d' | '3d',
  params?: {
    startMm?: [number, number, number];
    goalMm?: [number, number, number];
    frontMmPerPx?: number;
    sideMmPerPx?: number;
    frontRefMaskPath?: string;
    frontMovMaskPath?: string;
    sideRefMaskPath?: string;
    sideMovMaskPath?: string;
  },
) {
  return api('/plans/trigger', {
    method: 'POST',
    body: JSON.stringify({ caseId, algoType, ...params }),
  });
}

export async function updatePlan(
  planId: string,
  body: { totalDays?: number; totalDistance?: number; dailySteps?: object; rawPath?: object; meta?: object },
) {
  return api(`/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getPlanPdfUrl(planId: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const url = `${base || ''}/api/plans/${planId}/pdf`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export async function downloadPlanPdf(planId: string) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const base = getApiBase();
  const res = await fetch(`${base}/plans/${planId}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to download PDF');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `plan-${planId}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 保存 3D 多骨规划到数据库（覆盖该病例原有 3D 方案），矫正后位姿写入 meta.finalPoses 供下次读取 */
export async function savePlan3d(
  caseId: string,
  payload: {
    refId: string;
    totalDays: number;
    totalCost?: number;
    dailySteps3D: Array<{
      dayIndex: number;
      boneId: string;
      boneName?: string;
      poseMm: [number, number, number];
      deltaMm?: number;
      cumulativeMm?: number;
      rotDeg?: number;
    }>;
    planPaths: Record<string, Array<{ t: number[]; q: number[] }>>;
    planOffsets: Record<string, number>;
    planSteps: Record<string, number>;
    planOrder: string[];
    planStartPoses: Record<string, { t: number[]; q: number[] }>;
    planGoalPoses: Record<string, { t: number[]; q: number[] }>;
  }
) {
  return api<{ id: string; caseId: string; algoType: string; totalDays: number; totalDistance: number }>(
    '/plans/save-plan-3d',
    { method: 'POST', body: JSON.stringify({ caseId, ...payload }) }
  );
}

/** 3D 规划报告 PDF（格式与二维规划设计一致，按天表格） */
export async function downloadPlanPdf3d(
  caseId: string,
  payload: {
    totalDays: number;
    totalCost?: number;
    dailySteps3D: Array<{
      dayIndex: number;
      boneId: string;
      boneName?: string;
      poseMm: [number, number, number];
      deltaMm?: number;
      cumulativeMm?: number;
      rotDeg?: number;
    }>;
  }
) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const base = getApiBase();
  const res = await fetch(`${base}/plans/export-pdf-3d`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ caseId, ...payload }),
  });
  if (!res.ok) throw new Error('Failed to download PDF');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `plan-3d-${caseId}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function getLogs(limit?: number) {
  const q = limit != null ? `?limit=${limit}` : '';
  return api(`/logs${q}`);
}

export async function getMeasurements(caseId: string, stage: string) {
  return api(`/measurements?caseId=${encodeURIComponent(caseId)}&stage=${encodeURIComponent(stage)}`);
}

export async function createMeasurement(data: {
  caseId: string;
  stage: string;
  viewKey?: string;
  values: Record<string, number | string>;
}) {
  return api('/measurements', { method: 'POST', body: JSON.stringify(data) });
}

export async function getInstrumentsRings(activeOnly = true) {
  return api(`/instruments/rings${activeOnly ? '' : '?active=false'}`);
}

export async function getInstrumentsRods(activeOnly = true) {
  return api(`/instruments/rods${activeOnly ? '' : '?active=false'}`);
}

export async function getInstrumentsCombinations(activeOnly = true) {
  return api(`/instruments/combinations${activeOnly ? '' : '?active=false'}`);
}

export async function calculateScales(body: {
  caseId: string;
  measurementId?: string;
  measurementSummary?: Record<string, number>;
  instrumentConfig: {
    referenceRingId?: string;
    movingRingId?: string;
    rotationDirection?: '内旋' | '外旋';
    rotationAngle?: number;
    rodIds?: string[];
    combinationId?: string;
  };
}) {
  return api<{ rods: Array<{ rodIndex: number; scale: number; lengthMm: number }> }>('/plans/calculate-scales', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function ratioBall(payload: { image_path?: string; image_base64?: string }) {
  return api<{ mm_per_px: number; center_px: [number, number]; diameter_px: number; diameter_mm: number }>(
    '/plans/ratio-ball',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function stlTo2d(payload: { case_id?: string; stl_paths?: string[] }) {
  return api<{ front_base64?: string; side_base64?: string; side_url?: string; front_url?: string; error?: string; message?: string }>(
    '/plans/stl-to-2d',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function getExecutionPatients() {
  return api('/execution/patients');
}

export async function getExecutionPlan(caseId: string) {
  return api(`/execution/plan/${caseId}`);
}

export async function updateExecutionStep(
  caseId: string,
  stepIndex: number,
  body: {
    planTime?: string;
    rod1Scale?: number;
    rod2Scale?: number;
    rod3Scale?: number;
    rod4Scale?: number;
    rod5Scale?: number;
    rod6Scale?: number;
    rod1Length?: number;
    rod2Length?: number;
    rod3Length?: number;
    rod4Length?: number;
    rod5Length?: number;
    rod6Length?: number;
    completed?: boolean;
  }
) {
  return api(`/execution/plan/${caseId}/steps/${stepIndex}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** 患者记录当日矫正执行步数 */
export async function recordExecution(body: {
  caseId: string;
  stepIndex: number;
  completed?: boolean;
  actualSteps?: number;
  note?: string;
}) {
  return api('/execution/record', { method: 'POST', body: JSON.stringify(body) });
}

/** 患者获取治疗进度总览 */
export async function getPatientProgressOverview() {
  return api('/execution/progress/overview');
}

export async function getPermsRoles() {
  return api<{ role: string; label: string }[]>('/perms/roles');
}

export async function getPermsFunction(role?: string) {
  const q = role ? `?role=${encodeURIComponent(role)}` : '';
  return api(`/perms/function${q}`);
}

export async function setPermsFunction(role: string, permissions: Array<{ resource: string; action: string; allowed: boolean }>) {
  return api('/perms/function', { method: 'PUT', body: JSON.stringify({ role, permissions }) });
}

export async function getPermsData(role?: string) {
  const q = role ? `?role=${encodeURIComponent(role)}` : '';
  return api(`/perms/data${q}`);
}

export async function setPermsData(role: string, scope: string, resource?: string) {
  return api('/perms/data', { method: 'PUT', body: JSON.stringify({ role, scope, resource }) });
}

/** 前端操作上报到 API 窗口（bat 开的 log），便于排查：点了什么、后端是否成功 */
export function logClientAction(action: string, detail?: string, result?: string) {
  if (typeof window === 'undefined') return;
  api('/logs/client-action', {
    method: 'POST',
    body: JSON.stringify({ action, detail, result }),
  }).catch(() => {});
}
