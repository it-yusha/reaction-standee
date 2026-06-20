import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import "./styles.css";

type Reaction = "normal" | "joy" | "surprised" | "troubled" | "explain";
type ImageSlot = Reaction;
type BackgroundMode = "transparent" | "green" | "color" | "image";
type Sensitivity = "low" | "standard" | "high";
type AppRoute = "settings" | "avatar" | "capture";
type CanvasAspectRatio = "9:16" | "16:9";
type LifeIntensity = "subtle" | "standard" | "strong";

type ReactionImages = Record<ImageSlot, string>;
type ImageDbKey = ImageSlot | typeof BACKGROUND_IMAGE_KEY | typeof NORMAL_BLINK_IMAGE_KEY;

type Settings = {
  selectedDeviceId: string;
  trackingEnabled: boolean;
  sensitivity: Sensitivity;
  size: number;
  x: number;
  y: number;
  avatarSize: number;
  avatarX: number;
  avatarY: number;
  outlineEnabled: boolean;
  outlineWidth: number;
  canvasAspectRatio: CanvasAspectRatio;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImage?: string;
  lifeEnabled: boolean;
  blinkEnabled: boolean;
  motionEnabled: boolean;
  lifeIntensity: LifeIntensity;
  normalBlinkImage?: string;
  images: Partial<ReactionImages>;
};

type StoredSettings = Omit<Settings, "images" | "backgroundImage" | "normalBlinkImage">;

type TrackingDebug = {
  candidate: Reaction;
  stableForMs: number;
  confidence: number;
  status: string;
};

type Classification = {
  reaction: Reaction;
  confidence: number;
  reason: string;
};

type SharedReactionPayload = {
  reaction: Reaction;
  updatedAt: number;
  settings?: SharedAvatarSettings;
};

type SharedAvatarSettings = Pick<
  Settings,
  | "avatarSize"
  | "avatarX"
  | "avatarY"
  | "outlineEnabled"
  | "outlineWidth"
  | "canvasAspectRatio"
  | "backgroundMode"
  | "backgroundColor"
  | "backgroundImage"
  | "lifeEnabled"
  | "blinkEnabled"
  | "motionEnabled"
  | "lifeIntensity"
  | "normalBlinkImage"
>;

type AppErrorBoundaryState = {
  error: Error | undefined;
};

const STORAGE_KEY = "reaction-standee:v1";
const IMAGE_DB_NAME = "reaction-standee-images";
const IMAGE_STORE_NAME = "images";
const BACKGROUND_IMAGE_KEY = "__background__";
const NORMAL_BLINK_IMAGE_KEY = "__normal_blink__";
const SHARED_REACTION_URL = "/api/reaction";
const SHARED_REACTION_EVENTS_URL = "/api/reaction/events";
const AVATAR_SYNC_INTERVAL_MS = 50;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const reactions: Array<{ key: Reaction; label: string; file: string; gesture: string }> = [
  { key: "normal", label: "通常", file: "normal.png", gesture: "自然体" },
  { key: "joy", label: "喜び", file: "joy.png", gesture: "両手を上げる" },
  { key: "surprised", label: "驚き", file: "surprised.png", gesture: "手を顔の横・近く" },
  { key: "troubled", label: "困惑", file: "troubled.png", gesture: "手を頭の近く" },
  { key: "explain", label: "説明", file: "explain.png", gesture: "人差し指を立てる" },
];

const imageSlots: Array<{ key: ImageSlot; label: string; file: string }> = [
  { key: "normal", label: "通常", file: "normal.png" },
  { key: "joy", label: "喜び", file: "joy.png" },
  { key: "surprised", label: "驚き", file: "surprised.png" },
  { key: "troubled", label: "困惑", file: "troubled.png" },
  { key: "explain", label: "説明", file: "explain.png" },
];

const canvasAspectRatios: Array<{ key: CanvasAspectRatio; label: string; value: number }> = [
  { key: "9:16", label: "9:16 ショート動画", value: 9 / 16 },
  { key: "16:9", label: "16:9 横動画", value: 16 / 9 },
];

const sensitivityProfile: Record<
  Sensitivity,
  {
    minVisibility: number;
    minConfidence: number;
    stableMs: number;
    normalStableMs: number;
    cooldownMs: number;
    lostToNormalMs: number;
    nearFaceScale: number;
  }
> = {
  low: {
    minVisibility: 0.64,
    minConfidence: 0.72,
    stableMs: 430,
    normalStableMs: 1000,
    cooldownMs: 900,
    lostToNormalMs: 2800,
    nearFaceScale: 0.72,
  },
  standard: {
    minVisibility: 0.52,
    minConfidence: 0.6,
    stableMs: 280,
    normalStableMs: 720,
    cooldownMs: 650,
    lostToNormalMs: 2200,
    nearFaceScale: 0.88,
  },
  high: {
    minVisibility: 0.42,
    minConfidence: 0.5,
    stableMs: 170,
    normalStableMs: 520,
    cooldownMs: 460,
    lostToNormalMs: 1700,
    nearFaceScale: 1.05,
  },
};

const defaultSettings: Settings = {
  selectedDeviceId: "",
  trackingEnabled: false,
  sensitivity: "standard",
  size: 620,
  x: 0,
  y: 80,
  avatarSize: 620,
  avatarX: 0,
  avatarY: 0,
  outlineEnabled: true,
  outlineWidth: 3,
  canvasAspectRatio: "9:16",
  backgroundMode: "transparent",
  backgroundColor: "#111827",
  backgroundImage: undefined,
  lifeEnabled: true,
  blinkEnabled: true,
  motionEnabled: true,
  lifeIntensity: "standard",
  normalBlinkImage: undefined,
  images: {},
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings,
      ...parsed,
      backgroundImage: undefined,
      normalBlinkImage: undefined,
      images: {},
    };
  } catch {
    return defaultSettings;
  }
}

function toStoredSettings(settings: Settings): StoredSettings {
  return {
    selectedDeviceId: settings.selectedDeviceId,
    trackingEnabled: settings.trackingEnabled,
    sensitivity: settings.sensitivity,
    size: settings.size,
    x: settings.x,
    y: settings.y,
    avatarSize: settings.avatarSize,
    avatarX: settings.avatarX,
    avatarY: settings.avatarY,
    outlineEnabled: settings.outlineEnabled,
    outlineWidth: settings.outlineWidth,
    canvasAspectRatio: settings.canvasAspectRatio,
    backgroundMode: settings.backgroundMode,
    backgroundColor: settings.backgroundColor,
    lifeEnabled: settings.lifeEnabled,
    blinkEnabled: settings.blinkEnabled,
    motionEnabled: settings.motionEnabled,
    lifeIntensity: settings.lifeIntensity,
  };
}

function toSharedAvatarSettings(settings: Settings): SharedAvatarSettings {
  return {
    avatarSize: settings.avatarSize,
    avatarX: settings.avatarX,
    avatarY: settings.avatarY,
    outlineEnabled: settings.outlineEnabled,
    outlineWidth: settings.outlineWidth,
    canvasAspectRatio: settings.canvasAspectRatio,
    backgroundMode: settings.backgroundMode,
    backgroundColor: settings.backgroundColor,
    backgroundImage: settings.backgroundImage,
    lifeEnabled: settings.lifeEnabled,
    blinkEnabled: settings.blinkEnabled,
    motionEnabled: settings.motionEnabled,
    lifeIntensity: settings.lifeIntensity,
    normalBlinkImage: settings.normalBlinkImage,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IMAGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadReactionImages(): Promise<Partial<ReactionImages>> {
  if (!("indexedDB" in window)) return {};
  const db = await openImageDb();
  try {
    const entries = await Promise.all(
      imageSlots.map(async ({ key }) => [key, await readImageFromDb(db, key)] as const),
    );
    return Object.fromEntries(entries.filter(([, value]) => Boolean(value))) as Partial<ReactionImages>;
  } finally {
    db.close();
  }
}

async function loadBackgroundImage(): Promise<string | undefined> {
  if (!("indexedDB" in window)) return undefined;
  const db = await openImageDb();
  try {
    return readImageFromDb(db, BACKGROUND_IMAGE_KEY);
  } finally {
    db.close();
  }
}

async function loadNormalBlinkImage(): Promise<string | undefined> {
  if (!("indexedDB" in window)) return undefined;
  const db = await openImageDb();
  try {
    return readImageFromDb(db, NORMAL_BLINK_IMAGE_KEY);
  } finally {
    db.close();
  }
}

function readImageFromDb(db: IDBDatabase, key: ImageDbKey): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}

async function saveImageToDb(key: ImageDbKey, dataUrl: string) {
  if (!("indexedDB" in window)) return;
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, "readwrite").objectStore(IMAGE_STORE_NAME).put(dataUrl, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function saveReactionImage(key: ImageSlot, dataUrl: string) {
  return saveImageToDb(key, dataUrl);
}

async function deleteReactionImage(key: ImageSlot) {
  return deleteImageFromDb(key);
}

async function saveBackgroundImage(dataUrl: string) {
  return saveImageToDb(BACKGROUND_IMAGE_KEY, dataUrl);
}

async function deleteBackgroundImage() {
  return deleteImageFromDb(BACKGROUND_IMAGE_KEY);
}

async function saveNormalBlinkImage(dataUrl: string) {
  return saveImageToDb(NORMAL_BLINK_IMAGE_KEY, dataUrl);
}

async function deleteNormalBlinkImage() {
  return deleteImageFromDb(NORMAL_BLINK_IMAGE_KEY);
}

async function deleteImageFromDb(key: ImageDbKey) {
  if (!("indexedDB" in window)) return;
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, "readwrite").objectStore(IMAGE_STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function clearReactionImages() {
  if (!("indexedDB" in window)) return;
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, "readwrite").objectStore(IMAGE_STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function publishSharedState(reaction: Reaction, settings: Settings) {
  await fetch(SHARED_REACTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction, settings: toSharedAvatarSettings(settings) }),
  });
}

async function readSharedReaction(): Promise<SharedReactionPayload | undefined> {
  const response = await fetch(`${SHARED_REACTION_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as Partial<SharedReactionPayload>;
  if (!payload.reaction || !reactions.some((item) => item.key === payload.reaction)) return undefined;
  return {
    reaction: payload.reaction,
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : 0,
    settings: payload.settings,
  };
}

function App() {
  const route: AppRoute =
    window.location.pathname === "/avatar" ? "avatar" : window.location.pathname === "/capture" ? "capture" : "settings";
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [reaction, setReaction] = useState<Reaction>("normal");
  const [debug, setDebug] = useState<TrackingDebug>({
    candidate: "normal",
    stableForMs: 0,
    confidence: 0,
    status: "待機中",
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStoredSettings(settings)));
    } catch {
      setCameraError("設定の保存に失敗しました。ブラウザの保存容量を確認してください。");
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadReactionImages(), loadBackgroundImage(), loadNormalBlinkImage()])
      .then(([images, backgroundImage, normalBlinkImage]) => {
        if (!cancelled) updateSettings({ images, backgroundImage, normalBlinkImage });
      })
      .catch(() => {
        if (!cancelled) setCameraError("保存済み画像の読み込みに失敗しました。");
      });

    return () => {
      cancelled = true;
    };
  }, [updateSettings]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((deviceList) => setDevices(deviceList.filter((device) => device.kind === "videoinput")))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (route === "avatar") return;
    void publishSharedState(reaction, settings).catch(() => undefined);
  }, [reaction, route, settings]);

  useEffect(() => {
    if (route !== "avatar") return;
    let cancelled = false;
    let lastUpdatedAt = 0;
    let fallbackInterval = 0;

    const applyPayload = (payload: SharedReactionPayload | undefined) => {
      if (!cancelled && payload && payload.updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = payload.updatedAt;
        setReaction(payload.reaction);
        if (payload.settings) updateSettings(payload.settings);
      }
    };

    const syncReaction = () => {
      void readSharedReaction()
        .then(applyPayload)
        .catch(() => undefined);
    };

    syncReaction();
    const startFallbackPolling = () => {
      if (!fallbackInterval) {
        fallbackInterval = window.setInterval(syncReaction, AVATAR_SYNC_INTERVAL_MS);
      }
    };

    if (!("EventSource" in window)) {
      startFallbackPolling();
      return () => {
        cancelled = true;
        window.clearInterval(fallbackInterval);
      };
    }

    const events = new EventSource(SHARED_REACTION_EVENTS_URL);
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as SharedReactionPayload;
        if (!payload.reaction || !reactions.some((item) => item.key === payload.reaction)) return;
        applyPayload(payload);
      } catch {
        startFallbackPolling();
      }
    };
    events.onerror = () => {
      startFallbackPolling();
    };

    return () => {
      cancelled = true;
      events.close();
      window.clearInterval(fallbackInterval);
    };
  }, [route]);

  usePoseTracking({
    enabled: route !== "avatar" && settings.trackingEnabled,
    deviceId: settings.selectedDeviceId,
    sensitivity: settings.sensitivity,
    videoRef,
    onReaction: setReaction,
    onDebug: setDebug,
    onDevices: setDevices,
    onError: setCameraError,
  });

  return (
    <main className={`app ${route}`}>
      <AvatarStage reaction={reaction} route={route} settings={settings} />
      <video ref={videoRef} className="trackingVideo" muted playsInline />

      {route === "settings" && (
        <SettingsPanel
          cameraError={cameraError}
          debug={debug}
          devices={devices}
          onChange={updateSettings}
          onManualReaction={setReaction}
          reaction={reaction}
          settings={settings}
        />
      )}
    </main>
  );
}

type TrackingArgs = {
  enabled: boolean;
  deviceId: string;
  sensitivity: Sensitivity;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onReaction: (reaction: Reaction) => void;
  onDebug: (debug: TrackingDebug) => void;
  onDevices: (devices: MediaDeviceInfo[]) => void;
  onError: (message: string) => void;
};

function usePoseTracking({
  enabled,
  deviceId,
  sensitivity,
  videoRef,
  onReaction,
  onDebug,
  onDevices,
  onError,
}: TrackingArgs) {
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const currentReactionRef = useRef<Reaction>("normal");
  const candidateRef = useRef<Reaction>("normal");
  const candidateStartedRef = useRef(0);
  const lastSwitchRef = useRef(0);
  const lastSeenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      stopCamera(streamRef, animationRef);
      onError("");

      if (!enabled) {
        onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "停止中" });
        return;
      }

      try {
        const video = videoRef.current;
        if (!video) return;

        if (!landmarkerRef.current || !handLandmarkerRef.current) {
          onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "モデル読込中" });
          const vision = await FilesetResolver.forVisionTasks(WASM_URL);
          if (cancelled) return;
          const [poseLandmarker, handLandmarker] = await Promise.all([
            PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numPoses: 1,
              minPoseDetectionConfidence: 0.45,
              minPosePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
            }),
            HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: HAND_MODEL_URL,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.45,
              minHandPresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
            }),
          ]);
          landmarkerRef.current = poseLandmarker;
          handLandmarkerRef.current = handLandmarker;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? {
                deviceId: { exact: deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        onDevices(deviceList.filter((device) => device.kind === "videoinput"));

        lastSeenRef.current = performance.now();
        onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "トラッキング中" });

        const tick = () => {
          const landmarker = landmarkerRef.current;
          const handLandmarker = handLandmarkerRef.current;
          if (!landmarker || !handLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            animationRef.current = requestAnimationFrame(tick);
            return;
          }

          const now = performance.now();
          const result = landmarker.detectForVideo(video, now);
          const handResult = handLandmarker.detectForVideo(video, now);
          if (result.landmarks[0]) {
            lastSeenRef.current = now;
          }
          const next = classifyPose(result, handResult, sensitivity, lastSeenRef.current);
          const debug = applyStateMachine(next, sensitivity, {
            currentReactionRef,
            candidateRef,
            candidateStartedRef,
            lastSwitchRef,
            onReaction,
          });
          onDebug(debug);
          animationRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        const message = error instanceof Error ? error.message : "カメラを開始できませんでした。";
        onError(message);
        onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "エラー" });
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera(streamRef, animationRef);
    };
  }, [deviceId, enabled, onDebug, onDevices, onError, onReaction, sensitivity, videoRef]);
}

function stopCamera(
  streamRef: React.MutableRefObject<MediaStream | null>,
  animationRef: React.MutableRefObject<number>,
) {
  cancelAnimationFrame(animationRef.current);
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
}

function classifyPose(
  result: PoseLandmarkerResult,
  handResult: HandLandmarkerResult,
  sensitivity: Sensitivity,
  lastSeen: number,
): Classification {
  const profile = sensitivityProfile[sensitivity];
  const landmarks = result.landmarks[0];
  const now = performance.now();

  if (!landmarks) {
    if (now - lastSeen > profile.lostToNormalMs) {
      return { reaction: "normal", confidence: 0.52, reason: "ポーズ未検出が継続" };
    }
    return { reaction: "normal", confidence: 0.1, reason: "ポーズ未検出" };
  }

  const get = (index: number) => landmarks[index];
  const leftShoulder = get(11);
  const rightShoulder = get(12);
  const leftElbow = get(13);
  const rightElbow = get(14);
  const leftWrist = get(15);
  const rightWrist = get(16);
  const leftHip = get(23);
  const rightHip = get(24);
  const nose = get(0);
  const leftEar = get(7);
  const rightEar = get(8);

  if (!visible(leftShoulder, profile) || !visible(rightShoulder, profile)) {
    return { reaction: "normal", confidence: 0.2, reason: "肩の検出が不安定" };
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = visible(leftHip, profile) && visible(rightHip, profile) ? (leftHip.y + rightHip.y) / 2 : shoulderY + 0.34;
  const torso = Math.max(0.18, hipY - shoulderY);
  const shoulderWidth = Math.max(0.18, Math.abs(leftShoulder.x - rightShoulder.x));
  const wrists = [leftWrist, rightWrist].filter((wrist) => visible(wrist, profile));
  const facePoint = visible(nose, profile) ? nose : midpoint(leftShoulder, rightShoulder);

  const bothHandsUp =
    visible(leftWrist, profile) &&
    visible(rightWrist, profile) &&
    leftWrist.y < shoulderY - torso * 0.38 &&
    rightWrist.y < shoulderY - torso * 0.38;
  if (bothHandsUp) {
    return { reaction: "joy", confidence: 0.94, reason: "両手が肩より大きく上" };
  }

  if (hasIndexFingerGesture(handResult)) {
    return { reaction: "explain", confidence: 0.93, reason: "人差し指を立てる" };
  }

  const faceY = facePoint.y;
  const faceSideRange = shoulderWidth * 1.08;
  const faceVerticalRange = torso * 0.82;
  const nearFace = wrists.filter((wrist) => {
    const nearCenter = distance(wrist, facePoint) < shoulderWidth * (profile.nearFaceScale + 0.18);
    const nearSide =
      Math.abs(wrist.x - facePoint.x) < faceSideRange &&
      wrist.y > faceY - torso * 0.45 &&
      wrist.y < shoulderY + faceVerticalRange;
    return nearCenter || nearSide;
  });
  const earNear =
    (visible(leftEar, profile) && wrists.some((wrist) => distance(wrist, leftEar) < shoulderWidth * 0.78)) ||
    (visible(rightEar, profile) && wrists.some((wrist) => distance(wrist, rightEar) < shoulderWidth * 0.78));
  const headTilt =
    visible(leftEar, profile) && visible(rightEar, profile) ? Math.abs(leftEar.y - rightEar.y) > 0.045 : false;

  if (earNear && (headTilt || nearFace.length === 1)) {
    return { reaction: "troubled", confidence: headTilt ? 0.86 : 0.74, reason: "手が頭の近く" };
  }

  if (nearFace.length >= 2 || nearFace.some((wrist) => wrist.y < shoulderY + torso * 0.34)) {
    return { reaction: "surprised", confidence: nearFace.length >= 2 ? 0.92 : 0.82, reason: "手が顔の横・近く" };
  }

  const leftPointing =
    visible(leftWrist, profile) &&
    visible(leftElbow, profile) &&
    leftWrist.x < leftShoulder.x - shoulderWidth * 0.32 &&
    leftWrist.y > shoulderY - torso * 0.2 &&
    leftWrist.y < shoulderY + torso * 0.58 &&
    leftElbow.x < leftShoulder.x - shoulderWidth * 0.12;
  const rightPointing =
    visible(rightWrist, profile) &&
    visible(rightElbow, profile) &&
    rightWrist.x > rightShoulder.x + shoulderWidth * 0.32 &&
    rightWrist.y > shoulderY - torso * 0.2 &&
    rightWrist.y < shoulderY + torso * 0.58 &&
    rightElbow.x > rightShoulder.x + shoulderWidth * 0.12;
  if (leftPointing || rightPointing) {
    return { reaction: "explain", confidence: 0.74, reason: "片手を横へ伸ばす" };
  }

  return { reaction: "normal", confidence: 0.7, reason: "特別なポーズなし" };
}

function hasIndexFingerGesture(result: HandLandmarkerResult) {
  return result.landmarks.some((hand) => {
    const wrist = hand[0];
    const indexMcp = hand[5];
    const indexPip = hand[6];
    const indexTip = hand[8];
    const middlePip = hand[10];
    const middleTip = hand[12];
    const ringPip = hand[14];
    const ringTip = hand[16];
    const pinkyPip = hand[18];
    const pinkyTip = hand[20];
    if (!wrist || !indexMcp || !indexPip || !indexTip) return false;

    const handSize = Math.max(0.04, distance(wrist, indexMcp));
    const indexUp = indexTip.y < indexPip.y - handSize * 0.34 && indexPip.y < indexMcp.y + handSize * 0.24;
    const middleUp = middleTip && middlePip ? middleTip.y < middlePip.y - handSize * 0.28 : false;
    const ringUp = ringTip && ringPip ? ringTip.y < ringPip.y - handSize * 0.28 : false;
    const pinkyUp = pinkyTip && pinkyPip ? pinkyTip.y < pinkyPip.y - handSize * 0.28 : false;
    const extendedOtherFingers = [middleUp, ringUp, pinkyUp].filter(Boolean).length;

    return indexUp && extendedOtherFingers <= 1;
  });
}

function applyStateMachine(
  classification: Classification,
  sensitivity: Sensitivity,
  refs: {
    currentReactionRef: React.MutableRefObject<Reaction>;
    candidateRef: React.MutableRefObject<Reaction>;
    candidateStartedRef: React.MutableRefObject<number>;
    lastSwitchRef: React.MutableRefObject<number>;
    onReaction: (reaction: Reaction) => void;
  },
): TrackingDebug {
  const now = performance.now();
  const profile = sensitivityProfile[sensitivity];
  const confident = classification.confidence >= profile.minConfidence;
  const candidate = confident ? classification.reaction : refs.currentReactionRef.current;

  if (refs.candidateRef.current !== candidate) {
    refs.candidateRef.current = candidate;
    refs.candidateStartedRef.current = now;
  }

  const stableForMs = now - refs.candidateStartedRef.current;
  const requiredStableMs = candidate === "normal" ? profile.normalStableMs : profile.stableMs;
  const cooledDown = now - refs.lastSwitchRef.current > profile.cooldownMs;
  const shouldSwitch =
    candidate !== refs.currentReactionRef.current && stableForMs >= requiredStableMs && cooledDown && confident;

  if (shouldSwitch) {
    refs.currentReactionRef.current = candidate;
    refs.lastSwitchRef.current = now;
    refs.onReaction(candidate);
  }

  return {
    candidate,
    stableForMs,
    confidence: classification.confidence,
    status: confident ? classification.reason : "判定保留",
  };
}

function visible(landmark: NormalizedLandmark | undefined, profile: { minVisibility: number }) {
  if (!landmark) return false;
  return (landmark.visibility ?? 1) >= profile.minVisibility;
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function getAspectRatioValue(aspectRatio: CanvasAspectRatio) {
  return canvasAspectRatios.find((item) => item.key === aspectRatio)?.value ?? 9 / 16;
}

function getAspectRatioCss(aspectRatio: CanvasAspectRatio) {
  return aspectRatio.replace(":", " / ");
}

function getFrameBackground(settings: Settings) {
  if (settings.backgroundMode === "transparent") return "transparent";
  if (settings.backgroundMode === "green") return "#00ff00";
  if (settings.backgroundMode === "image" && settings.backgroundImage) {
    return `center / cover no-repeat url("${settings.backgroundImage}")`;
  }
  return settings.backgroundColor;
}

function randomBetween(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

function useNormalBlink(reaction: Reaction, settings: Settings) {
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    if (reaction !== "normal" || !settings.lifeEnabled || !settings.blinkEnabled || !settings.normalBlinkImage) {
      setIsBlinking(false);
      return;
    }

    let timeout = 0;
    let cancelled = false;

    const schedule = () => {
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        const blinkDuration = randomBetween(110, 170);
        const shouldDoubleBlink = Math.random() < 0.16;
        setIsBlinking(true);

        timeout = window.setTimeout(() => {
          if (cancelled) return;
          setIsBlinking(false);

          if (shouldDoubleBlink) {
            timeout = window.setTimeout(() => {
              if (cancelled) return;
              setIsBlinking(true);
              timeout = window.setTimeout(() => {
                if (cancelled) return;
                setIsBlinking(false);
                schedule();
              }, randomBetween(90, 130));
            }, randomBetween(120, 220));
            return;
          }

          schedule();
        }, blinkDuration);
      }, randomBetween(3000, 7000));
    };

    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [reaction, settings.blinkEnabled, settings.lifeEnabled, settings.normalBlinkImage]);

  return isBlinking;
}

function AvatarStage({ reaction, route, settings }: { reaction: Reaction; route: AppRoute; settings: Settings }) {
  const isBlinking = useNormalBlink(reaction, settings);
  const normalImage = isBlinking && settings.normalBlinkImage ? settings.normalBlinkImage : settings.images.normal;
  const image = reaction === "normal" ? normalImage : settings.images[reaction];
  const label = reactions.find((item) => item.key === reaction)?.label ?? reaction;
  const useAvatarLayout = route !== "settings";
  const size = useAvatarLayout ? settings.avatarSize : settings.size;
  const x = useAvatarLayout ? settings.avatarX : settings.x;
  const y = useAvatarLayout ? settings.avatarY : settings.y;
  const staticImage = `/reactions/${reaction}.png`;
  const frameBackground = getFrameBackground(settings);
  const aspectRatioValue = getAspectRatioValue(settings.canvasAspectRatio);

  return (
    <section
      className={`stage reaction-${reaction} life-${settings.lifeIntensity}${settings.lifeEnabled ? " life-on" : ""}${
        settings.motionEnabled ? " motion-on" : ""
      }`}
      aria-label="avatar"
    >
      <div
        className="recordingFrame"
        style={{
          ["--canvas-ratio" as string]: aspectRatioValue,
          ["--canvas-aspect" as string]: getAspectRatioCss(settings.canvasAspectRatio),
          background: frameBackground,
        }}
      >
        <div
          className="avatarSlot"
          style={{
            ["--avatar-size" as string]: `${size}px`,
            transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
          }}
        >
          <div key={reaction} className="avatar">
            <ReactionEffects reaction={reaction} />
            <AvatarImage
              alt={label}
              outlineWidth={settings.outlineEnabled ? `${settings.outlineWidth}px` : "0px"}
              primarySrc={image}
              reaction={reaction}
              staticSrc={staticImage}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function AvatarImage({
  alt,
  outlineWidth,
  primarySrc,
  reaction,
  staticSrc,
}: {
  alt: string;
  outlineWidth: string;
  primarySrc: string | undefined;
  reaction: Reaction;
  staticSrc: string;
}) {
  const [failedSrc, setFailedSrc] = useState("");
  const src = primarySrc ?? staticSrc;

  useEffect(() => {
    setFailedSrc("");
  }, [src]);

  if (failedSrc === src) {
    return (
      <div className="avatarPlaceholder">
        <strong>{reaction}.png</strong>
        <span>{alt}の画像を登録、または public/reactions に配置してください</span>
      </div>
    );
  }

  return (
    <img
      className="avatarImage"
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailedSrc(src)}
      style={{
        ["--outline-width" as string]: outlineWidth,
      }}
    />
  );
}

function ReactionEffects({ reaction }: { reaction: Reaction }) {
  if (reaction === "joy") {
    return (
      <div className="effectLayer joyFx" aria-hidden="true">
        <img className="effectAsset joyAsset" src="/effects/joy-sparkle-field.svg" alt="" draggable={false} />
        <span className="jumpShadow" />
        <i />
        <i />
      </div>
    );
  }

  if (reaction === "surprised") {
    return (
      <div className="effectLayer surprisedFx" aria-hidden="true">
        <img className="effectAsset surprisedAsset" src="/effects/surprised-shockwave.svg" alt="" draggable={false} />
      </div>
    );
  }

  if (reaction === "troubled") {
    return <div className="effectLayer troubledFx" aria-hidden="true" />;
  }

  if (reaction === "explain") {
    return (
      <div className="effectLayer explainFx" aria-hidden="true">
        <img className="effectAsset explainAsset" src="/effects/explain-pointer-light.svg" alt="" draggable={false} />
        <span className="explainGlow" />
        <span className="pointerBeam" />
      </div>
    );
  }

  return null;
}

type SettingsPanelProps = {
  settings: Settings;
  reaction: Reaction;
  debug: TrackingDebug;
  devices: MediaDeviceInfo[];
  cameraError: string;
  onChange: (patch: Partial<Settings>) => void;
  onManualReaction: (reaction: Reaction) => void;
};

function SettingsPanel({
  settings,
  reaction,
  debug,
  devices,
  cameraError,
  onChange,
  onManualReaction,
}: SettingsPanelProps) {
  const [imageMessage, setImageMessage] = useState("");

  const handleImageUpload = (slot: ImageSlot, file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を読み込み中...`);
    void readFileAsDataUrl(file)
      .then((dataUrl) => {
        onChange({
          images: {
            ...settings.images,
            [slot]: dataUrl,
          },
        });
        return saveReactionImage(slot, dataUrl).then(() => {
          setImageMessage(`${file.name} を登録しました。`);
        });
      })
      .catch((error) => {
        setImageMessage("画像の登録に失敗しました。容量が大きすぎる可能性があります。");
        console.error(error);
        console.error(`${slot} image could not be saved.`);
      });
  };

  const handleClearImages = () => {
    void clearReactionImages()
      .then(() => {
        onChange({
          images: {},
          backgroundImage: undefined,
          backgroundMode: settings.backgroundMode === "image" ? "green" : settings.backgroundMode,
          normalBlinkImage: undefined,
        });
        setImageMessage("登録画像をクリアしました。");
      })
      .catch((error) => {
        setImageMessage("画像のクリアに失敗しました。");
        console.error(error);
        console.error("Reaction images could not be cleared.");
      });
  };

  const handleDeleteImage = (slot: ImageSlot, label: string) => {
    void deleteReactionImage(slot)
      .then(() => {
        const nextImages = { ...settings.images };
        delete nextImages[slot];
        onChange({ images: nextImages });
        setImageMessage(`${label}の画像を削除しました。`);
      })
      .catch((error) => {
        setImageMessage("画像の削除に失敗しました。");
        console.error(error);
        console.error(`${slot} image could not be deleted.`);
      });
  };

  const handleBackgroundUpload = (file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を背景画像として読み込み中...`);
    void readFileAsDataUrl(file)
      .then((dataUrl) => {
        onChange({
          backgroundImage: dataUrl,
          backgroundMode: "image",
        });
        return saveBackgroundImage(dataUrl).then(() => {
          setImageMessage(`${file.name} を背景画像として登録しました。`);
        });
      })
      .catch((error) => {
        setImageMessage("背景画像の登録に失敗しました。容量が大きすぎる可能性があります。");
        console.error(error);
        console.error("Background image could not be saved.");
      });
  };

  const handleDeleteBackground = () => {
    void deleteBackgroundImage()
      .then(() => {
        onChange({
          backgroundImage: undefined,
          backgroundMode: settings.backgroundMode === "image" ? "green" : settings.backgroundMode,
        });
        setImageMessage("背景画像を削除しました。");
      })
      .catch((error) => {
        setImageMessage("背景画像の削除に失敗しました。");
        console.error(error);
        console.error("Background image could not be deleted.");
      });
  };

  const handleNormalBlinkUpload = (file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を通常まばたき画像として読み込み中...`);
    void readFileAsDataUrl(file)
      .then((dataUrl) => {
        onChange({
          normalBlinkImage: dataUrl,
          lifeEnabled: true,
          blinkEnabled: true,
        });
        return saveNormalBlinkImage(dataUrl).then(() => {
          setImageMessage(`${file.name} を通常まばたき画像として登録しました。`);
        });
      })
      .catch((error) => {
        setImageMessage("通常まばたき画像の登録に失敗しました。容量が大きすぎる可能性があります。");
        console.error(error);
        console.error("Normal blink image could not be saved.");
      });
  };

  const handleDeleteNormalBlink = () => {
    void deleteNormalBlinkImage()
      .then(() => {
        onChange({ normalBlinkImage: undefined });
        setImageMessage("通常まばたき画像を削除しました。");
      })
      .catch((error) => {
        setImageMessage("通常まばたき画像の削除に失敗しました。");
        console.error(error);
        console.error("Normal blink image could not be deleted.");
      });
  };

  return (
    <aside className="panel">
      <header className="panelHeader">
        <div>
          <h1>Reaction Standee</h1>
          <p>ポーズで立ち絵リアクションを呼び出す</p>
        </div>
        <div className="headerLinks">
          <a className="avatarLink" href="/capture" target="_blank" rel="noreferrer">
            /capture
          </a>
          <a className="avatarLink" href="/avatar" target="_blank" rel="noreferrer">
            /avatar
          </a>
        </div>
      </header>

      <section className="section">
        <h2>トラッキング</h2>
        <label>
          カメラ
          <select
            value={settings.selectedDeviceId}
            onChange={(event) => onChange({ selectedDeviceId: event.target.value })}
          >
            <option value="">既定のカメラ</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `カメラ ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="switchRow">
          <span>トラッキング</span>
          <input
            type="checkbox"
            checked={settings.trackingEnabled}
            onChange={(event) => onChange({ trackingEnabled: event.target.checked })}
          />
        </label>
        <label>
          判定感度
          <select
            value={settings.sensitivity}
            onChange={(event) => onChange({ sensitivity: event.target.value as Sensitivity })}
          >
            <option value="low">低</option>
            <option value="standard">標準</option>
            <option value="high">高</option>
          </select>
        </label>
        <div className="statusGrid">
          <Status label="現在" value={reaction} />
          <Status label="候補" value={debug.candidate} />
          <Status label="信頼度" value={debug.confidence.toFixed(2)} />
          <Status label="安定" value={`${Math.round(debug.stableForMs)}ms`} />
        </div>
        <p className="hint">{debug.status}</p>
        {cameraError && <p className="error">{cameraError}</p>}
      </section>

      <GestureGuide current={reaction} candidate={debug.candidate} />

      <section className="section">
        <h2>画像</h2>
        <p className="hint">透過済みPNGをそのまま登録します。背景抜きは外部の画像編集アプリで行ってください。</p>
        <button type="button" className="danger" onClick={handleClearImages}>
          画像をすべてクリア
        </button>
        {imageMessage && <p className="hint">{imageMessage}</p>}
        <div className="imageGrid">
          {imageSlots.map((item) => (
            <div key={item.key} className="fileSlot">
              <span>
                {item.label}
                <small>{item.file}</small>
                <small className={settings.images[item.key] ? "savedBadge" : "emptyBadge"}>
                  {settings.images[item.key] ? "登録済み" : "未登録"}
                </small>
              </span>
              <div className="fileActions">
                <label className="filePicker">
                  画像を選択
                  <input
                    type="file"
                    accept="image/png,image/*"
                    onClick={(event) => {
                      event.currentTarget.value = "";
                    }}
                    onChange={(event) => {
                      handleImageUpload(item.key, event.target.files?.[0]);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="deleteImageButton"
                  disabled={!settings.images[item.key]}
                  onClick={() => handleDeleteImage(item.key, item.label)}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>生命感</h2>
        <label className="switchRow">
          <span>生命感エフェクト</span>
          <input
            type="checkbox"
            checked={settings.lifeEnabled}
            onChange={(event) => onChange({ lifeEnabled: event.target.checked })}
          />
        </label>
        <label className="switchRow">
          <span>まばたき</span>
          <input
            type="checkbox"
            checked={settings.blinkEnabled}
            onChange={(event) => onChange({ blinkEnabled: event.target.checked })}
          />
        </label>
        <label className="switchRow">
          <span>呼吸・ゆらぎ</span>
          <input
            type="checkbox"
            checked={settings.motionEnabled}
            onChange={(event) => onChange({ motionEnabled: event.target.checked })}
          />
        </label>
        <label>
          エフェクトの強さ
          <select
            value={settings.lifeIntensity}
            onChange={(event) => onChange({ lifeIntensity: event.target.value as LifeIntensity })}
          >
            <option value="subtle">弱</option>
            <option value="standard">標準</option>
            <option value="strong">強</option>
          </select>
        </label>
        <div className="fileSlot backgroundFileSlot">
          <span>
            通常まばたき
            <small>normal の目閉じ差分</small>
            <small className={settings.normalBlinkImage ? "savedBadge" : "emptyBadge"}>
              {settings.normalBlinkImage ? "登録済み" : "未登録"}
            </small>
          </span>
          <div className="fileActions">
            <label className="filePicker">
              画像を選択
              <input
                type="file"
                accept="image/png,image/*"
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => {
                  handleNormalBlinkUpload(event.target.files?.[0]);
                }}
              />
            </label>
            <button
              type="button"
              className="deleteImageButton"
              disabled={!settings.normalBlinkImage}
              onClick={handleDeleteNormalBlink}
            >
              削除
            </button>
          </div>
        </div>
        <p className="hint">まばたきは通常表示中だけ有効です。未登録の場合は自動で何もしません。</p>
      </section>

      <section className="section">
        <h2>表示</h2>
        <p className="hint">設定画面プレビュー</p>
        <Range label="サイズ" min={180} max={1300} step={10} value={settings.size} onChange={(size) => onChange({ size })} />
        <Range label="位置 X" min={-900} max={900} step={5} value={settings.x} onChange={(x) => onChange({ x })} />
        <Range label="位置 Y" min={-520} max={520} step={5} value={settings.y} onChange={(y) => onChange({ y })} />
        <p className="hint">/avatar OBS表示</p>
        <Range
          label="OBSサイズ"
          min={180}
          max={1300}
          step={10}
          value={settings.avatarSize}
          onChange={(avatarSize) => onChange({ avatarSize })}
        />
        <Range
          label="OBS位置 X"
          min={-900}
          max={900}
          step={5}
          value={settings.avatarX}
          onChange={(avatarX) => onChange({ avatarX })}
        />
        <Range
          label="OBS位置 Y"
          min={-520}
          max={520}
          step={5}
          value={settings.avatarY}
          onChange={(avatarY) => onChange({ avatarY })}
        />
        <label className="switchRow">
          <span>白フチ</span>
          <input
            type="checkbox"
            checked={settings.outlineEnabled}
            onChange={(event) => onChange({ outlineEnabled: event.target.checked })}
          />
        </label>
        <Range
          label="白フチ太さ"
          min={0}
          max={10}
          step={1}
          value={settings.outlineWidth}
          onChange={(outlineWidth) => onChange({ outlineWidth })}
        />
        <label>
          録画比率
          <select
            value={settings.canvasAspectRatio}
            onChange={(event) => onChange({ canvasAspectRatio: event.target.value as CanvasAspectRatio })}
          >
            {canvasAspectRatios.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          背景
          <select
            value={settings.backgroundMode}
            onChange={(event) => onChange({ backgroundMode: event.target.value as BackgroundMode })}
          >
            <option value="transparent">透明</option>
            <option value="green">グリーンバック</option>
            <option value="color">任意色</option>
            <option value="image">背景画像</option>
          </select>
        </label>
        <div className="fileSlot backgroundFileSlot">
          <span>
            背景画像
            <small>画面全体にcover表示</small>
            <small className={settings.backgroundImage ? "savedBadge" : "emptyBadge"}>
              {settings.backgroundImage ? "登録済み" : "未登録"}
            </small>
          </span>
          <div className="fileActions">
            <label className="filePicker">
              画像を選択
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/*"
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => {
                  handleBackgroundUpload(event.target.files?.[0]);
                }}
              />
            </label>
            <button
              type="button"
              className="deleteImageButton"
              disabled={!settings.backgroundImage}
              onClick={handleDeleteBackground}
            >
              削除
            </button>
          </div>
        </div>
        {settings.backgroundMode === "color" && (
          <label>
            背景色
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(event) => onChange({ backgroundColor: event.target.value })}
            />
          </label>
        )}
      </section>

      <section className="section">
        <h2>デバッグ</h2>
        <div className="reactionButtons">
          {reactions.map((item) => (
            <button key={item.key} type="button" onClick={() => onManualReaction(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function GestureGuide({ current, candidate }: { current: Reaction; candidate: Reaction }) {
  return (
    <section className="section">
      <h2>ジェスチャー</h2>
      <div className="gestureGrid">
        {reactions.map((item) => (
          <div
            key={item.key}
            className={`gestureCard ${item.key === current ? "current" : ""} ${
              item.key === candidate && item.key !== current ? "candidate" : ""
            }`}
          >
            <GestureIcon reaction={item.key} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.gesture}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function GestureIcon({ reaction }: { reaction: Reaction }) {
  return (
    <svg className={`gestureIcon ${reaction}`} viewBox="0 0 72 72" role="img" aria-label="">
      <circle cx="36" cy="17" r="8" />
      <path className="body" d="M36 26v22" />
      <path className="legs" d="M36 48l-11 15M36 48l11 15" />
      {reaction === "joy" && <path className="arms" d="M33 31L17 10M39 31l16-21" />}
      {reaction === "surprised" && <path className="arms" d="M32 31L20 21M40 31l12-10" />}
      {reaction === "troubled" && <path className="arms" d="M31 31L20 16M41 31l13 16" />}
      {reaction === "explain" && <path className="arms" d="M32 32L19 23M19 23l-1-12M40 32l10 16" />}
      {reaction === "normal" && <path className="arms" d="M32 31L22 48M40 31l10 17" />}
    </svg>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="status">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range">
      <span>
        {label}
        <output>{value}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

class AppErrorBoundary extends React.Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="errorFallback">
          <h1>画面の表示に失敗しました</h1>
          <p>ページを再読み込みしてください。繰り返す場合は、Safariを再起動してからもう一度開いてください。</p>
          <code>{this.state.error.message}</code>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
