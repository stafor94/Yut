import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RollAnimation } from '../appState';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  clampUnit,
  smoothStep,
  type YutRollScenePhase,
} from '../flows/yutRollAnimation';
import {
  EXTRA_SPIN_RADIANS_PER_SECOND_BASE,
  EXTRA_SPIN_RADIANS_PER_SECOND_STEP,
  LANDING_FLIGHT_SPIN_TURNS_BASE,
  LANDING_FLIGHT_SPIN_TURNS_STEP,
  PRIMARY_SPIN_TURNS_BASE,
  PRIMARY_SPIN_TURNS_STEP,
  getFallLandingMotion,
  getLandingMotion,
  getPrimaryHorizontalProgress,
  getPrimaryThrowHeight,
  getRemoteTimelineElapsedMs,
} from '../flows/yutRollMotion';
import {
  getYutRollFallTarget,
  getYutRollMatWorldBounds,
  getYutRollSceneFraming,
  type YutRollMatWorldBounds,
} from '../flows/yutRollSceneLayout';

const THREE_MODULE_URLS = [
  'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js',
  'https://unpkg.com/three@0.154.0/build/three.module.js',
] as const;

type ThreeModule = Record<string, any>;
type RendererStatus = 'loading' | 'three' | 'fallback';

type RuntimeStick = {
  group: any;
  spinAxis: any;
  startPosition: any;
  startQuaternion: any;
  phasePosition: any;
  phaseQuaternion: any;
  fallImpactPosition: any;
  fallEdgePosition: any;
  targetPosition: any;
  targetQuaternion: any;
  flatMark: any;
  roundMarks: any[];
  isFallen: boolean;
};

type SceneRuntime = {
  THREE: ThreeModule;
  renderer: any;
  scene: any;
  camera: any;
  sticks: RuntimeStick[];
  matBounds: YutRollMatWorldBounds;
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
    threeModulePromise = (async () => {
      let lastError: unknown;
      for (const url of THREE_MODULE_URLS) {
        try {
          return await import(/* @vite-ignore */ url) as ThreeModule;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    })();
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
const getPrimarySpinTurns = (index: number) => PRIMARY_SPIN_TURNS_BASE + index * PRIMARY_SPIN_TURNS_STEP;
const getLandingSpinTurns = (index: number) => LANDING_FLIGHT_SPIN_TURNS_BASE + index * LANDING_FLIGHT_SPIN_TURNS_STEP;

function getAnimationAgeMs(animation: RollAnimation) {
  const animationId = Number(animation.id);
  if (!Number.isFinite(animationId) || animationId <= 0) return 0;
  return Math.max(0, Date.now() - animationId);
}

function getRuntimeInitialPhase(animation: RollAnimation): YutRollScenePhase {
  const phase = getPhase(animation);
  if (phase === 'result-hold' && getAnimationAgeMs(animation) < LOCAL_ROLL_PRE_RESULT_MS) return 'landing';
  return phase;
}

function getInitialPhaseElapsedMs(animation: RollAnimation, phase: YutRollScenePhase) {
  const animationAgeMs = getAnimationAgeMs(animation);
  if (phase === 'primary') return Math.min(animationAgeMs, LOCAL_ROLL_PRIMARY_MS);
  if (phase === 'extra-spin') return Math.max(0, animationAgeMs - LOCAL_ROLL_PRIMARY_MS);
  if (phase === 'landing') return Math.min(Math.max(0, animationAgeMs - LOCAL_ROLL_PRIMARY_MS), LOCAL_ROLL_LANDING_MS);
  if (phase === 'resolved') return Math.min(animationAgeMs, REMOTE_ROLL_PRE_RESULT_MS);
  return 0;
}

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

function createYutStick(THREE: ThreeModule, index: number): RuntimeStick {
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
  const startPosition = new THREE.Vector3(-0.54 + index * 0.36, -0.14, 1.02 + (index % 2) * 0.1);
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
    fallImpactPosition: startPosition.clone(),
    fallEdgePosition: startPosition.clone(),
    targetPosition: new THREE.Vector3(),
    targetQuaternion: new THREE.Quaternion(),
    flatMark,
    roundMarks,
    isFallen: false,
  };
}

function updateStickTargets(runtime: SceneRuntime, animation: RollAnimation) {
  const { THREE } = runtime;
  const phase = getPhase(animation);
  const isPreResult = phase === 'primary' || phase === 'extra-spin';
  runtime.sticks.forEach((entry, index) => {
    const stick = animation.sticks[index] ?? { flat: true, marked: false };
    const fallCount = getFallCount(animation);
    const isFallen = Boolean(!isPreResult && fallCount && index < fallCount);
    const spreadX = -1.32 + index * 0.88;
    const fallTarget = getYutRollFallTarget(index, runtime.matBounds);
    const fallImpactInset = 0.72 + (index >= 2 ? 0.12 : 0);
    const yaw = isFallen ? (index % 2 === 0 ? -0.9 - index * 0.08 : 0.82 + index * 0.1) : -0.2 + index * 0.14;
    entry.isFallen = isFallen;
    entry.fallImpactPosition.set(
      fallTarget.edgeX - fallTarget.side * fallImpactInset,
      0,
      -0.24 + (index % 2) * 0.24,
    );
    entry.fallEdgePosition.set(fallTarget.edgeX + fallTarget.side * 0.05, 0.04, fallTarget.z);
    entry.targetPosition.set(
      isFallen ? fallTarget.x : spreadX,
      isFallen ? fallTarget.y : 0,
      isFallen ? fallTarget.z : -0.24 + (index % 2) * 0.24,
    );
    entry.targetQuaternion.setFromEuler(new THREE.Euler(
      (stick.flat ? 0 : Math.PI) + (isFallen ? 0.18 : 0.025 * (index % 2 === 0 ? -1 : 1)),
      yaw,
      isFallen ? 0.18 * (index % 2 === 0 ? -1 : 1) : -0.035 + index * 0.022,
    ));
    entry.group.visible = !(isFallen && phase === 'result-hold' && runtime.phase !== 'landing');
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
    entry.group.visible = !entry.isFallen;
  });
}

function getPrimaryEndPosition(entry: RuntimeStick, index: number) {
  return {
    x: -1.02 + index * 0.68,
    y: getPrimaryThrowHeight(entry.startPosition.y, 1, index),
    z: -0.3 + (index % 2) * 0.2,
  };
}

function getPrimaryEndQuaternion(runtime: SceneRuntime, entry: RuntimeStick, index: number) {
  const spin = new runtime.THREE.Quaternion().setFromAxisAngle(entry.spinAxis, Math.PI * 2 * getPrimarySpinTurns(index));
  return entry.startQuaternion.clone().multiply(spin);
}

function renderPrimary(runtime: SceneRuntime, elapsedMs: number) {
  const progress = clampUnit(elapsedMs / LOCAL_ROLL_PRIMARY_MS);
  const horizontalProgress = getPrimaryHorizontalProgress(progress);
  runtime.sticks.forEach((entry, index) => {
    entry.group.visible = true;
    const end = getPrimaryEndPosition(entry, index);
    entry.group.position.set(
      lerp(entry.startPosition.x, end.x, horizontalProgress),
      getPrimaryThrowHeight(entry.startPosition.y, progress, index),
      lerp(entry.startPosition.z, end.z, horizontalProgress),
    );
    const spin = new runtime.THREE.Quaternion().setFromAxisAngle(
      entry.spinAxis,
      progress * Math.PI * 2 * getPrimarySpinTurns(index),
    );
    entry.group.quaternion.copy(entry.startQuaternion).multiply(spin);
  });
}

function renderExtraSpin(runtime: SceneRuntime, elapsedMs: number) {
  const seconds = elapsedMs / 1000;
  runtime.sticks.forEach((entry, index) => {
    entry.group.visible = true;
    const end = getPrimaryEndPosition(entry, index);
    const drift = Math.min(0.62, seconds * 0.3);
    entry.group.position.set(
      end.x + Math.sin(seconds * 2 + index) * 0.1,
      end.y - drift + Math.sin(seconds * 2.7 + index * 0.7) * 0.06,
      end.z + Math.cos(seconds * 1.8 + index) * 0.08,
    );
    const spin = new runtime.THREE.Quaternion().setFromAxisAngle(
      entry.spinAxis,
      seconds * (EXTRA_SPIN_RADIANS_PER_SECOND_BASE + index * EXTRA_SPIN_RADIANS_PER_SECOND_STEP),
    );
    entry.group.quaternion.copy(entry.phaseQuaternion).multiply(spin);
  });
}

function applyLandingRotation(
  runtime: SceneRuntime,
  entry: RuntimeStick,
  index: number,
  flightProgress: number,
  settleProgress: number,
  wobbleRadians: number,
  rollOffsetX: number,
  rollOffsetZ: number,
  phaseQuaternion?: any,
) {
  const startQuaternion = phaseQuaternion ?? entry.phaseQuaternion;
  const flightTurns = getLandingSpinTurns(index);
  if (settleProgress <= 0) {
    const freeSpin = new runtime.THREE.Quaternion().setFromAxisAngle(
      entry.spinAxis,
      flightProgress * Math.PI * 2 * flightTurns,
    );
    entry.group.quaternion.copy(startQuaternion).multiply(freeSpin);
    return;
  }

  const impactSpin = new runtime.THREE.Quaternion().setFromAxisAngle(entry.spinAxis, Math.PI * 2 * flightTurns);
  const impactQuaternion = startQuaternion.clone().multiply(impactSpin);
  const settled = smoothStep(settleProgress);
  entry.group.quaternion.copy(impactQuaternion).slerp(entry.targetQuaternion, settled);
  if (wobbleRadians !== 0) {
    const rollAxis = new runtime.THREE.Vector3(rollOffsetZ, 0, -rollOffsetX).normalize();
    entry.group.quaternion.multiply(new runtime.THREE.Quaternion().setFromAxisAngle(rollAxis, wobbleRadians));
  }
}

function renderLanding(runtime: SceneRuntime, elapsedMs: number, fromPrimaryEnd = false) {
  const progress = clampUnit(elapsedMs / LOCAL_ROLL_LANDING_MS);
  runtime.sticks.forEach((entry, index) => {
    const motion = getLandingMotion(progress, index);
    const startPosition = fromPrimaryEnd ? getPrimaryEndPosition(entry, index) : entry.phasePosition;
    const startQuaternion = fromPrimaryEnd ? getPrimaryEndQuaternion(runtime, entry, index) : entry.phaseQuaternion;

    if (entry.isFallen) {
      const fallMotion = getFallLandingMotion(progress);
      const flightX = lerp(startPosition.x, entry.fallImpactPosition.x, motion.dropProgress);
      const flightY = lerp(startPosition.y, entry.fallImpactPosition.y, motion.dropProgress);
      const flightZ = lerp(startPosition.z, entry.fallImpactPosition.z, motion.dropProgress);
      const surfaceX = lerp(flightX, entry.fallEdgePosition.x, fallMotion.onMatRollProgress);
      const surfaceY = lerp(flightY, entry.fallEdgePosition.y, fallMotion.onMatRollProgress)
        + motion.bounceHeight * fallMotion.bounceScale;
      const surfaceZ = lerp(flightZ, entry.fallEdgePosition.z, fallMotion.onMatRollProgress);
      entry.group.position.set(
        lerp(surfaceX, entry.targetPosition.x, fallMotion.exitProgress),
        lerp(surfaceY, entry.targetPosition.y, fallMotion.exitProgress),
        lerp(surfaceZ, entry.targetPosition.z, fallMotion.exitProgress),
      );
      applyLandingRotation(
        runtime,
        entry,
        index,
        motion.flightProgress,
        motion.settleProgress,
        motion.wobbleRadians * fallMotion.bounceScale,
        motion.rollOffsetX,
        motion.rollOffsetZ,
        startQuaternion,
      );
      const exitDirection = entry.targetPosition.x >= entry.fallEdgePosition.x ? 1 : -1;
      const rollRadians = -exitDirection * (
        fallMotion.onMatRollProgress * Math.PI * 1.35
        + fallMotion.exitProgress * Math.PI * 0.85
      );
      entry.group.quaternion.multiply(new runtime.THREE.Quaternion().setFromAxisAngle(
        new runtime.THREE.Vector3(0, 0, 1),
        rollRadians,
      ));
      entry.group.visible = progress < 0.97;
      return;
    }

    const impactX = entry.targetPosition.x - motion.rollOffsetX;
    const impactZ = entry.targetPosition.z - motion.rollOffsetZ;
    const flightX = lerp(startPosition.x, impactX, motion.dropProgress);
    const flightY = lerp(startPosition.y, entry.targetPosition.y, motion.dropProgress);
    const flightZ = lerp(startPosition.z, impactZ, motion.dropProgress);
    entry.group.position.set(
      lerp(flightX, entry.targetPosition.x, motion.slideProgress),
      lerp(flightY, entry.targetPosition.y, motion.slideProgress) + motion.bounceHeight,
      lerp(flightZ, entry.targetPosition.z, motion.slideProgress),
    );
    applyLandingRotation(
      runtime,
      entry,
      index,
      motion.flightProgress,
      motion.settleProgress,
      motion.wobbleRadians,
      motion.rollOffsetX,
      motion.rollOffsetZ,
      startQuaternion,
    );
  });
  if (progress >= 1) setFinalTransforms(runtime);
}

function renderResolved(runtime: SceneRuntime, elapsedMs: number) {
  const localElapsedMs = getRemoteTimelineElapsedMs(elapsedMs);
  if (localElapsedMs < LOCAL_ROLL_PRIMARY_MS) {
    renderPrimary(runtime, localElapsedMs);
    return;
  }
  renderLanding(runtime, localElapsedMs - LOCAL_ROLL_PRIMARY_MS, true);
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

type YutRollSceneProps = { rollAnimation: RollAnimation; onSettled: () => void };

export function YutRollScenePhysics({ rollAnimation, onSettled }: YutRollSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const latestAnimationRef = useRef(rollAnimation);
  const settledRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  const landingStartedAtRef = useRef<number | null>(null);
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
    landingStartedAtRef.current = null;
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
        const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
        scene.add(new THREE.HemisphereLight(0xfff3d5, 0x4f2c1f, 1.5));
        const keyLight = new THREE.DirectionalLight(0xfff2cf, 2.2);
        keyLight.position.set(-3.4, 6.2, 4.8);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(512, 512);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xf1a764, 0.65);
        fillLight.position.set(4, 2.4, 1);
        scene.add(fillLight);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 4.8), new THREE.ShadowMaterial({ color: 0x3c2116, opacity: 0.22 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.145;
        floor.receiveShadow = true;
        scene.add(floor);

        const sticks = Array.from({ length: 4 }, (_, index) => createYutStick(THREE, index));
        sticks.forEach((entry) => scene.add(entry.group));
        const initialAnimation = latestAnimationRef.current;
        const initialPhase = getRuntimeInitialPhase(initialAnimation);
        const now = performance.now();
        const initialPhaseElapsedMs = getInitialPhaseElapsedMs(initialAnimation, initialPhase);
        const initialAnimationElapsedMs = initialPhase === 'resolved' ? Math.min(getAnimationAgeMs(initialAnimation), REMOTE_ROLL_PRE_RESULT_MS) : 0;
        const runtime: SceneRuntime = {
          THREE,
          renderer,
          scene,
          camera,
          sticks,
          matBounds: getYutRollMatWorldBounds(620, 430, 96, 524),
          phase: initialPhase,
          phaseStartedAt: now - initialPhaseElapsedMs,
          animationStartedAt: now - initialAnimationElapsedMs,
          frameId: 0,
          resizeObserver: null,
          disposed: false,
        };
        runtimeRef.current = runtime;
        if (initialPhase === 'landing') landingStartedAtRef.current = runtime.phaseStartedAt;

        const resize = () => {
          const element = canvas.parentElement;
          if (!element) return;
          const width = Math.max(1, element.clientWidth);
          const height = Math.max(1, element.clientHeight);
          const framing = getYutRollSceneFraming(width, height);
          const sceneRect = element.getBoundingClientRect();
          const matNode = element.closest('[data-testid="roll-mat"]');
          const surfaceNode = matNode?.querySelector<HTMLElement>('[data-testid="roll-mat-surface"]');
          const surfaceRect = surfaceNode?.getBoundingClientRect();
          const sceneScaleX = sceneRect.width > 0 ? sceneRect.width / width : 1;
          const surfaceLeftPx = surfaceRect ? (surfaceRect.left - sceneRect.left) / sceneScaleX : width * 0.2;
          const surfaceRightPx = surfaceRect ? (surfaceRect.right - sceneRect.left) / sceneScaleX : width * 0.8;
          runtime.matBounds = getYutRollMatWorldBounds(width, height, surfaceLeftPx, surfaceRightPx);
          updateStickTargets(runtime, latestAnimationRef.current);
          renderer.setSize(width, height, false);
          camera.aspect = framing.aspect;
          camera.position.set(0, framing.cameraY, framing.cameraZ);
          camera.lookAt(0, framing.targetY, framing.targetZ);
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
          } else if (activePhase === 'primary') renderPrimary(runtime, elapsed);
          else if (activePhase === 'extra-spin') renderExtraSpin(runtime, elapsed);
          else if (activePhase === 'landing') {
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
      if (phase === 'result-hold' && runtime.phase === 'landing') return;
      capturePhaseStart(runtime, phase);
      landingStartedAtRef.current = phase === 'landing' ? runtime.phaseStartedAt : null;
      if (phase === 'result-hold') {
        setFinalTransforms(runtime);
        notifySettled();
      }
    }
  }, [phase, sticksKey, getFallCount(rollAnimation)]);

  useEffect(() => {
    if (rendererStatus !== 'fallback') return undefined;
    const landingElapsedMs = landingStartedAtRef.current === null
      ? Math.max(0, getAnimationAgeMs(rollAnimation) - LOCAL_ROLL_PRIMARY_MS)
      : Math.max(0, performance.now() - landingStartedAtRef.current);
    const delayMs = phase === 'landing'
      ? Math.max(0, LOCAL_ROLL_LANDING_MS - landingElapsedMs)
      : phase === 'resolved'
        ? REMOTE_ROLL_PRE_RESULT_MS
        : phase === 'result-hold'
          ? Math.max(0, LOCAL_ROLL_LANDING_MS - landingElapsedMs)
          : null;
    if (delayMs === null) return undefined;
    const timer = window.setTimeout(notifySettled, delayMs);
    return () => window.clearTimeout(timer);
  }, [phase, rendererStatus, rollAnimation.id]);

  const isPreResult = phase === 'primary' || phase === 'extra-spin';
  const fallCount = getFallCount(rollAnimation);
  return <div
    className="yut-roll-scene"
    data-testid="yut-roll-scene"
    data-renderer={rendererStatus}
    data-phase={phase}
    data-fall-count={fallCount}
    data-marked-count={rollAnimation.sticks.filter((stick) => stick.marked).length}
  >
    <canvas ref={canvasRef} className="yut-roll-three-canvas" aria-hidden="true" />
    <div className="roll-sticks-layer yut-roll-css-fallback" aria-hidden="true">
      {rollAnimation.sticks.map((stick, index) => {
        const flatMarkCount = isPreResult ? 0 : stick.flat && stick.marked ? 1 : 0;
        const roundMarkCount = isPreResult ? 0 : stick.flat ? 0 : 3;
        const isFallenStick = Boolean(!isPreResult && fallCount && index < fallCount);
        const faceClassName = isPreResult ? '' : stick.flat ? 'flat' : 'round';
        const fallDirection = index % 2 === 0 ? -1 : 1;
        const fallX = fallDirection < 0 ? 'calc(0px - min(42vw, 300px))' : 'min(42vw, 300px)';
        const rollX = `${fallDirection * (22 + index * 2)}px`;
        return <span
          key={`${rollAnimation.id}-${index}`}
          className={`yut-stick ${faceClassName} ${stick.marked ? 'marked' : ''} ${isFallenStick ? 'fallen' : ''}`}
          style={{
            '--stick-index': index,
            '--stick-start-rotate': `${-180 + index * 24}deg`,
            '--stick-land-rotate': `${28 - index * 14}deg`,
            '--stick-bounce-rotate': `${12 + index * 18}deg`,
            '--stick-final-rotate': `${-8 + index * 12}deg`,
            '--stick-roll-x': rollX,
            '--fall-bounce-x': `${fallDirection * (34 + index * 4)}px`,
            '--fall-edge-x': `${fallDirection * (108 + index * 8)}px`,
            '--fall-x': fallX,
            '--fall-y': `${96 + index * 14}px`,
            '--fall-rotate': `${fallDirection < 0 ? -64 - index * 18 : 62 + index * 16}deg`,
          } as CSSProperties}
        >
          <span className="yut-stick-body">
            <i className="yut-stick-flat-face">{Array.from({ length: flatMarkCount }, (_, markIndex) => <span key={`flat-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" />)}</i>
            <i className="yut-stick-round-face">{Array.from({ length: roundMarkCount }, (_, markIndex) => <span key={`round-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" />)}</i>
          </span>
        </span>;
      })}
    </div>
  </div>;
}
