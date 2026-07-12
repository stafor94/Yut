import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RollAnimation } from '../appState';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  clampUnit,
  easeInCubic,
  easeOutCubic,
  smoothStep,
  type YutRollScenePhase,
} from '../flows/yutRollAnimation';

const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
type ThreeModule = Record<string, any>;
type RendererStatus = 'loading' | 'three' | 'fallback';

type RuntimeStick = {
  group: any;
  spinAxis: any;
  startPosition: any;
  startQuaternion: any;
  phasePosition: any;
  phaseQuaternion: any;
  targetPosition: any;
  targetQuaternion: any;
  flatMark: any;
  roundMarks: any[];
  seed: number;
};

type SceneRuntime = {
  THREE: ThreeModule;
  renderer: any;
  scene: any;
  camera: any;
  sticks: RuntimeStick[];
  phase: YutRollScenePhase;
  phaseStartedAt: number;
  animationStartedAt: number;
  frameId: number;
  resizeObserver: ResizeObserver | null;
  disposed: boolean;
};

let threeModulePromise: Promise<ThreeModule> | null = null;
const loadThreeModule = () => {
  if (!threeModulePromise) {
    threeModulePromise = import(/* @vite-ignore */ THREE_MODULE_URL) as Promise<ThreeModule>;
  }
  return threeModulePromise;
};

void loadThreeModule().catch(() => undefined);

const getPhase = (animation: RollAnimation): YutRollScenePhase => animation.phase ?? 'resolved';
const getFallCount = (animation: RollAnimation) => 'fallCount' in animation ? animation.fallCount ?? 0 : 0;
const seededUnit = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

function createCrossMark(THREE: ThreeModule, material: any, y: number, z: number, inverted = false) {
  const mark = new THREE.Group();
  for (const rotation of [-Math.PI / 4, Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.32), material);
    bar.rotation.y = rotation;
    mark.add(bar);
  }
  mark.position.set(0, y, z);
  if (inverted) mark.rotation.x = Math.PI;
  return mark;
}

function createYutStick(THREE: ThreeModule, index: number) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xb87835, roughness: 0.78, metalness: 0, flatShading: true });
  const flatFace = new THREE.MeshStandardMaterial({ color: 0xf0c47d, roughness: 0.7, metalness: 0 });
  const roundFace = new THREE.MeshStandardMaterial({ color: 0x865027, roughness: 0.84, metalness: 0, flatShading: true });
  const markMaterial = new THREE.MeshStandardMaterial({ color: 0x4d2817, roughness: 0.9, metalness: 0 });

  const center = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.22, 1.55), wood);
  const capGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.22, 8);
  const capFront = new THREE.Mesh(capGeometry, wood);
  const capBack = new THREE.Mesh(capGeometry, wood);
  capFront.position.z = 0.775;
  capBack.position.z = -0.775;

  const top = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.98), flatFace);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.112;
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.94), roundFace);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.112;

  group.add(center, capFront, capBack, top, bottom);
  group.traverse((object: any) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const flatMark = createCrossMark(THREE, markMaterial, 0.124, 0);
  group.add(flatMark);
  const roundMarks = [-0.52, 0, 0.52].map((z) => {
    const mark = createCrossMark(THREE, markMaterial, -0.124, z, true);
    group.add(mark);
    return mark;
  });

  const startPosition = new THREE.Vector3(-0.42 + index * 0.28, -0.28, 1.42 + (index % 2) * 0.12);
  const spinAxis = new THREE.Vector3(
    0.55 + seededUnit(index + 2) * 0.35,
    0.25 + seededUnit(index + 9) * 0.35,
    0.6 + seededUnit(index + 17) * 0.3,
  ).normalize();
  const startQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    -0.45 + index * 0.17,
    -0.65 + index * 0.31,
    0.24 - index * 0.11,
  ));

  group.position.copy(startPosition);
  group.quaternion.copy(startQuaternion);

  return {
    group,
    spinAxis,
    startPosition,
    startQuaternion,
    phasePosition: startPosition.clone(),
    phaseQuaternion: startQuaternion.clone(),
    targetPosition: new THREE.Vector3(),
    targetQuaternion: new THREE.Quaternion(),
    flatMark,
    roundMarks,
    seed: index + 1,
  } satisfies RuntimeStick;
}

function updateStickTargets(runtime: SceneRuntime, animation: RollAnimation) {
  const { THREE } = runtime;
  const phase = getPhase(animation);
  const isPreResult = phase === 'primary' || phase === 'extra-spin';
  runtime.sticks.forEach((entry, index) => {
    const stick = animation.sticks[index] ?? { flat: true, marked: false };
    const fallCount = getFallCount(animation);
    const isFallen = Boolean(!isPreResult && fallCount && index < fallCount);
    const spreadX = -1.38 + index * 0.92;
    const targetX = isFallen ? (index % 2 === 0 ? -2.15 - index * 0.08 : 2.15 + index * 0.08) : spreadX;
    const targetZ = isFallen ? -0.34 + index * 0.35 : -0.28 + (index % 2) * 0.28;
    const yaw = isFallen
      ? (index % 2 === 0 ? -0.9 - index * 0.08 : 0.82 + index * 0.1)
      : -0.2 + index * 0.14;
    const faceRotation = stick.flat ? 0 : Math.PI;
    entry.targetPosition.set(targetX, 0, targetZ);
    entry.targetQuaternion.setFromEuler(new THREE.Euler(
      faceRotation + (isFallen ? 0.14 : 0.025 * (index % 2 === 0 ? -1 : 1)),
      yaw,
      isFallen ? 0.12 * (index % 2 === 0 ? -1 : 1) : -0.035 + index * 0.022,
    ));
    entry.flatMark.visible = !isPreResult && Boolean(stick.flat && stick.marked);
    entry.roundMarks.forEach((mark) => { mark.visible = !isPreResult && !stick.flat; });
  });
}

function capturePhaseStart(runtime: SceneRuntime, phase: YutRollScenePhase) {
  runtime.phase = phase;
  runtime.phaseStartedAt = performance.now();
  runtime.sticks.forEach((entry) => {
    entry.phasePosition.copy(entry.group.position);
    entry.phaseQuaternion.copy(entry.group.quaternion);
  });
}

function setFinalTransforms(runtime: SceneRuntime) {
  runtime.sticks.forEach((entry) => {
    entry.group.position.copy(entry.targetPosition);
    entry.group.quaternion.copy(entry.targetQuaternion);
  });
}

function renderPrimary(runtime: SceneRuntime, elapsedMs: number) {
  const { THREE } = runtime;
  const progress = clampUnit(elapsedMs / LOCAL_ROLL_PRIMARY_MS);
  const rise = easeOutCubic(progress);
  runtime.sticks.forEach((entry, index) => {
    const apexX = -1.08 + index * 0.72;
    const apexZ = -0.38 + (index % 2) * 0.22;
    entry.group.position.set(
      lerp(entry.startPosition.x, apexX, rise),
      lerp(entry.startPosition.y, 2.35 + index * 0.08, rise),
      lerp(entry.startPosition.z, apexZ, rise),
    );
    const spin = new THREE.Quaternion().setFromAxisAngle(entry.spinAxis, progress * Math.PI * (7.2 + index * 0.55));
    entry.group.quaternion.copy(entry.startQuaternion).multiply(spin);
  });
}

function renderExtraSpin(runtime: SceneRuntime, elapsedMs: number) {
  const { THREE } = runtime;
  const seconds = elapsedMs / 1000;
  runtime.sticks.forEach((entry, index) => {
    entry.group.position.set(
      -1.08 + index * 0.72 + Math.sin(seconds * 2.1 + index) * 0.09,
      2.34 + index * 0.08 + Math.sin(seconds * 2.8 + index * 0.8) * 0.12,
      -0.38 + (index % 2) * 0.22 + Math.cos(seconds * 1.9 + index) * 0.08,
    );
    const spin = new THREE.Quaternion().setFromAxisAngle(entry.spinAxis, seconds * (5.4 + index * 0.45));
    entry.group.quaternion.copy(entry.phaseQuaternion).multiply(spin);
  });
}

function renderLanding(runtime: SceneRuntime, elapsedMs: number) {
  const { THREE } = runtime;
  const progress = clampUnit(elapsedMs / LOCAL_ROLL_LANDING_MS);
  const dropProgress = clampUnit((progress - 0.12) / 0.72);
  const positionProgress = easeInCubic(dropProgress);
  const settleProgress = smoothStep(clampUnit((progress - 0.28) / 0.72));
  runtime.sticks.forEach((entry, index) => {
    const hover = Math.sin(progress * Math.PI) * 0.16 * (1 - dropProgress);
    const bounce = progress > 0.82
      ? Math.sin(((progress - 0.82) / 0.18) * Math.PI) * 0.14 * (1 - progress)
      : 0;
    entry.group.position.set(
      lerp(entry.phasePosition.x, entry.targetPosition.x, positionProgress),
      lerp(entry.phasePosition.y, entry.targetPosition.y, positionProgress) + hover + bounce,
      lerp(entry.phasePosition.z, entry.targetPosition.z, positionProgress),
    );
    entry.group.quaternion.copy(entry.phaseQuaternion).slerp(entry.targetQuaternion, settleProgress);
    if (settleProgress < 0.94) {
      const residualSpin = new THREE.Quaternion().setFromAxisAngle(
        entry.spinAxis,
        (1 - settleProgress) * Math.PI * (2.4 + index * 0.28),
      );
      entry.group.quaternion.multiply(residualSpin);
    }
  });
  if (progress >= 1) setFinalTransforms(runtime);
}

function renderResolved(runtime: SceneRuntime, elapsedMs: number) {
  const { THREE } = runtime;
  const progress = clampUnit(elapsedMs / REMOTE_ROLL_PRE_RESULT_MS);
  const ascentProgress = clampUnit(progress / 0.42);
  const descentProgress = clampUnit((progress - 0.42) / 0.58);
  runtime.sticks.forEach((entry, index) => {
    if (progress <= 0.42) {
      const rise = easeOutCubic(ascentProgress);
      entry.group.position.set(
        lerp(entry.startPosition.x, -1.02 + index * 0.68, rise),
        lerp(entry.startPosition.y, 1.82 + index * 0.08, rise),
        lerp(entry.startPosition.z, -0.24 + (index % 2) * 0.2, rise),
      );
      const spin = new THREE.Quaternion().setFromAxisAngle(entry.spinAxis, rise * Math.PI * (4.4 + index * 0.45));
      entry.group.quaternion.copy(entry.startQuaternion).multiply(spin);
      return;
    }
    const fall = easeInCubic(descentProgress);
    const settle = smoothStep(clampUnit((descentProgress - 0.35) / 0.65));
    const bounce = descentProgress > 0.78
      ? Math.sin(((descentProgress - 0.78) / 0.22) * Math.PI) * 0.13 * (1 - descentProgress)
      : 0;
    entry.group.position.set(
      lerp(-1.02 + index * 0.68, entry.targetPosition.x, fall),
      lerp(1.82 + index * 0.08, entry.targetPosition.y, fall) + bounce,
      lerp(-0.24 + (index % 2) * 0.2, entry.targetPosition.z, fall),
    );
    entry.group.quaternion.copy(entry.startQuaternion).slerp(entry.targetQuaternion, settle);
    if (settle < 0.96) {
      const spin = new THREE.Quaternion().setFromAxisAngle(entry.spinAxis, (1 - settle) * Math.PI * (3.2 + index * 0.32));
      entry.group.quaternion.multiply(spin);
    }
  });
  if (progress >= 1) setFinalTransforms(runtime);
}

function disposeRuntime(runtime: SceneRuntime) {
  runtime.disposed = true;
  cancelAnimationFrame(runtime.frameId);
  runtime.resizeObserver?.disconnect();
  runtime.scene.traverse((object: any) => {
    if (!object.isMesh) return;
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material: any) => material?.dispose?.());
  });
  runtime.renderer.dispose();
}

type YutRollSceneProps = {
  rollAnimation: RollAnimation;
  onSettled: () => void;
};

export function YutRollScene({ rollAnimation, onSettled }: YutRollSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const latestAnimationRef = useRef(rollAnimation);
  const settledRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus>('loading');
  const phase = getPhase(rollAnimation);
  const sticksKey = useMemo(
    () => rollAnimation.sticks.map((stick) => `${stick.flat ? 1 : 0}:${stick.marked ? 1 : 0}`).join('|'),
    [rollAnimation.sticks],
  );

  latestAnimationRef.current = rollAnimation;
  onSettledRef.current = onSettled;

  const notifySettled = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSettledRef.current();
  };

  useEffect(() => {
    settledRef.current = false;
    setRendererStatus('loading');
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;

    const setup = async () => {
      try {
        const THREE = await loadThreeModule();
        if (cancelled || !canvasRef.current) return;
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
        camera.position.set(0, 4.9, 6.7);
        camera.lookAt(0, 0.45, -0.1);
        scene.add(new THREE.HemisphereLight(0xfff3d5, 0x4f2c1f, 1.5));
        const keyLight = new THREE.DirectionalLight(0xfff2cf, 2.2);
        keyLight.position.set(-3.4, 6.2, 4.8);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(512, 512);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xf1a764, 0.65);
        fillLight.position.set(4, 2.4, 1);
        scene.add(fillLight);

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(6.2, 4.2),
          new THREE.ShadowMaterial({ color: 0x3c2116, opacity: 0.22 }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.145;
        floor.receiveShadow = true;
        scene.add(floor);

        const sticks = Array.from({ length: 4 }, (_, index) => createYutStick(THREE, index));
        sticks.forEach((entry) => scene.add(entry.group));
        const now = performance.now();
        const runtime: SceneRuntime = {
          THREE,
          renderer,
          scene,
          camera,
          sticks,
          phase: getPhase(latestAnimationRef.current),
          phaseStartedAt: now,
          animationStartedAt: now,
          frameId: 0,
          resizeObserver: null,
          disposed: false,
        };
        runtimeRef.current = runtime;
        updateStickTargets(runtime, latestAnimationRef.current);

        const resize = () => {
          const element = canvas.parentElement;
          if (!element) return;
          const width = Math.max(1, element.clientWidth);
          const height = Math.max(1, element.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resize();
        runtime.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
        runtime.resizeObserver?.observe(canvas.parentElement ?? canvas);

        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const renderFrame = (time: number) => {
          if (runtime.disposed) return;
          const activePhase = runtime.phase;
          const elapsed = time - runtime.phaseStartedAt;
          if (reducedMotion || activePhase === 'result-hold') {
            setFinalTransforms(runtime);
            notifySettled();
          } else if (activePhase === 'primary') {
            renderPrimary(runtime, elapsed);
          } else if (activePhase === 'extra-spin') {
            renderExtraSpin(runtime, elapsed);
          } else if (activePhase === 'landing') {
            renderLanding(runtime, elapsed);
            if (elapsed >= LOCAL_ROLL_LANDING_MS) notifySettled();
          } else {
            renderResolved(runtime, time - runtime.animationStartedAt);
            if (time - runtime.animationStartedAt >= REMOTE_ROLL_PRE_RESULT_MS) notifySettled();
          }
          renderer.render(scene, camera);
          runtime.frameId = requestAnimationFrame(renderFrame);
        };
        runtime.frameId = requestAnimationFrame(renderFrame);
        setRendererStatus('three');
      } catch (error) {
        console.warn('Three.js 윷 애니메이션을 초기화하지 못해 CSS 연출을 사용합니다.', error);
        if (!cancelled) setRendererStatus('fallback');
      }
    };

    void setup();
    return () => {
      cancelled = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) disposeRuntime(runtime);
    };
  }, [rollAnimation.id]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateStickTargets(runtime, rollAnimation);
    if (runtime.phase !== phase) {
      capturePhaseStart(runtime, phase);
      if (phase === 'result-hold') {
        setFinalTransforms(runtime);
        notifySettled();
      }
    }
  }, [phase, sticksKey, getFallCount(rollAnimation)]);

  useEffect(() => {
    if (rendererStatus !== 'fallback') return undefined;
    const delayMs = phase === 'landing'
      ? LOCAL_ROLL_LANDING_MS
      : phase === 'resolved'
        ? REMOTE_ROLL_PRE_RESULT_MS
        : phase === 'result-hold'
          ? 0
          : null;
    if (delayMs === null) return undefined;
    const timer = window.setTimeout(notifySettled, delayMs);
    return () => window.clearTimeout(timer);
  }, [phase, rendererStatus, rollAnimation.id]);

  const isPreResult = phase === 'primary' || phase === 'extra-spin';
  return <div
    className="yut-roll-scene"
    data-testid="yut-roll-scene"
    data-renderer={rendererStatus}
    data-phase={phase}
    data-marked-count={rollAnimation.sticks.filter((stick) => stick.marked).length}
  >
    <canvas ref={canvasRef} className="yut-roll-three-canvas" aria-hidden="true" />
    <div className="roll-sticks-layer yut-roll-css-fallback" aria-hidden="true">
      {rollAnimation.sticks.map((stick, index) => {
        const flatMarkCount = isPreResult ? 0 : stick.flat && stick.marked ? 1 : 0;
        const roundMarkCount = isPreResult ? 0 : stick.flat ? 0 : 3;
        const fallCount = getFallCount(rollAnimation);
        const isFallenStick = Boolean(!isPreResult && fallCount && index < fallCount);
        const faceClassName = isPreResult ? '' : stick.flat ? 'flat' : 'round';
        return <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${faceClassName} ${stick.marked ? 'marked' : ''} ${isFallenStick ? 'fallen' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg`, '--fall-x': `${index % 2 === 0 ? -118 - index * 10 : 118 + index * 8}px`, '--fall-y': `${index < 2 ? -34 + index * 22 : 78 - index * 8}px`, '--fall-rotate': `${index % 2 === 0 ? -64 - index * 18 : 62 + index * 16}deg` } as CSSProperties}>
          <span className="yut-stick-body">
            <i className="yut-stick-flat-face">{Array.from({ length: flatMarkCount }, (_, markIndex) => <span key={`flat-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark"></span>)}</i>
            <i className="yut-stick-round-face">{Array.from({ length: roundMarkCount }, (_, markIndex) => <span key={`round-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark"></span>)}</i>
          </span>
        </span>;
      })}
    </div>
  </div>;
}
