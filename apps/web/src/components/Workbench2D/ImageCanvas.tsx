'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

export type Box = [number, number, number, number]; // x1,y1,x2,y2

/** 0/1 mask, row-major [y][x], same size as image */
export type Mask = number[][];

type SegmentOverlay = { mask: Mask; posePx: [number, number]; isRef: boolean };

type Props = {
  imageUrl: string | null;
  viewKey: 'front' | 'side';
  /** 当前绘制的 box（拖拽中或已松开） */
  box: Box | null;
  onBoxFinal: (box: Box) => void;
  onImageSize?: (viewKey: 'front' | 'side', w: number, h: number) => void;
  /** 基准/矫正 overlay */
  segmentRef: Mask | null;
  segmentMov: Mask | null;
  /** 矫正区当前位姿像素偏移（仅更新此位置重绘 overlay，不整图刷新） */
  posePx: [number, number];
  /** 碰撞重叠区域 overlay */
  overlapMask: Mask | null;
  /** 候选预测 overlay（当前视图且未保存时显示） */
  candidateMask: Mask | null;
};

export function ImageCanvas({
  imageUrl,
  viewKey,
  box,
  onBoxFinal,
  segmentRef,
  segmentMov,
  posePx,
  overlapMask,
  candidateMask,
  onImageSize,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [drawingBox, setDrawingBox] = useState<Box | null>(null);
  const startRef = useRef<[number, number] | null>(null);

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImgSize({ w, h });
    onImageSize?.(viewKey, w, h);
  }, [viewKey, onImageSize]);

  // 从容器坐标转图像像素坐标
  const toImageCoords = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const div = containerRef.current;
      const img = imgRef.current;
      if (!div || !img || !imgSize) return null;
      const rect = div.getBoundingClientRect();
      const scaleX = imgSize.w / rect.width;
      const scaleY = imgSize.h / rect.height;
      const x = Math.round((clientX - rect.left) * scaleX);
      const y = Math.round((clientY - rect.top) * scaleY);
      return [Math.max(0, Math.min(imgSize.w, x)), Math.max(0, Math.min(imgSize.h, y))];
    },
    [imgSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!imgSize) return;
      const p = toImageCoords(e.clientX, e.clientY);
      if (!p) return;
      startRef.current = p;
      setDrawingBox([p[0], p[1], p[0], p[1]]);
    },
    [imgSize, toImageCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (startRef.current === null) return;
      const p = toImageCoords(e.clientX, e.clientY);
      if (!p) return;
      const [x1, y1] = startRef.current;
      setDrawingBox([Math.min(x1, p[0]), Math.min(y1, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])]);
    },
    [toImageCoords]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (startRef.current === null) return;
      const p = toImageCoords(e.clientX, e.clientY);
      if (!p) return;
      const [x1, y1] = startRef.current;
      const box: Box = [Math.min(x1, p[0]), Math.min(y1, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])];
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      startRef.current = null;
      setDrawingBox(null);
      if (area >= 4) onBoxFinal(box);
    },
    [toImageCoords, onBoxFinal]
  );

  const handleMouseLeave = useCallback(() => {
    if (startRef.current !== null) {
      startRef.current = null;
      setDrawingBox(null);
    }
  }, []);

  // 只重绘 overlay（更新掩码位置），不整图刷新；与 2dmax update_pose_main 一致
  // 修复：单一 buffer + alpha 混合，避免多次 putImageData 互相覆盖导致只看到最后一层 / 闪烁
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgSize) return;
    const { w, h } = imgSize;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const buffer = new Uint8ClampedArray(w * h * 4);

    const blendPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      const srcA = a / 255;
      const dstA = buffer[i + 3]! / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        buffer[i] = Math.round((r * srcA + buffer[i]! * dstA * (1 - srcA)) / outA);
        buffer[i + 1] = Math.round((g * srcA + buffer[i + 1]! * dstA * (1 - srcA)) / outA);
        buffer[i + 2] = Math.round((b * srcA + buffer[i + 2]! * dstA * (1 - srcA)) / outA);
        buffer[i + 3] = Math.round(outA * 255);
      }
    };

    const drawMask = (mask: Mask, dx: number, dy: number, r: number, g: number, b: number, a: number) => {
      for (let my = 0; my < mask.length; my++) {
        for (let mx = 0; mx < mask[0].length; mx++) {
          if (mask[my][mx]) {
            blendPixel(mx + dx, my + dy, r, g, b, a);
          }
        }
      }
    };

    if (segmentRef) drawMask(segmentRef, 0, 0, 255, 80, 80, 130);
    if (segmentMov) drawMask(segmentMov, posePx[0], posePx[1], 0, 200, 255, 130);
    if (overlapMask) drawMask(overlapMask, 0, 0, 255, 0, 0, 180);
    if (candidateMask) drawMask(candidateMask, 0, 0, 0, 255, 255, 100);

    ctx.putImageData(new ImageData(buffer, w, h), 0, 0);

    const currentBox = drawingBox ?? box;
    if (currentBox) {
      const [x1, y1, x2, y2] = currentBox;
      ctx.strokeStyle = 'rgb(0,255,0)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = 'rgba(0,255,0,0.15)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
  }, [imgSize, segmentRef, segmentMov, posePx[0], posePx[1], overlapMask, candidateMask, box, drawingBox]);

  if (!imageUrl) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded bg-medical-muted/10 text-sm text-medical-muted">
        暂无{viewKey === 'front' ? '正位' : '侧位'}图
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block max-h-[70vh] max-w-full cursor-crosshair overflow-auto rounded bg-medical-muted/10"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt={viewKey === 'front' ? '正位' : '侧位'}
        className="block max-h-[70vh] max-w-full object-contain"
        onLoad={handleImgLoad}
        draggable={false}
        style={{ display: imgSize ? 'block' : 'none' }}
      />
      {imgSize && (
        <canvas
          ref={canvasRef}
          width={imgSize.w}
          height={imgSize.h}
          className="pointer-events-none absolute left-0 top-0 block max-h-[70vh] max-w-full object-contain"
          style={{ width: '100%', height: 'auto' }}
        />
      )}
    </div>
  );
}

/** 从 box 生成矩形 mask（Classic 模拟） */
export function maskFromBox(box: Box, width: number, height: number): Mask {
  const [x1, y1, x2, y2] = box;
  const xMin = Math.max(0, Math.min(x1, x2));
  const xMax = Math.min(width - 1, Math.max(x1, x2));
  const yMin = Math.max(0, Math.min(y1, y2));
  const yMax = Math.min(height - 1, Math.max(y1, y2));
  const mask: Mask = Array(height)
    .fill(0)
    .map(() => Array(width).fill(0));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      mask[y][x] = 1;
    }
  }
  return mask;
}

/** 平移 mask */
export function shiftMask(mask: Mask, dx: number, dy: number): Mask {
  const h = mask.length;
  const w = mask[0].length;
  const out: Mask = Array(h)
    .fill(0)
    .map(() => Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sy = y - dy;
      const sx = x - dx;
      if (sy >= 0 && sy < h && sx >= 0 && sx < w && mask[sy][sx]) out[y][x] = 1;
    }
  }
  return out;
}

/** 膨胀 1 像素 */
export function dilateMask(mask: Mask, k: number = 1): Mask {
  let cur = mask.map((row) => [...row]);
  const h = cur.length;
  const w = cur[0].length;
  for (let step = 0; step < k; step++) {
    const next = cur.map((row) => [...row]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!cur[y][x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) next[ny][nx] = 1;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

/** 重叠像素数 */
export function overlapCount(a: Mask, b: Mask): number {
  let n = 0;
  const h = Math.min(a.length, b.length);
  const w = Math.min(a[0].length, b[0].length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y][x] && b[y][x]) n++;
    }
  }
  return n;
}

/** mask 平移后是否在边界内（与 2dmax _bbox_shift_in_bounds 一致：bbox 在 shape 内） */
export function bboxShiftInBounds(mask: Mask, dx: number, dy: number, width: number, height: number): boolean {
  let minX = 1e9,
    maxX = -1e9,
    minY = 1e9,
    maxY = -1e9;
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < mask[0].length; x++) {
      if (!mask[y][x]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX > maxX) return false; // 空 mask，与 2dmax bbox is None 一致
  return minX + dx >= 0 && minY + dy >= 0 && maxX + dx < width && maxY + dy < height;
}

/** mask 平移后是否在边界内（逐像素版，保留兼容） */
export function maskShiftInBounds(mask: Mask, dx: number, dy: number, width: number, height: number): boolean {
  return bboxShiftInBounds(mask, dx, dy, width, height);
}

/** 生成重叠区域 mask（用于高亮）：moving 平移后与 ref 膨胀 1 的重叠 */
export function computeOverlapMask(mov: Mask, ref: Mask, dx: number, dy: number): Mask {
  const refD = dilateMask(ref, 1);
  const movS = shiftMask(mov, dx, dy);
  const h = Math.min(refD.length, movS.length);
  const w = Math.min(refD[0].length, movS[0].length);
  const out: Mask = Array(h)
    .fill(0)
    .map(() => Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (refD[y][x] && movS[y][x]) out[y][x] = 1;
    }
  }
  return out;
}
