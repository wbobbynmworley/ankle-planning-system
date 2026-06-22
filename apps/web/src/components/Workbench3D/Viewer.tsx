'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { getFileBlob } from '@/lib/api';
import type { PoseTR } from '@/lib/pose3d';

export type MeshItem = {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
};

export type Workbench3DViewerProps = {
  stlFiles: { id: string; originalName?: string }[];
  /** Current/display pose per mesh (solid) */
  poses: Record<string, PoseTR>;
  /** Target pose per mesh (wireframe) */
  targetPoses: Record<string, PoseTR>;
  refId: string | null;
  selectedIds: string[];
  showTargetWireframe: boolean;
  hideNonRefOriginal: boolean;
  /** When true and exactly one non-ref selected, that mesh target can be rotated by mouse */
  mouseRotateTarget: boolean;
  onTargetPoseChange: (id: string, pose: PoseTR) => void;
};

function quatWxyzToThree(q: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(q[1], q[2], q[3], q[0]);
}

function threeToQuatWxyz(q: THREE.Quaternion): [number, number, number, number] {
  return [q.w, q.x, q.y, q.z];
}

function SingleMesh({
  item,
  pose,
  color,
  wireframe,
  visible,
}: {
  item: MeshItem;
  pose: PoseTR;
  color: string;
  wireframe: boolean;
  visible: boolean;
}) {
  const [x, y, z] = pose.t;
  const quat = quatWxyzToThree(pose.q);
  return (
    <group position={[x, y, z]} quaternion={quat} visible={visible}>
      <mesh geometry={item.geometry}>
        {wireframe ? (
          <meshBasicMaterial color={color} wireframe />
        ) : (
          <meshStandardMaterial color={color} metalness={0.2} roughness={0.6} />
        )}
      </mesh>
    </group>
  );
}

/**
 * 旋转目标 gizmo：挂载时一次性把不可见网格设到初始目标位姿，之后**完全交给 TransformControls
 * 直接操作 three 对象**——group 不再绑定声明式 position/quaternion，避免 React 每次重渲染把
 * 位姿写回去、与拖动相互顶撞（之前旋转拖不动的根因）。拖动时通过 onObjectChange 把新位姿回传。
 * 组件由父级用 key={activeId} 控制，切换选中模型时会重新挂载并重置初始位姿。
 */
function TargetGizmo({
  item,
  initialPose,
  onChange,
}: {
  item: MeshItem;
  initialPose: PoseTR;
  onChange: (pose: PoseTR) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.set(initialPose.t[0], initialPose.t[1], initialPose.t[2]);
    g.quaternion.copy(quatWxyzToThree(initialPose.q));
    g.updateMatrixWorld();
    // 仅在挂载/切换模型时初始化一次；拖动期间不再被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <TransformControls
      mode="rotate"
      size={0.8}
      onObjectChange={() => {
        const g = groupRef.current;
        if (!g) return;
        onChange({
          t: [g.position.x, g.position.y, g.position.z],
          q: threeToQuatWxyz(g.quaternion),
        });
      }}
    >
      <group ref={groupRef}>
        <mesh geometry={item.geometry}>
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
    </TransformControls>
  );
}

function SceneContent({
  meshes,
  poses,
  targetPoses,
  refId,
  selectedIds,
  showTargetWireframe,
  hideNonRefOriginal,
  mouseRotateTarget,
  onTargetPoseChange,
}: {
  meshes: MeshItem[];
  poses: Record<string, PoseTR>;
  targetPoses: Record<string, PoseTR>;
  refId: string | null;
  selectedIds: string[];
  showTargetWireframe: boolean;
  hideNonRefOriginal: boolean;
  mouseRotateTarget: boolean;
  onTargetPoseChange: (id: string, pose: PoseTR) => void;
}) {
  const activeId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const isActiveNonRef = activeId && activeId !== refId;
  const showTransform = mouseRotateTarget && !!isActiveNonRef;
  const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd'];

  const shouldShowOriginal = useCallback(
    (id: string) => {
      if (!hideNonRefOriginal) return true;
      return id === refId;
    },
    [hideNonRefOriginal, refId]
  );

  const activeItem = activeId ? meshes.find((m) => m.id === activeId) : null;
  const activeTargetPose = activeId ? (targetPoses[activeId] ?? { t: [0, 0, 0], q: [1, 0, 0, 0] }) : null;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[80, 120, 100]} intensity={0.9} />
      <directionalLight position={[-60, -80, -40]} intensity={0.4} />
      <axesHelper args={[40]} />
      <gridHelper args={[200, 40]} position={[0, -60, 0]} />

      {meshes.map((m, idx) => {
        const pose = poses[m.id] ?? { t: [0, 0, 0], q: [1, 0, 0, 0] };
        const targetPose = targetPoses[m.id] ?? pose;
        const visible = shouldShowOriginal(m.id);
        const color = colors[idx % colors.length];
        const isSelected = selectedIds.includes(m.id);
        const solidColor = isSelected ? '#ffd700' : color;

        return (
          <group key={m.id}>
            <SingleMesh
              item={m}
              pose={pose}
              color={solidColor}
              wireframe={false}
              visible={visible}
            />
            {showTargetWireframe && (
              <SingleMesh
                item={m}
                pose={targetPose}
                color={isSelected ? '#ff8c00' : '#19c119'}
                wireframe
                visible
              />
            )}
          </group>
        );
      })}

      {showTransform && activeId && activeItem && activeTargetPose && (
        <TargetGizmo
          key={activeId}
          item={activeItem}
          initialPose={activeTargetPose}
          onChange={(pose) => onTargetPoseChange(activeId, pose)}
        />
      )}

      {/* 相机控制：开启阻尼 + 调速，拖动更顺滑跟手 */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.65}
        zoomSpeed={0.8}
        panSpeed={0.7}
      />
    </>
  );
}

export function Workbench3DViewer({
  stlFiles,
  poses,
  targetPoses,
  refId,
  selectedIds,
  showTargetWireframe,
  hideNonRefOriginal,
  mouseRotateTarget,
  onTargetPoseChange,
}: Workbench3DViewerProps) {
  const [meshes, setMeshes] = useState<MeshItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loader = new STLLoader();
    const urls: string[] = [];

    async function load() {
      const next: MeshItem[] = [];
      for (const f of stlFiles) {
        try {
          const blob = await getFileBlob(f.id);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const geom = (await loader.loadAsync(url)) as THREE.BufferGeometry;
          next.push({
            id: f.id,
            name: f.originalName ?? f.id,
            geometry: geom,
          });
        } catch {
          // ignore single file failure
        }
      }
      if (!cancelled) {
        setMeshes(next);
      } else {
        next.forEach((m) => m.geometry.dispose());
      }
    }

    load();

    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [JSON.stringify(stlFiles.map((f) => f.id))]);

  return (
    <div
      className="h-[420px] w-full rounded-lg border border-medical-border bg-black/95"
      style={{ pointerEvents: 'auto' }}
    >
      <Canvas
        camera={{ position: [120, 120, 120], fov: 40 }}
        style={{ display: 'block' }}
        gl={{ powerPreference: 'high-performance', antialias: true }}
        onCreated={({ gl, invalidate }) => {
          const canvas = gl.domElement;
          // 关键：默认情况下 WebGL 上下文丢失后不会自动恢复，画布会永久冻结（拖动失灵）。
          // preventDefault 允许浏览器触发 contextrestored，恢复后重绘。
          canvas.addEventListener(
            'webglcontextlost',
            (e) => {
              e.preventDefault();
            },
            false,
          );
          canvas.addEventListener('webglcontextrestored', () => invalidate(), false);
        }}
      >
        <SceneContent
          meshes={meshes}
          poses={poses}
          targetPoses={targetPoses}
          refId={refId}
          selectedIds={selectedIds}
          showTargetWireframe={showTargetWireframe}
          hideNonRefOriginal={hideNonRefOriginal}
          mouseRotateTarget={mouseRotateTarget}
          onTargetPoseChange={onTargetPoseChange}
        />
      </Canvas>
    </div>
  );
}
