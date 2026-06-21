/** 3D pose: translation (mm) + quaternion (wxyz). Matches CT3D PoseTR. */
export type PoseTR = {
  t: [number, number, number];
  q: [number, number, number, number]; // w, x, y, z
};

export const IDENTITY_POSE: PoseTR = {
  t: [0, 0, 0],
  q: [1, 0, 0, 0],
};

export function quatNorm(q: [number, number, number, number]): [number, number, number, number] {
  const [w, x, y, z] = q;
  const n = Math.sqrt(w * w + x * x + y * y + z * z);
  if (n < 1e-12) return [1, 0, 0, 0];
  return [w / n, x / n, y / n, z / n];
}

/** Rotation angle in degrees between two quaternions. */
export function rotAngleDegBetween(
  q0: [number, number, number, number],
  q1: [number, number, number, number]
): number {
  const a = quatNorm(q0);
  const b = quatNorm(q1);
  const w = Math.max(-1, Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
  return 2 * (Math.acos(w) * 180) / Math.PI;
}

/** Format target pose for display (T and |R| deg). */
export function formatPoseLabel(pose: PoseTR): string {
  const [x, y, z] = pose.t;
  const deg = rotAngleDegBetween([1, 0, 0, 0], pose.q);
  return `T = [${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}] mm\n|R| = ${deg.toFixed(2)} deg`;
}
