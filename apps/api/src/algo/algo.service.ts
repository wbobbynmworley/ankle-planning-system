import { BadGatewayException, Injectable } from '@nestjs/common';

const ALGO_UNREACHABLE_MSG =
  '规划服务未启动或无法连接。请先启动 algo 服务：在项目根目录运行 start.bat，或单独在 apps/algo 目录执行 uvicorn algo.main:app --host 0.0.0.0 --port 8000';

@Injectable()
export class AlgoService {
  private getBaseUrl(): string {
    return process.env.ALGO_SERVICE_URL ?? 'http://localhost:8000';
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const base = this.getBaseUrl();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        throw new BadGatewayException(ALGO_UNREACHABLE_MSG);
      }
      throw new BadGatewayException(`规划服务请求失败: ${msg}`);
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const body = JSON.parse(text) as { detail?: string; message?: string };
        if (body.detail) msg = body.detail;
        else if (body.message) msg = body.message;
      } catch {
        // keep msg as text
      }
      throw new BadGatewayException(`规划服务错误 (${res.status}): ${msg}`);
    }
    return res.json();
  }

  async plan2d(payload: unknown): Promise<{ totalDistance: number; totalDays: number; dailySteps: unknown[]; rawPath: unknown[] }> {
    return this.request('/plan/2d', payload);
  }

  async plan3d(payload: unknown): Promise<{ totalDistance: number; totalDays: number; dailySteps: unknown[]; rawPath: unknown[] }> {
    return this.request('/plan/3d', payload);
  }

  /** 校验多 STL 在目标位姿下三角形级碰撞（与 CT3D 一致）。分机部署时用 stl_b64 传文件内容 */
  async validate3dCollision(payload: { stl_paths?: string[]; stl_b64?: string[]; target_poses: Array<{ t: number[]; q: number[] }> }): Promise<{ collisions: number[][] }> {
    return this.request('/plan/3d/validate-collision', payload);
  }

  /** 与 CT3D 一致：参考固定，其余顺序体素 A* 多骨规划 */
  async plan3dMulti(payload: {
    stl_paths?: string[];
    stl_b64?: string[];
    ref_index: number;
    start_poses: Array<{ t: number[]; q: number[] }>;
    target_poses: Array<{ t: number[]; q: number[] }>;
    max_mm: number;
    max_deg: number;
  }): Promise<{
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
    return this.request('/plan/3d/multi', payload);
  }

  /** 检查规划服务是否可达（供前端显示状态） */
  async checkHealth(): Promise<{ ok: boolean; message?: string }> {
    const base = this.getBaseUrl();
    try {
      const res = await fetch(`${base}/health`, { method: 'GET' });
      if (res.ok) return { ok: true };
      return { ok: false, message: `HTTP ${res.status}` };
    } catch {
      return { ok: false, message: ALGO_UNREACHABLE_MSG };
    }
  }

  /** SAM 分割预测：图像 base64 + box [x1,y1,x2,y2]，返回候选 mask（base64）及 score */
  async segmentationPredict(payload: {
    image_base64: string;
    box: [number, number, number, number];
  }): Promise<{ candidates: Array<{ score: number; mask_base64: string }> }> {
    return this.request('/segmentation/predict', payload);
  }

  /** 掩码后处理（与 2dmax.py 一致：min_area_px=400, morph_k=3） */
  async postprocessMask(mask_base64: string): Promise<{ mask_base64: string }> {
    return this.request('/segmentation/postprocess-mask', { mask_base64 });
  }

  /** 比例球识别：YOLOv8 + Hough 圆，参考球 20mm，返回 mm_per_px、圆心、直径像素 */
  async ratioBall(payload: { image_path?: string; image_base64?: string }): Promise<{
    mm_per_px: number;
    center_px: [number, number];
    diameter_px: number;
    diameter_mm: number;
  }> {
    return this.request('/ratio-ball', payload);
  }

  /** STL 三维转二维：正位图、侧位图 base64 或 URL */
  async stlTo2d(payload: { case_id?: string; stl_paths?: string[] }): Promise<{
    front_base64?: string;
    side_base64?: string;
    front_url?: string;
    side_url?: string;
  }> {
    return this.request('/stl-to-2d', payload);
  }
}
