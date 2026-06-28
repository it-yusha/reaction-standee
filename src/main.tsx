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
type AppRoute = "settings" | "avatar" | "capture" | "record" | "canvas";
type CanvasAspectRatio = "9:16" | "16:9";
type LifeIntensity = "subtle" | "standard" | "strong";
type LifeMode = "off" | "subtle" | "standard" | "strong" | "check";
type OutlineQuality = "light" | "standard";
type MouthShape = "closed" | "smallOpen" | "wideOpen";
type MouthImageSlot = Exclude<MouthShape, "closed">;
type EyeImageSlot = "lookLeft" | "lookRight";

type ReactionImages = Record<ImageSlot, string>;
type MouthImages = Partial<Record<MouthImageSlot, string>>;
type EyeImages = Partial<Record<EyeImageSlot, string>>;
type ImageDbKey = string;

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BlinkCrop = CropRect;
type MouthCrop = CropRect;

type Settings = {
  selectedDeviceId: string;
  selectedAudioDeviceId: string;
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
  outlineQuality: OutlineQuality;
  adjustmentGuidesEnabled: boolean;
  canvasAspectRatio: CanvasAspectRatio;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImage?: string;
  lifeEnabled: boolean;
  blinkEnabled: boolean;
  motionEnabled: boolean;
  lifeV2Enabled: boolean;
  speechMotionEnabled: boolean;
  idleMotionEnabled: boolean;
  gazeEnabled: boolean;
  cameraFollowEnabled: boolean;
  lifeMotionStrength: number;
  cameraFollowStrength: number;
  lifeIntensity: LifeIntensity;
  normalBlinkImage?: string;
  eyeImages: EyeImages;
  blinkCrop: BlinkCrop;
  lipSyncEnabled: boolean;
  audioInputEnabled: boolean;
  mouthThreshold: number;
  mouthCrop: MouthCrop;
  mouthImages: MouthImages;
  images: Partial<ReactionImages>;
};

type StoredSettings = Omit<Settings, "images" | "backgroundImage" | "normalBlinkImage" | "eyeImages" | "mouthImages">;

type TrackingDebug = {
  candidate: Reaction;
  stableForMs: number;
  confidence: number;
  status: string;
  inferenceFps?: number;
  inferenceMs?: number;
  videoHeight?: number;
  videoWidth?: number;
};

type AudioDebug = {
  volume: number;
  speechLevel: number;
  mouthShape: MouthShape;
  status: string;
};

type SpeechIntensity = "soft" | "medium" | "strong";

type CameraFollow = {
  x: number;
  y: number;
  visible: boolean;
};

type EyeDirection = "center" | EyeImageSlot;

type GazeDebug = {
  direction: EyeDirection;
  status: string;
  canGaze: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  cropValid: boolean;
};

type AvatarVisualState = {
  isBlinking: boolean;
  eyeDirection: EyeDirection;
  reactionStartedAt: number;
};

type RecordingState = "idle" | "recording" | "ready" | "error";

type RecordingFrameMetrics = {
  scaleX: number;
  scaleY: number;
  avatarTransform: RecordingTransform;
  lifeTransform: RecordingTransform;
  talkTransform: RecordingTransform;
};

type RecordingTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type PerfOptions = {
  cameraPreset: "default" | "low";
  enabled: boolean;
  maxInferenceFps: number;
  noBackground: boolean;
  noEffects: boolean;
  noMotion: boolean;
  noOutline: boolean;
  noOverlays: boolean;
};

type PerfMetrics = {
  avgFrameMs: number;
  fps: number;
  longFrames: number;
  worstFrameMs: number;
};

type Classification = {
  reaction: Reaction;
  confidence: number;
  reason: string;
};

type SharedReactionPayload = {
  reaction: Reaction;
  mouthShape?: MouthShape;
  audioLevel?: number;
  cameraFollow?: CameraFollow;
  updatedAt: number;
  settingsUpdatedAt?: number;
  settings?: SharedAvatarSettings;
};

type SharedStoredSettingsPayload = {
  settings?: Partial<StoredSettings>;
  updatedAt?: number;
};

type AppBackup = {
  version: 1;
  exportedAt: string;
  settings: StoredSettings;
  assets: Record<string, string>;
};

type SharedAvatarSettings = Pick<
  Settings,
  | "avatarSize"
  | "avatarX"
  | "avatarY"
  | "outlineEnabled"
  | "outlineWidth"
  | "outlineQuality"
  | "adjustmentGuidesEnabled"
  | "canvasAspectRatio"
  | "backgroundMode"
  | "backgroundColor"
  | "backgroundImage"
  | "lifeEnabled"
  | "blinkEnabled"
  | "motionEnabled"
  | "lifeV2Enabled"
  | "speechMotionEnabled"
  | "idleMotionEnabled"
  | "gazeEnabled"
  | "cameraFollowEnabled"
  | "lifeMotionStrength"
  | "cameraFollowStrength"
  | "lifeIntensity"
  | "normalBlinkImage"
  | "eyeImages"
  | "blinkCrop"
  | "lipSyncEnabled"
  | "audioInputEnabled"
  | "mouthThreshold"
  | "mouthCrop"
  | "mouthImages"
>;

type AppErrorBoundaryState = {
  error: Error | undefined;
};

const STORAGE_KEY = "reaction-standee:v1";
const IMAGE_DB_NAME = "reaction-standee-images";
const IMAGE_STORE_NAME = "images";
const BACKGROUND_IMAGE_KEY = "__background__";
const NORMAL_BLINK_IMAGE_KEY = "__normal_blink__";
const EYE_IMAGE_KEYS: Record<EyeImageSlot, string> = {
  lookLeft: "__eye_look_left__",
  lookRight: "__eye_look_right__",
};
const MOUTH_IMAGE_KEYS: Record<MouthImageSlot, string> = {
  smallOpen: "__mouth_small_open__",
  wideOpen: "__mouth_wide_open__",
};
const SHARED_REACTION_URL = "/api/reaction";
const SHARED_REACTION_EVENTS_URL = "/api/reaction/events";
const SHARED_ASSETS_URL = "/api/assets";
const SHARED_SETTINGS_URL = "/api/settings";
const publicAssetUrl = (assetPath: string) => `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, "")}`;
const localApiEnabled = import.meta.env.VITE_DEPLOY_TARGET !== "static";
const pwaEnabled = import.meta.env.PROD && !localApiEnabled;
const AVATAR_SYNC_INTERVAL_MS = 50;
const LIP_SYNC_CALIBRATION_WARMUP_MS = 350;
const LIP_SYNC_CALIBRATION_MS = 1250;
const LIP_SYNC_START_HOLD_MS = 70;
const LIP_SYNC_END_HOLD_MS = 260;
const LIP_SYNC_MAX_SPEECH_MS = 5000;
const LIP_SYNC_MIN_SHAPE_HOLD_MS = 90;
const LIP_SYNC_NOISE_MARGIN_MIN = 1.2;
const LIP_SYNC_NOISE_MARGIN_RATIO = 0.035;
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

const mouthImageSlots: Array<{ key: MouthImageSlot; label: string; file: string }> = [
  { key: "smallOpen", label: "小開き口", file: "mouth_small_open.png" },
  { key: "wideOpen", label: "大開き口", file: "mouth_wide_open.png" },
];

const eyeImageSlots: Array<{ key: EyeImageSlot; label: string; file: string }> = [
  { key: "lookLeft", label: "目線左", file: "eyes_left.png" },
  { key: "lookRight", label: "目線右", file: "eyes_right.png" },
];

const canvasAspectRatios: Array<{ key: CanvasAspectRatio; label: string; value: number }> = [
  { key: "9:16", label: "9:16 ショート動画", value: 9 / 16 },
  { key: "16:9", label: "16:9 横動画", value: 16 / 9 },
];

const lifeModeOptions: Array<{ key: LifeMode; label: string }> = [
  { key: "off", label: "OFF" },
  { key: "subtle", label: "弱" },
  { key: "standard", label: "標準" },
  { key: "strong", label: "強" },
  { key: "check", label: "確認用" },
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
  selectedAudioDeviceId: "",
  trackingEnabled: false,
  sensitivity: "standard",
  size: 620,
  x: 0,
  y: 80,
  avatarSize: 620,
  avatarX: 0,
  avatarY: 80,
  outlineEnabled: true,
  outlineWidth: 3,
  outlineQuality: "standard",
  adjustmentGuidesEnabled: true,
  canvasAspectRatio: "9:16",
  backgroundMode: "transparent",
  backgroundColor: "#111827",
  backgroundImage: undefined,
  lifeEnabled: true,
  blinkEnabled: true,
  motionEnabled: true,
  lifeV2Enabled: true,
  speechMotionEnabled: true,
  idleMotionEnabled: true,
  gazeEnabled: true,
  cameraFollowEnabled: true,
  lifeMotionStrength: 50,
  cameraFollowStrength: 35,
  lifeIntensity: "standard",
  normalBlinkImage: undefined,
  eyeImages: {},
  blinkCrop: {
    x: 34,
    y: 19,
    width: 28,
    height: 12,
  },
  lipSyncEnabled: false,
  audioInputEnabled: false,
  mouthThreshold: 28,
  mouthCrop: {
    x: 43,
    y: 35,
    width: 15,
    height: 9,
  },
  mouthImages: {},
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
      eyeImages: {},
      mouthImages: {},
      images: {},
    };
  } catch {
    return defaultSettings;
  }
}

async function readSharedStoredSettingsPayload(): Promise<SharedStoredSettingsPayload | undefined> {
  if (!localApiEnabled) return undefined;
  try {
    const response = await fetch(SHARED_SETTINGS_URL, { cache: "no-store" });
    if (!response.ok) return undefined;
    return (await response.json()) as SharedStoredSettingsPayload;
  } catch {
    return undefined;
  }
}

async function saveSharedStoredSettings(settings: StoredSettings) {
  if (!localApiEnabled) return;
  try {
    await fetch(SHARED_SETTINGS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
  } catch {
    // Browser localStorage remains a fallback when the local API is unavailable.
  }
}

function toStoredSettings(settings: Settings): StoredSettings {
  return {
    selectedDeviceId: settings.selectedDeviceId,
    selectedAudioDeviceId: settings.selectedAudioDeviceId,
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
    outlineQuality: settings.outlineQuality,
    adjustmentGuidesEnabled: settings.adjustmentGuidesEnabled,
    canvasAspectRatio: settings.canvasAspectRatio,
    backgroundMode: settings.backgroundMode,
    backgroundColor: settings.backgroundColor,
    lifeEnabled: settings.lifeEnabled,
    blinkEnabled: settings.blinkEnabled,
    motionEnabled: settings.motionEnabled,
    lifeV2Enabled: settings.lifeV2Enabled,
    speechMotionEnabled: settings.speechMotionEnabled,
    idleMotionEnabled: settings.idleMotionEnabled,
    gazeEnabled: settings.gazeEnabled,
    cameraFollowEnabled: settings.cameraFollowEnabled,
    lifeMotionStrength: settings.lifeMotionStrength,
    cameraFollowStrength: settings.cameraFollowStrength,
    lifeIntensity: settings.lifeIntensity,
    blinkCrop: settings.blinkCrop,
    lipSyncEnabled: settings.lipSyncEnabled,
    audioInputEnabled: settings.audioInputEnabled,
    mouthThreshold: settings.mouthThreshold,
    mouthCrop: settings.mouthCrop,
  };
}

function toSharedAvatarSettings(settings: Settings): SharedAvatarSettings {
  return {
    avatarSize: settings.avatarSize,
    avatarX: settings.avatarX,
    avatarY: settings.avatarY,
    outlineEnabled: settings.outlineEnabled,
    outlineWidth: settings.outlineWidth,
    outlineQuality: settings.outlineQuality,
    adjustmentGuidesEnabled: settings.adjustmentGuidesEnabled,
    canvasAspectRatio: settings.canvasAspectRatio,
    backgroundMode: settings.backgroundMode,
    backgroundColor: settings.backgroundColor,
    backgroundImage: settings.backgroundImage,
    lifeEnabled: settings.lifeEnabled,
    blinkEnabled: settings.blinkEnabled,
    motionEnabled: settings.motionEnabled,
    lifeV2Enabled: settings.lifeV2Enabled,
    speechMotionEnabled: settings.speechMotionEnabled,
    idleMotionEnabled: settings.idleMotionEnabled,
    gazeEnabled: settings.gazeEnabled,
    cameraFollowEnabled: settings.cameraFollowEnabled,
    lifeMotionStrength: settings.lifeMotionStrength,
    cameraFollowStrength: settings.cameraFollowStrength,
    lifeIntensity: settings.lifeIntensity,
    normalBlinkImage: settings.normalBlinkImage,
    eyeImages: settings.eyeImages,
    blinkCrop: settings.blinkCrop,
    lipSyncEnabled: settings.lipSyncEnabled,
    audioInputEnabled: settings.audioInputEnabled,
    mouthThreshold: settings.mouthThreshold,
    mouthCrop: settings.mouthCrop,
    mouthImages: settings.mouthImages,
  };
}

function getLifeMode(settings: Settings): LifeMode {
  if (!settings.lifeEnabled) return "off";
  if (settings.lifeIntensity === "strong" && settings.lifeMotionStrength >= 90 && settings.cameraFollowStrength >= 90) {
    return "check";
  }
  return settings.lifeIntensity;
}

function getLifeModePatch(mode: LifeMode): Partial<Settings> {
  if (mode === "off") {
    return { lifeEnabled: false };
  }

  const presets: Record<Exclude<LifeMode, "off">, Partial<Settings>> = {
    subtle: {
      lifeEnabled: true,
      lifeV2Enabled: true,
      lifeIntensity: "subtle",
      lifeMotionStrength: 30,
      cameraFollowStrength: 25,
    },
    standard: {
      lifeEnabled: true,
      lifeV2Enabled: true,
      lifeIntensity: "standard",
      lifeMotionStrength: 50,
      cameraFollowStrength: 35,
    },
    strong: {
      lifeEnabled: true,
      lifeV2Enabled: true,
      lifeIntensity: "strong",
      lifeMotionStrength: 75,
      cameraFollowStrength: 70,
    },
    check: {
      lifeEnabled: true,
      lifeV2Enabled: true,
      lifeIntensity: "strong",
      lifeMotionStrength: 100,
      cameraFollowEnabled: true,
      cameraFollowStrength: 100,
      speechMotionEnabled: true,
      idleMotionEnabled: true,
      gazeEnabled: true,
      motionEnabled: true,
      blinkEnabled: true,
    },
  };

  return presets[mode];
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

async function readSharedAssetMap(): Promise<Record<string, string>> {
  if (!localApiEnabled) return {};
  try {
    const response = await fetch(SHARED_ASSETS_URL, { cache: "no-store" });
    if (!response.ok) return {};
    const payload = (await response.json()) as { assets?: Record<string, string> };
    return payload.assets ?? {};
  } catch {
    return {};
  }
}

async function saveSharedAsset(key: ImageDbKey, dataUrl: string) {
  if (!localApiEnabled) return;
  try {
    await fetch(`${SHARED_ASSETS_URL}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
  } catch {
    // Shared local storage is best-effort; IndexedDB remains a fallback.
  }
}

async function deleteSharedAsset(key: ImageDbKey) {
  if (!localApiEnabled) return;
  try {
    await fetch(`${SHARED_ASSETS_URL}/${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch {
    // Shared local storage is best-effort; IndexedDB remains a fallback.
  }
}

function imageSettingsFromAssetMap(
  assets: Record<string, string>,
): Pick<Settings, "images" | "backgroundImage" | "normalBlinkImage" | "eyeImages" | "mouthImages"> {
  const images = Object.fromEntries(imageSlots.map(({ key }) => [key, assets[key]]).filter(([, value]) => Boolean(value))) as Partial<ReactionImages>;
  const eyeImages = Object.fromEntries(
    eyeImageSlots.map(({ key }) => [key, assets[EYE_IMAGE_KEYS[key]]]).filter(([, value]) => Boolean(value)),
  ) as EyeImages;
  const mouthImages = Object.fromEntries(
    mouthImageSlots.map(({ key }) => [key, assets[MOUTH_IMAGE_KEYS[key]]]).filter(([, value]) => Boolean(value)),
  ) as MouthImages;

  return {
    images,
    backgroundImage: assets[BACKGROUND_IMAGE_KEY],
    normalBlinkImage: assets[NORMAL_BLINK_IMAGE_KEY],
    eyeImages,
    mouthImages,
  };
}

function assetMapFromImageSettings(
  imageSettings: Pick<Settings, "images" | "backgroundImage" | "normalBlinkImage" | "eyeImages" | "mouthImages">,
) {
  const assets: Record<string, string> = {};
  imageSlots.forEach(({ key }) => {
    const dataUrl = imageSettings.images[key];
    if (dataUrl) assets[key] = dataUrl;
  });
  if (imageSettings.backgroundImage) assets[BACKGROUND_IMAGE_KEY] = imageSettings.backgroundImage;
  if (imageSettings.normalBlinkImage) assets[NORMAL_BLINK_IMAGE_KEY] = imageSettings.normalBlinkImage;
  eyeImageSlots.forEach(({ key }) => {
    const dataUrl = imageSettings.eyeImages[key];
    if (dataUrl) assets[EYE_IMAGE_KEYS[key]] = dataUrl;
  });
  mouthImageSlots.forEach(({ key }) => {
    const dataUrl = imageSettings.mouthImages[key];
    if (dataUrl) assets[MOUTH_IMAGE_KEYS[key]] = dataUrl;
  });
  return assets;
}

function isAppBackup(value: unknown): value is AppBackup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppBackup>;
  return candidate.version === 1 && Boolean(candidate.settings) && typeof candidate.settings === "object" && Boolean(candidate.assets) && typeof candidate.assets === "object";
}

function getBackupAssetKeys() {
  return new Set([
    ...imageSlots.map(({ key }) => key),
    BACKGROUND_IMAGE_KEY,
    NORMAL_BLINK_IMAGE_KEY,
    ...eyeImageSlots.map(({ key }) => EYE_IMAGE_KEYS[key]),
    ...mouthImageSlots.map(({ key }) => MOUTH_IMAGE_KEYS[key]),
  ]);
}

async function exportAppBackup(settings: Settings) {
  const imageSettings = await loadStoredImageSettings();
  const backup: AppBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: toStoredSettings(settings),
    assets: assetMapFromImageSettings(imageSettings),
  };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  anchor.href = url;
  anchor.download = `reaction-standee-backup-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importAppBackup(file: File) {
  const parsed = JSON.parse(await file.text()) as unknown;
  if (!isAppBackup(parsed)) {
    throw new Error("対応していないバックアップ形式です。");
  }

  const allowedKeys = getBackupAssetKeys();
  await Promise.all(
    Object.entries(parsed.assets)
      .filter(([key, dataUrl]) => allowedKeys.has(key) && typeof dataUrl === "string" && dataUrl.startsWith("data:image/"))
      .map(([key, dataUrl]) => saveImageToDb(key, dataUrl)),
  );

  const restoredSettings = {
    ...toStoredSettings(defaultSettings),
    ...parsed.settings,
    selectedDeviceId: "",
    selectedAudioDeviceId: "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(restoredSettings));
  await saveSharedStoredSettings(restoredSettings);
}

async function migrateIndexedDbImagesToSharedAssets(
  indexedAssets: Record<string, string>,
  sharedAssets: Record<string, string>,
) {
  await Promise.all(
    Object.entries(indexedAssets)
      .filter(([key]) => !sharedAssets[key])
      .map(([key, dataUrl]) => saveSharedAsset(key, dataUrl)),
  );
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

async function loadEyeImages(): Promise<EyeImages> {
  if (!("indexedDB" in window)) return {};
  const db = await openImageDb();
  try {
    const entries = await Promise.all(
      eyeImageSlots.map(async ({ key }) => [key, await readImageFromDb(db, EYE_IMAGE_KEYS[key])] as const),
    );
    return Object.fromEntries(entries.filter(([, value]) => Boolean(value))) as EyeImages;
  } finally {
    db.close();
  }
}

async function loadMouthImages(): Promise<MouthImages> {
  if (!("indexedDB" in window)) return {};
  const db = await openImageDb();
  try {
    const entries = await Promise.all(
      mouthImageSlots.map(async ({ key }) => [key, await readImageFromDb(db, MOUTH_IMAGE_KEYS[key])] as const),
    );
    return Object.fromEntries(entries.filter(([, value]) => Boolean(value))) as MouthImages;
  } finally {
    db.close();
  }
}

async function loadStoredImageSettings(): Promise<
  Pick<Settings, "images" | "backgroundImage" | "normalBlinkImage" | "eyeImages" | "mouthImages">
> {
  const sharedAssets = await readSharedAssetMap();
  const sharedImageSettings = imageSettingsFromAssetMap(sharedAssets);

  if (!("indexedDB" in window)) {
    return sharedImageSettings;
  }

  const db = await openImageDb();
  try {
    const reactionEntries = await Promise.all(
      imageSlots.map(async ({ key }) => [key, await readImageFromDb(db, key)] as const),
    );
    const eyeEntries = await Promise.all(
      eyeImageSlots.map(async ({ key }) => [key, await readImageFromDb(db, EYE_IMAGE_KEYS[key])] as const),
    );
    const mouthEntries = await Promise.all(
      mouthImageSlots.map(async ({ key }) => [key, await readImageFromDb(db, MOUTH_IMAGE_KEYS[key])] as const),
    );

    const indexedImageSettings = {
      images: Object.fromEntries(reactionEntries.filter(([, value]) => Boolean(value))) as Partial<ReactionImages>,
      backgroundImage: await readImageFromDb(db, BACKGROUND_IMAGE_KEY),
      normalBlinkImage: await readImageFromDb(db, NORMAL_BLINK_IMAGE_KEY),
      eyeImages: Object.fromEntries(eyeEntries.filter(([, value]) => Boolean(value))) as EyeImages,
      mouthImages: Object.fromEntries(mouthEntries.filter(([, value]) => Boolean(value))) as MouthImages,
    };
    await migrateIndexedDbImagesToSharedAssets(assetMapFromImageSettings(indexedImageSettings), sharedAssets);
    return {
      images: { ...indexedImageSettings.images, ...sharedImageSettings.images },
      backgroundImage: sharedImageSettings.backgroundImage ?? indexedImageSettings.backgroundImage,
      normalBlinkImage: sharedImageSettings.normalBlinkImage ?? indexedImageSettings.normalBlinkImage,
      eyeImages: { ...indexedImageSettings.eyeImages, ...sharedImageSettings.eyeImages },
      mouthImages: { ...indexedImageSettings.mouthImages, ...sharedImageSettings.mouthImages },
    };
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
  await saveSharedAsset(key, dataUrl);
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

async function saveEyeImage(key: EyeImageSlot, dataUrl: string) {
  return saveImageToDb(EYE_IMAGE_KEYS[key], dataUrl);
}

async function deleteEyeImage(key: EyeImageSlot) {
  return deleteImageFromDb(EYE_IMAGE_KEYS[key]);
}

async function saveMouthImage(key: MouthImageSlot, dataUrl: string) {
  return saveImageToDb(MOUTH_IMAGE_KEYS[key], dataUrl);
}

async function deleteMouthImage(key: MouthImageSlot) {
  return deleteImageFromDb(MOUTH_IMAGE_KEYS[key]);
}

async function deleteImageFromDb(key: ImageDbKey) {
  await deleteSharedAsset(key);
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
  if (localApiEnabled) {
    try {
      await fetch(SHARED_ASSETS_URL, { method: "DELETE" });
    } catch {
      // Shared local storage is best-effort; IndexedDB remains a fallback.
    }
  }
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

async function publishSharedState(
  reaction: Reaction,
  mouthShape: MouthShape,
  audioLevel: number,
  cameraFollow: CameraFollow,
  settings?: Settings,
) {
  if (!localApiEnabled) return;
  const body: {
    reaction: Reaction;
    mouthShape: MouthShape;
    audioLevel: number;
    cameraFollow: CameraFollow;
    settings?: SharedAvatarSettings;
  } = { reaction, mouthShape, audioLevel, cameraFollow };
  if (settings) {
    body.settings = toSharedAvatarSettings(settings);
  }

  await fetch(SHARED_REACTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readSharedReaction(): Promise<SharedReactionPayload | undefined> {
  if (!localApiEnabled) return undefined;
  const response = await fetch(`${SHARED_REACTION_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as Partial<SharedReactionPayload>;
  if (!payload.reaction || !reactions.some((item) => item.key === payload.reaction)) return undefined;
  return {
    reaction: payload.reaction,
    mouthShape: isMouthShape(payload.mouthShape) ? payload.mouthShape : "closed",
    audioLevel: typeof payload.audioLevel === "number" ? payload.audioLevel : 0,
    cameraFollow: isCameraFollow(payload.cameraFollow) ? payload.cameraFollow : { x: 0, y: 0, visible: false },
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : 0,
    settingsUpdatedAt: typeof payload.settingsUpdatedAt === "number" ? payload.settingsUpdatedAt : undefined,
    settings: payload.settings,
  };
}

function getAppRoute(): AppRoute {
  const queryRoute = new URLSearchParams(window.location.search).get("route");
  const rawRoute = queryRoute ? `/${queryRoute.replace(/^\//, "")}` : window.location.pathname;
  if (rawRoute === "/avatar") return "avatar";
  if (rawRoute === "/capture") return "capture";
  if (rawRoute === "/record") return "record";
  if (rawRoute === "/canvas") return "canvas";
  return "settings";
}

function getAppRouteHref(route: AppRoute) {
  const baseUrl = import.meta.env.BASE_URL;
  if (route === "settings") {
    return baseUrl && baseUrl !== "/" ? baseUrl : "/settings";
  }
  if (baseUrl && baseUrl !== "/") return `${baseUrl}?route=${route}`;
  return `/${route}`;
}

function readPerfOptions(): PerfOptions {
  const params = new URLSearchParams(window.location.search);
  const isEnabled = params.get("perf") === "1" || params.get("perf") === "true";
  const maxInferenceFps = Number(params.get("inferFps") ?? "0");
  return {
    cameraPreset: params.get("camera") === "low" || params.get("cam") === "low" ? "low" : "default",
    enabled: isEnabled,
    maxInferenceFps: Number.isFinite(maxInferenceFps) ? clamp(maxInferenceFps, 0, 60) : 0,
    noBackground: isEnabled && (params.get("noBg") === "1" || params.get("noBackground") === "1"),
    noEffects: isEnabled && params.get("noEffects") === "1",
    noMotion: isEnabled && params.get("noMotion") === "1",
    noOutline: isEnabled && params.get("noOutline") === "1",
    noOverlays: isEnabled && params.get("noOverlays") === "1",
  };
}

function getPerfClassName(options: PerfOptions) {
  if (!options.enabled) return "";
  return [
    "perf",
    options.cameraPreset === "low" ? "perf-camera-low" : "",
    options.maxInferenceFps ? "perf-infer-limit" : "",
    options.noBackground ? "perf-no-background" : "",
    options.noEffects ? "perf-no-effects" : "",
    options.noMotion ? "perf-no-motion" : "",
    options.noOutline ? "perf-no-outline" : "",
    options.noOverlays ? "perf-no-overlays" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getAppRoute());
  const perfOptions = readPerfOptions();
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [reaction, setReaction] = useState<Reaction>("normal");
  const [debug, setDebug] = useState<TrackingDebug>({
    candidate: "normal",
    stableForMs: 0,
    confidence: 0,
    status: "待機中",
  });
  const [audioDebug, setAudioDebug] = useState<AudioDebug>({
    volume: 0,
    speechLevel: 0,
    mouthShape: "closed",
    status: "音声入力は停止中",
  });
  const [audioError, setAudioError] = useState("");
  const [mouthShape, setMouthShape] = useState<MouthShape>("closed");
  const [manualBlinkSignal, setManualBlinkSignal] = useState(0);
  const [manualGazeRequest, setManualGazeRequest] = useState({ direction: "lookLeft" as EyeImageSlot, signal: 0 });
  const [gazeDebug, setGazeDebug] = useState<GazeDebug>({
    direction: "center",
    status: "待機中",
    canGaze: false,
    hasLeft: false,
    hasRight: false,
    cropValid: false,
  });
  const [avatarVisualState, setAvatarVisualState] = useState<AvatarVisualState>({
    isBlinking: false,
    eyeDirection: "center",
    reactionStartedAt: performance.now(),
  });
  const [audioCalibrationSignal, setAudioCalibrationSignal] = useState(0);
  const [cameraFollow, setCameraFollow] = useState<CameraFollow>({ x: 0, y: 0, visible: false });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraError, setCameraError] = useState("");
  const manualMouthTimeoutRef = useRef<number | undefined>(undefined);
  const avatarSettingsUpdatedAtRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialStoredSettingsRef = useRef<StoredSettings>(toStoredSettings(settings));
  const sharedStoredSettingsUpdatedAtRef = useRef(0);
  const [sharedSettingsReady, setSharedSettingsReady] = useState(false);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const navigateToRoute = useCallback((nextRoute: AppRoute) => {
    window.history.pushState(null, "", getAppRouteHref(nextRoute));
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const handlePopState = () => setRoute(getAppRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!pwaEnabled || route === "settings") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        navigateToRoute("settings");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateToRoute, route]);

  useEffect(() => {
    let cancelled = false;

    void readSharedStoredSettingsPayload()
      .then((payload) => {
        if (cancelled) return;
        const sharedSettings = payload?.settings;
        if (sharedSettings) {
          sharedStoredSettingsUpdatedAtRef.current = payload.updatedAt ?? Date.now();
          updateSettings(sharedSettings);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...initialStoredSettingsRef.current, ...sharedSettings }));
          } catch {
            // Shared settings still loaded, so local cache failure is not fatal.
          }
        } else if (route === "settings") {
          void saveSharedStoredSettings(initialStoredSettingsRef.current);
        }
      })
      .finally(() => {
        if (!cancelled) setSharedSettingsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [route, updateSettings]);

  useEffect(() => {
    if (route === "settings" || !localApiEnabled) return;
    let cancelled = false;

    const syncSharedSettings = () => {
      void readSharedStoredSettingsPayload()
        .then(async (payload) => {
          if (cancelled || !payload?.settings) return;
          const nextUpdatedAt = payload.updatedAt ?? 1;
          if (nextUpdatedAt <= sharedStoredSettingsUpdatedAtRef.current) return;
          sharedStoredSettingsUpdatedAtRef.current = nextUpdatedAt;
          const imageSettings = await loadStoredImageSettings().catch(() => undefined);
          if (!cancelled) {
            updateSettings({
              ...payload.settings,
              ...(imageSettings ?? {}),
            });
          }
        })
        .catch(() => undefined);
    };

    syncSharedSettings();
    const interval = window.setInterval(syncSharedSettings, 700);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [route, updateSettings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStoredSettings(settings)));
    } catch {
      setCameraError("設定の保存に失敗しました。ブラウザの保存容量を確認してください。");
    }
    if (route === "settings" && sharedSettingsReady) {
      void saveSharedStoredSettings(toStoredSettings(settings));
    }
  }, [route, settings, sharedSettingsReady]);

  useEffect(() => {
    let cancelled = false;
    void loadStoredImageSettings()
      .then((imageSettings) => {
        if (!cancelled) updateSettings(imageSettings);
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
      .then((deviceList) => {
        setDevices(deviceList.filter((device) => device.kind === "videoinput"));
        setAudioDevices(deviceList.filter((device) => device.kind === "audioinput"));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (route === "avatar") return;
    void publishSharedState(reaction, reaction === "normal" ? mouthShape : "closed", audioDebug.volume, cameraFollow, settings).catch(
      () => undefined,
    );
  }, [reaction, route, settings]);

  useEffect(() => {
    if (route === "avatar") return;
    void publishSharedState(reaction, reaction === "normal" ? mouthShape : "closed", audioDebug.volume, cameraFollow).catch(
      () => undefined,
    );
  }, [cameraFollow, mouthShape, reaction, route]);

  useEffect(() => {
    if (route !== "avatar" || !localApiEnabled) return;
    let cancelled = false;
    let lastUpdatedAt = 0;
    let fallbackInterval = 0;

    const applyPayload = (payload: SharedReactionPayload | undefined) => {
      if (!cancelled && payload && payload.updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = payload.updatedAt;
        setReaction(payload.reaction);
        setMouthShape(payload.reaction === "normal" && payload.mouthShape ? payload.mouthShape : "closed");
        setAudioDebug((current) => ({
          ...current,
          volume: payload.audioLevel ?? current.volume,
          mouthShape: payload.mouthShape ?? "closed",
          status: "入力側から同期中",
        }));
        setCameraFollow(payload.cameraFollow ?? { x: 0, y: 0, visible: false });
        if (payload.settings) {
          avatarSettingsUpdatedAtRef.current = payload.settingsUpdatedAt ?? payload.updatedAt;
          updateSettings(payload.settings);
        } else if (payload.settingsUpdatedAt && payload.settingsUpdatedAt > avatarSettingsUpdatedAtRef.current) {
          avatarSettingsUpdatedAtRef.current = payload.settingsUpdatedAt;
          void readSharedReaction()
            .then((fullPayload) => {
              if (!cancelled && fullPayload?.settings) updateSettings(fullPayload.settings);
            })
            .catch(() => undefined);
        }
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
        if (!isCameraFollow(payload.cameraFollow)) {
          payload.cameraFollow = { x: 0, y: 0, visible: false };
        }
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
    perfOptions,
    videoRef,
    onReaction: setReaction,
    onDebug: setDebug,
    onDevices: setDevices,
    onError: setCameraError,
    onCameraFollow: setCameraFollow,
  });

  useLipSyncAudio({
    enabled: route !== "avatar" && settings.lipSyncEnabled && settings.audioInputEnabled,
    calibrationSignal: audioCalibrationSignal,
    deviceId: settings.selectedAudioDeviceId,
    threshold: settings.mouthThreshold,
    onDebug: setAudioDebug,
    onError: setAudioError,
    onMouthShape: setMouthShape,
  });

  const handleManualMouth = useCallback((nextMouthShape: MouthShape) => {
    window.clearTimeout(manualMouthTimeoutRef.current);
    setMouthShape(nextMouthShape);
    setAudioDebug((current) => ({
      ...current,
      mouthShape: nextMouthShape,
      status: "デバッグ表示中",
    }));
    manualMouthTimeoutRef.current = window.setTimeout(() => {
      setMouthShape("closed");
      setAudioDebug((current) => ({ ...current, mouthShape: "closed" }));
    }, 420);
  }, []);

  const handleManualGaze = useCallback((direction: EyeImageSlot) => {
    setManualGazeRequest((current) => ({ direction, signal: current.signal + 1 }));
  }, []);

  const isElectronRecord = route === "record" && navigator.userAgent.includes("Electron");

  return (
    <main className={`app ${route}${isElectronRecord ? " electronRecord" : ""} ${getPerfClassName(perfOptions)}`}>
      {isElectronRecord && <div className="electronDragBar" aria-hidden="true" />}
      <AvatarStage
        manualGazeRequest={manualGazeRequest}
        manualBlinkSignal={manualBlinkSignal}
        mouthShape={mouthShape}
        onGazeDebug={setGazeDebug}
        reaction={reaction}
        route={route}
        settings={settings}
        audioLevel={audioDebug.volume}
        cameraFollow={cameraFollow}
        perfOptions={perfOptions}
        onVisualState={setAvatarVisualState}
      />
      <video ref={videoRef} className="trackingVideo" muted playsInline />
      {perfOptions.enabled && <PerfOverlay debug={debug} options={perfOptions} route={route} />}

      {route === "canvas" && <CanvasRecordPanel settings={settings} reaction={reaction} mouthShape={mouthShape} visualState={avatarVisualState} />}

      {route === "settings" && (
        <SettingsPanel
          audioDebug={audioDebug}
          audioDevices={audioDevices}
          audioError={audioError}
          cameraFollow={cameraFollow}
          cameraError={cameraError}
          debug={debug}
          devices={devices}
          gazeDebug={gazeDebug}
          onChange={updateSettings}
          onCalibrateAudio={() => setAudioCalibrationSignal((value) => value + 1)}
          onManualBlink={() => setManualBlinkSignal((value) => value + 1)}
          onManualGaze={handleManualGaze}
          onManualMouth={handleManualMouth}
          onManualReaction={setReaction}
          onNavigate={navigateToRoute}
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
  perfOptions: PerfOptions;
  sensitivity: Sensitivity;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onReaction: (reaction: Reaction) => void;
  onDebug: (debug: TrackingDebug) => void;
  onDevices: (devices: MediaDeviceInfo[]) => void;
  onError: (message: string) => void;
  onCameraFollow: (follow: CameraFollow) => void;
};

function usePoseTracking({
  enabled,
  deviceId,
  perfOptions,
  sensitivity,
  videoRef,
  onReaction,
  onDebug,
  onDevices,
  onError,
  onCameraFollow,
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
        onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "停止中", inferenceFps: 0, inferenceMs: 0 });
        onCameraFollow({ x: 0, y: 0, visible: false });
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

        const cameraSize =
          perfOptions.cameraPreset === "low"
            ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? {
                deviceId: { exact: deviceId },
                ...cameraSize,
              }
            : cameraSize,
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
        let inferenceCount = 0;
        let inferenceTotalMs = 0;
        let inferenceWindowStartedAt = performance.now();
        let lastInferenceFps = 0;
        let lastInferenceMs = 0;
        let lastInferenceAt = 0;

        const tick = () => {
          const landmarker = landmarkerRef.current;
          const handLandmarker = handLandmarkerRef.current;
          if (!landmarker || !handLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            animationRef.current = requestAnimationFrame(tick);
            return;
          }

          const now = performance.now();
          if (perfOptions.maxInferenceFps > 0 && now - lastInferenceAt < 1000 / perfOptions.maxInferenceFps) {
            animationRef.current = requestAnimationFrame(tick);
            return;
          }
          lastInferenceAt = now;
          const inferenceStartedAt = performance.now();
          const result = landmarker.detectForVideo(video, now);
          const handResult = handLandmarker.detectForVideo(video, now);
          const inferenceMs = performance.now() - inferenceStartedAt;
          inferenceCount += 1;
          inferenceTotalMs += inferenceMs;
          if (now - inferenceWindowStartedAt >= 1000) {
            lastInferenceFps = (inferenceCount * 1000) / Math.max(1, now - inferenceWindowStartedAt);
            lastInferenceMs = inferenceTotalMs / Math.max(1, inferenceCount);
            inferenceWindowStartedAt = now;
            inferenceCount = 0;
            inferenceTotalMs = 0;
          }
          if (result.landmarks[0]) {
            lastSeenRef.current = now;
            onCameraFollow(getCameraFollowFromLandmarks(result.landmarks[0], sensitivity));
          } else {
            onCameraFollow({ x: 0, y: 0, visible: false });
          }
          const next = classifyPose(result, handResult, sensitivity, lastSeenRef.current);
          const debug = applyStateMachine(next, sensitivity, {
            currentReactionRef,
            candidateRef,
            candidateStartedRef,
            lastSwitchRef,
            onReaction,
          });
          onDebug({
            ...debug,
            inferenceFps: lastInferenceFps,
            inferenceMs: lastInferenceMs,
            videoHeight: video.videoHeight,
            videoWidth: video.videoWidth,
          });
          animationRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        const message = error instanceof Error ? error.message : "カメラを開始できませんでした。";
        onError(message);
        onDebug({ candidate: "normal", stableForMs: 0, confidence: 0, status: "エラー", inferenceFps: 0, inferenceMs: 0 });
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera(streamRef, animationRef);
    };
  }, [deviceId, enabled, onCameraFollow, onDebug, onDevices, onError, onReaction, perfOptions.cameraPreset, perfOptions.maxInferenceFps, sensitivity, videoRef]);
}

function stopCamera(
  streamRef: React.MutableRefObject<MediaStream | null>,
  animationRef: React.MutableRefObject<number>,
) {
  cancelAnimationFrame(animationRef.current);
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
}

function getCameraFollowFromLandmarks(landmarks: NormalizedLandmark[], sensitivity: Sensitivity): CameraFollow {
  const profile = sensitivityProfile[sensitivity];
  const nose = landmarks[0];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  if (!visible(nose, profile) || !visible(leftShoulder, profile) || !visible(rightShoulder, profile)) {
    return { x: 0, y: 0, visible: false };
  }

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const subjectX = nose.x * 0.72 + shoulderCenter.x * 0.28;
  const subjectY = nose.y * 0.72 + shoulderCenter.y * 0.28;
  return {
    x: normalizeCameraOffset(subjectX - 0.5, 0.035, 0.22),
    y: normalizeCameraOffset(subjectY - 0.45, 0.055, 0.28),
    visible: true,
  };
}

function normalizeCameraOffset(offset: number, deadZone: number, fullScale: number) {
  const abs = Math.abs(offset);
  if (abs <= deadZone) return 0;
  return clamp((Math.sign(offset) * (abs - deadZone)) / (fullScale - deadZone), -1, 1);
}

type LipSyncAudioArgs = {
  enabled: boolean;
  calibrationSignal: number;
  deviceId: string;
  threshold: number;
  onMouthShape: (mouthShape: MouthShape) => void;
  onDebug: (debug: AudioDebug) => void;
  onError: (message: string) => void;
};

function useLipSyncAudio({
  enabled,
  calibrationSignal,
  deviceId,
  threshold,
  onMouthShape,
  onDebug,
  onError,
}: LipSyncAudioArgs) {
  const animationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const smoothedLevelRef = useRef(0);
  const noiseFloorRef = useRef(0);
  const calibrationStartedRef = useRef(0);
  const calibrationSumRef = useRef(0);
  const calibrationCountRef = useRef(0);
  const mouthShapeRef = useRef<MouthShape>("closed");
  const speakingRef = useRef(false);
  const speechStartRef = useRef(0);
  const speakingStartedAtRef = useRef(0);
  const quietStartRef = useRef(0);
  const lastSwitchRef = useRef(0);
  const nextRhythmAtRef = useRef(0);
  const rhythmStepRef = useRef(0);
  const lastDebugRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      stopAudio(streamRef, animationRef, audioContextRef);
      onError("");
      smoothedLevelRef.current = 0;
      noiseFloorRef.current = 0;
      calibrationStartedRef.current = 0;
      calibrationSumRef.current = 0;
      calibrationCountRef.current = 0;
      mouthShapeRef.current = "closed";
      speakingRef.current = false;
      speechStartRef.current = 0;
      speakingStartedAtRef.current = 0;
      quietStartRef.current = 0;
      nextRhythmAtRef.current = 0;
      rhythmStepRef.current = 0;
      onMouthShape("closed");

      if (!enabled) {
        onDebug({ volume: 0, speechLevel: 0, mouthShape: "closed", status: "音声入力は停止中" });
        return;
      }

      try {
        const audioConstraints: MediaTrackConstraints = deviceId
          ? {
              deviceId: { exact: deviceId },
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            }
          : {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            };
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextClass =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioContext = new AudioContextClass();
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => undefined);
        }
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.62;
        audioContext.createMediaStreamSource(stream).connect(analyser);

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        lastSwitchRef.current = performance.now();

        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let index = 0; index < data.length; index += 1) {
            const centered = (data[index] - 128) / 128;
            sum += centered * centered;
          }

          const rms = Math.sqrt(sum / data.length);
          const rawLevel = clamp(rms * 1800, 0, 100);
          const previousLevel = smoothedLevelRef.current;
          const smoothing = rawLevel > previousLevel ? 0.34 : 0.16;
          const smoothedLevel = previousLevel * (1 - smoothing) + rawLevel * smoothing;
          smoothedLevelRef.current = smoothedLevel;

          const now = performance.now();
          const effectiveThreshold = clamp(threshold, 1, 100);
          const startDelta = getLipSyncStartDelta(effectiveThreshold);
          const stopDelta = Math.max(1.6, startDelta * 0.82);
          if (!calibrationStartedRef.current) {
            calibrationStartedRef.current = now;
          }
          if (now - calibrationStartedRef.current < LIP_SYNC_CALIBRATION_MS) {
            if (now - calibrationStartedRef.current >= LIP_SYNC_CALIBRATION_WARMUP_MS) {
              calibrationSumRef.current += smoothedLevel;
              calibrationCountRef.current += 1;
              noiseFloorRef.current = calibrationSumRef.current / Math.max(1, calibrationCountRef.current);
            } else {
              noiseFloorRef.current = smoothedLevel;
            }
            if (mouthShapeRef.current !== "closed") {
              mouthShapeRef.current = "closed";
              onMouthShape("closed");
            }
            if (now - lastDebugRef.current > 120) {
              lastDebugRef.current = now;
              onDebug({
                volume: smoothedLevel,
                speechLevel: 0,
                mouthShape: "closed",
                status: "環境音を測定中",
              });
            }
            animationRef.current = requestAnimationFrame(tick);
            return;
          }

          if (!noiseFloorRef.current) {
            noiseFloorRef.current = smoothedLevel;
          }
          const previousNoiseFloor = noiseFloorRef.current;
          if (!speakingRef.current && smoothedLevel < previousNoiseFloor + startDelta * 0.35) {
            const noiseSmoothing = smoothedLevel < previousNoiseFloor ? 0.08 : 0.004;
            noiseFloorRef.current = previousNoiseFloor * (1 - noiseSmoothing) + smoothedLevel * noiseSmoothing;
          } else if (smoothedLevel < previousNoiseFloor) {
            noiseFloorRef.current = previousNoiseFloor * 0.9 + smoothedLevel * 0.1;
          }
          const noiseFloor = noiseFloorRef.current;
          const speechLevel = Math.max(0, smoothedLevel - noiseFloor);

          if (!speakingRef.current) {
            if (speechLevel >= startDelta) {
              if (!speechStartRef.current) {
                speechStartRef.current = now;
              }
              if (now - speechStartRef.current >= LIP_SYNC_START_HOLD_MS) {
                speakingRef.current = true;
                speakingStartedAtRef.current = now;
                quietStartRef.current = 0;
                nextRhythmAtRef.current = 0;
              }
            } else {
              speechStartRef.current = 0;
              quietStartRef.current = 0;
            }
          } else if (now - speakingStartedAtRef.current >= LIP_SYNC_MAX_SPEECH_MS) {
            speakingRef.current = false;
            speakingStartedAtRef.current = 0;
            speechStartRef.current = 0;
            quietStartRef.current = 0;
            nextRhythmAtRef.current = 0;
            noiseFloorRef.current = Math.max(noiseFloorRef.current, smoothedLevel - startDelta * 0.5);
          } else if (speechLevel < stopDelta) {
            if (!quietStartRef.current) {
              quietStartRef.current = now;
            }
            if (now - quietStartRef.current >= LIP_SYNC_END_HOLD_MS) {
              speakingRef.current = false;
              speakingStartedAtRef.current = 0;
              speechStartRef.current = 0;
              quietStartRef.current = 0;
              nextRhythmAtRef.current = 0;
            }
          } else {
            quietStartRef.current = 0;
          }

          const intensity = getSpeechIntensity(speechLevel, startDelta);
          let nextShape = mouthShapeRef.current;
          if (speakingRef.current) {
            if (now >= nextRhythmAtRef.current && now - lastSwitchRef.current >= LIP_SYNC_MIN_SHAPE_HOLD_MS) {
              nextShape = getNextRhythmMouthShape(mouthShapeRef.current, intensity, rhythmStepRef);
              nextRhythmAtRef.current = now + getLipSyncRhythmMs(intensity);
            }
          } else if (mouthShapeRef.current !== "closed" && now - lastSwitchRef.current >= LIP_SYNC_MIN_SHAPE_HOLD_MS) {
            nextShape = "closed";
          }

          const shapeChanged = nextShape !== mouthShapeRef.current;
          if (shapeChanged) {
            mouthShapeRef.current = nextShape;
            lastSwitchRef.current = now;
            onMouthShape(nextShape);
          }

          if (shapeChanged || now - lastDebugRef.current > 120) {
            lastDebugRef.current = now;
            onDebug({
              volume: smoothedLevel,
              speechLevel,
              mouthShape: mouthShapeRef.current,
              status:
                audioContext.state !== "running"
                  ? `音声入力 ${audioContext.state}`
                  : speakingRef.current
                    ? `発話中 ${getSpeechIntensityLabel(intensity)}`
                    : quietStartRef.current
                      ? "発話終了待ち"
                      : "待機中",
            });
          }
          animationRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        const message = error instanceof Error ? error.message : "音声入力を開始できませんでした。";
        onError(message);
        onDebug({ volume: 0, speechLevel: 0, mouthShape: "closed", status: "音声入力エラー" });
        onMouthShape("closed");
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopAudio(streamRef, animationRef, audioContextRef);
    };
  }, [calibrationSignal, deviceId, enabled, onDebug, onError, onMouthShape, threshold]);
}

function stopAudio(
  streamRef: React.MutableRefObject<MediaStream | null>,
  animationRef: React.MutableRefObject<number>,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
) {
  cancelAnimationFrame(animationRef.current);
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  void audioContextRef.current?.close().catch(() => undefined);
  audioContextRef.current = null;
}

function getSpeechIntensity(level: number, threshold: number): SpeechIntensity {
  if (level >= threshold * 1.9) return "strong";
  if (level >= threshold * 1.18) return "medium";
  return "soft";
}

function getLipSyncStartDelta(threshold: number) {
  return Math.max(LIP_SYNC_NOISE_MARGIN_MIN, 1.4 + threshold * LIP_SYNC_NOISE_MARGIN_RATIO);
}

function getSpeechIntensityLabel(intensity: SpeechIntensity) {
  if (intensity === "strong") return "強";
  if (intensity === "medium") return "中";
  return "弱";
}

function getLipSyncRhythmMs(intensity: SpeechIntensity) {
  if (intensity === "strong") return randomBetween(105, 145);
  if (intensity === "medium") return randomBetween(120, 165);
  return randomBetween(135, 180);
}

function getNextRhythmMouthShape(
  current: MouthShape,
  intensity: SpeechIntensity,
  rhythmStepRef: React.MutableRefObject<number>,
): MouthShape {
  const patterns: Record<SpeechIntensity, MouthShape[]> = {
    soft: ["smallOpen", "closed", "smallOpen", "closed", "smallOpen"],
    medium: ["smallOpen", "closed", "wideOpen", "smallOpen", "closed"],
    strong: ["wideOpen", "smallOpen", "wideOpen", "closed", "smallOpen", "wideOpen"],
  };
  const pattern = patterns[intensity];

  for (let attempts = 0; attempts < pattern.length; attempts += 1) {
    const next = pattern[rhythmStepRef.current % pattern.length];
    rhythmStepRef.current += 1;
    if (next !== current) return next;
  }

  return current === "closed" ? "smallOpen" : "closed";
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

function getRecordingSize(aspectRatio: CanvasAspectRatio) {
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

function getRecordingFilename() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
  return `reaction-standee-${stamp}.webm`;
}

function getRecordingFrameMetrics(canvas: HTMLCanvasElement): RecordingFrameMetrics {
  const frame = document.querySelector<HTMLElement>(".recordingFrame");
  const rect = frame?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return {
      scaleX: 1,
      scaleY: 1,
      avatarTransform: identityRecordingTransform(),
      lifeTransform: identityRecordingTransform(),
      talkTransform: identityRecordingTransform(),
    };
  }
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    scaleX,
    scaleY,
    avatarTransform: readElementTransform(".avatar", scaleX, scaleY),
    lifeTransform: readElementTransform(".avatarLifeLayer", scaleX, scaleY),
    talkTransform: readElementTransform(".avatarTalkLayer", scaleX, scaleY),
  };
}

function identityRecordingTransform(): RecordingTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function readElementTransform(selector: string, scaleX: number, scaleY: number): RecordingTransform {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return identityRecordingTransform();
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === "none") return identityRecordingTransform();

  const matrix = new DOMMatrixReadOnly(transform);
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e * scaleX,
    f: matrix.f * scaleY,
  };
}

function applyRecordingTransform(
  ctx: CanvasRenderingContext2D,
  transform: RecordingTransform,
  originX: number,
  originY: number,
) {
  ctx.translate(originX, originY);
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.translate(-originX, -originY);
}

function getSupportedRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=h264,opus", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

type CanvasImageCache = Map<string, Promise<HTMLImageElement>>;

function loadCanvasImage(src: string, cache: CanvasImageCache) {
  const cached = cache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`画像を読み込めませんでした: ${src}`));
    image.src = src;
  });
  cache.set(src, promise);
  return promise;
}

function drawCoverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const sourceRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
}

function drawCroppedOverlay(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: CropRect,
  target: { x: number; y: number; width: number; height: number },
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    target.x + target.width * (crop.x / 100),
    target.y + target.height * (crop.y / 100),
    target.width * (crop.width / 100),
    target.height * (crop.height / 100),
  );
  ctx.clip();
  ctx.drawImage(image, target.x, target.y, target.width, target.height);
  ctx.restore();
}

function drawImageWithCanvasOutline(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  target: { x: number; y: number; width: number; height: number },
  outlineWidth: number,
  outlineQuality: OutlineQuality,
) {
  const width = Math.max(0, outlineWidth);
  if (width > 0) {
    const offsets =
      outlineQuality === "light"
        ? [
            [0, width],
            [width, 0],
            [0, -width],
            [-width, 0],
          ]
        : [
            [0, width],
            [width, 0],
            [0, -width],
            [-width, 0],
            [width, width],
            [-width, width],
            [width, -width],
            [-width, -width],
          ];

    ctx.save();
    ctx.filter = "brightness(0) invert(1)";
    offsets.forEach(([x, y]) => {
      ctx.drawImage(image, target.x + x, target.y + y, target.width, target.height);
    });
    ctx.restore();
  }

  ctx.drawImage(image, target.x, target.y, target.width, target.height);
}

function easeOutCubic(value: number) {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? size : size * 0.34;
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 8;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffe066";
  ctx.shadowColor = "rgba(255, 224, 102, 0.85)";
  ctx.shadowBlur = size * 0.7;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  angle: number,
  width: number,
  color: string,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.lineTo(length / 2, 0);
  ctx.stroke();
  ctx.restore();
}

async function drawRecordingReactionEffects(
  ctx: CanvasRenderingContext2D,
  reaction: Reaction,
  imageCache: CanvasImageCache,
  target: { x: number; y: number; width: number; height: number },
  elapsedMs: number,
) {
  if (reaction === "normal") return;

  const progress = clamp(elapsedMs / 820, 0, 1);
  const alpha = Math.max(0, 1 - progress * 0.92);
  const effectX = target.x - target.width * 0.14;
  const effectY = target.y - target.height * 0.12;
  const effectWidth = target.width * 1.28;
  const effectHeight = target.height * 1.24;

  if (reaction === "joy") {
    try {
      const asset = await loadCanvasImage(publicAssetUrl("effects/joy-sparkle-field.svg"), imageCache);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha + 0.08);
      ctx.drawImage(asset, effectX, effectY, effectWidth, effectHeight);
      ctx.restore();
    } catch {
      // SVG素材が読めない場合も、手描きの星だけで続行します。
    }
    const pop = 0.72 + easeOutCubic(progress) * 0.35;
    drawStar(ctx, effectX + effectWidth * 0.23, effectY + effectHeight * 0.24, effectWidth * 0.035 * pop, alpha);
    drawStar(ctx, effectX + effectWidth * 0.77, effectY + effectHeight * 0.22, effectWidth * 0.034 * pop, alpha * 0.9);
    return;
  }

  if (reaction === "surprised") {
    try {
      const asset = await loadCanvasImage(publicAssetUrl("effects/surprised-shockwave.svg"), imageCache);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha + 0.12);
      ctx.drawImage(asset, effectX, effectY, effectWidth, effectHeight);
      ctx.restore();
    } catch {
      // フォールバックのリングを下で描きます。
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = target.width * 0.018;
    ctx.beginPath();
    ctx.arc(target.x + target.width * 0.5, target.y + target.height * 0.48, target.width * (0.2 + progress * 0.36), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (reaction === "troubled") {
    const lineAlpha = Math.max(0, 1 - clamp(elapsedMs / 980, 0, 1) * 0.82);
    strokeRoundedLine(ctx, effectX + effectWidth * 0.18, effectY + effectHeight * 0.28, effectWidth * 0.18, -0.35, 8, "#dbeafe", lineAlpha);
    strokeRoundedLine(ctx, effectX + effectWidth * 0.82, effectY + effectHeight * 0.68, effectWidth * 0.17, 0.28, 7, "#dbeafe", lineAlpha * 0.86);
    strokeRoundedLine(ctx, effectX + effectWidth * 0.28, effectY + effectHeight * 0.78, effectWidth * 0.13, 0.18, 6, "#dbeafe", lineAlpha * 0.74);
    return;
  }

  if (reaction === "explain") {
    try {
      const asset = await loadCanvasImage(publicAssetUrl("effects/explain-pointer-light.svg"), imageCache);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha + 0.16);
      ctx.drawImage(asset, effectX - effectWidth * 0.04, effectY + effectHeight * 0.04, effectWidth, effectHeight);
      ctx.restore();
    } catch {
      // フォールバックのビームを下で描きます。
    }
    strokeRoundedLine(ctx, effectX + effectWidth * 0.25, effectY + effectHeight * 0.4, effectWidth * 0.32, -0.2, 11, "#bae6fd", alpha);
  }
}

async function drawRecordingFrame(
  ctx: CanvasRenderingContext2D,
  settings: Settings,
  reaction: Reaction,
  mouthShape: MouthShape,
  visualState: AvatarVisualState,
  imageCache: CanvasImageCache,
  metrics: RecordingFrameMetrics,
) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  if (settings.backgroundMode === "green") {
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, width, height);
  } else if (settings.backgroundMode === "color") {
    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  } else if (settings.backgroundMode === "image" && settings.backgroundImage) {
    try {
      drawCoverImage(ctx, await loadCanvasImage(settings.backgroundImage, imageCache), width, height);
    } catch {
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }
  }

  const primarySrc = settings.images[reaction] ?? publicAssetUrl(`reactions/${reaction}.png`);
  let primaryImage: HTMLImageElement;
  try {
    primaryImage = await loadCanvasImage(primarySrc, imageCache);
  } catch {
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.font = "48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${reaction}.png`, width / 2, height / 2);
    return;
  }

  const avatarWidth = settings.avatarSize * metrics.scaleX;
  const avatarHeight = avatarWidth * (primaryImage.height / primaryImage.width);
  const avatarX = width / 2 + settings.avatarX * metrics.scaleX - avatarWidth / 2;
  const avatarY = height / 2 + settings.avatarY * metrics.scaleY - avatarHeight / 2;

  ctx.save();
  applyRecordingTransform(ctx, metrics.avatarTransform, avatarX + avatarWidth * 0.5, avatarY + avatarHeight * 0.86);
  applyRecordingTransform(ctx, metrics.lifeTransform, avatarX + avatarWidth * 0.5, avatarY + avatarHeight * 0.82);
  applyRecordingTransform(ctx, metrics.talkTransform, avatarX + avatarWidth * 0.5, avatarY + avatarHeight * 0.86);

  drawImageWithCanvasOutline(
    ctx,
    primaryImage,
    { x: avatarX, y: avatarY, width: avatarWidth, height: avatarHeight },
    settings.outlineEnabled ? settings.outlineWidth * metrics.scaleX : 0,
    settings.outlineQuality ?? "standard",
  );

  if (reaction === "normal" && isValidBlinkCrop(settings.blinkCrop)) {
    const eyeOverlaySrc =
      visualState.isBlinking && settings.blinkEnabled
        ? settings.normalBlinkImage
        : settings.gazeEnabled
          ? getEyeOverlaySrc(visualState.eyeDirection, settings.eyeImages)
          : undefined;

    if (eyeOverlaySrc) {
      try {
        const eyeOverlayImage = await loadCanvasImage(eyeOverlaySrc, imageCache);
        drawCroppedOverlay(ctx, eyeOverlayImage, settings.blinkCrop, {
          x: avatarX,
          y: avatarY,
          width: avatarWidth,
          height: avatarHeight,
        });
      } catch {
        // 未登録または壊れた目元差分は録画を止めずにスキップします。
      }
    }
  }

  if (reaction === "normal" && settings.lipSyncEnabled && mouthShape !== "closed" && isValidMouthCrop(settings.mouthCrop)) {
    const mouthOverlaySrc = getMouthOverlaySrc(mouthShape, settings.mouthImages);
    if (mouthOverlaySrc) {
      try {
        const mouthOverlayImage = await loadCanvasImage(mouthOverlaySrc, imageCache);
        drawCroppedOverlay(ctx, mouthOverlayImage, settings.mouthCrop, {
          x: avatarX,
          y: avatarY,
          width: avatarWidth,
          height: avatarHeight,
        });
      } catch {
        // 未登録または壊れた差分は録画を止めずにスキップします。
      }
    }
  }

  await drawRecordingReactionEffects(ctx, reaction, imageCache, { x: avatarX, y: avatarY, width: avatarWidth, height: avatarHeight }, performance.now() - visualState.reactionStartedAt);

  ctx.restore();
}

function randomBetween(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampCropRect(crop: CropRect): CropRect {
  const x = clamp(Math.round(crop.x), 0, 98);
  const y = clamp(Math.round(crop.y), 0, 98);
  const width = clamp(Math.round(crop.width), 1, 100 - x);
  const height = clamp(Math.round(crop.height), 1, 100 - y);
  return { x, y, width, height };
}

function clampBlinkCrop(crop: BlinkCrop): BlinkCrop {
  return clampCropRect(crop);
}

function clampMouthCrop(crop: MouthCrop): MouthCrop {
  return clampCropRect(crop);
}

function useNormalBlink(reaction: Reaction, settings: Settings, manualBlinkSignal: number) {
  const [isBlinking, setIsBlinking] = useState(false);
  const canBlink =
    reaction === "normal" &&
    settings.lifeEnabled &&
    settings.blinkEnabled &&
    Boolean(settings.normalBlinkImage) &&
    isValidBlinkCrop(settings.blinkCrop);

  useEffect(() => {
    if (!canBlink) {
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
  }, [canBlink]);

  useEffect(() => {
    if (!manualBlinkSignal || !canBlink) return;
    setIsBlinking(true);
    const timeout = window.setTimeout(() => setIsBlinking(false), 150);
    return () => window.clearTimeout(timeout);
  }, [canBlink, manualBlinkSignal]);

  return isBlinking;
}

function isValidBlinkCrop(crop: BlinkCrop) {
  return crop.width > 0 && crop.height > 0 && crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 100 && crop.y + crop.height <= 100;
}

function isValidCropRect(crop: CropRect) {
  return crop.width > 0 && crop.height > 0 && crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 100 && crop.y + crop.height <= 100;
}

function isValidMouthCrop(crop: MouthCrop) {
  return isValidCropRect(crop);
}

function getCropClipPath(crop: CropRect) {
  const top = crop.y;
  const right = 100 - crop.x - crop.width;
  const bottom = 100 - crop.y - crop.height;
  const left = crop.x;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

function getBlinkClipPath(crop: BlinkCrop) {
  return getCropClipPath(crop);
}

function getMouthClipPath(crop: MouthCrop) {
  return getCropClipPath(crop);
}

function getMouthOverlaySrc(mouthShape: MouthShape, mouthImages: MouthImages) {
  if (mouthShape === "closed") return undefined;
  if (mouthShape === "wideOpen") return mouthImages.wideOpen ?? mouthImages.smallOpen;
  return mouthImages.smallOpen ?? mouthImages.wideOpen;
}

function getEyeOverlaySrc(direction: EyeDirection, eyeImages: EyeImages) {
  if (direction === "center") return undefined;
  return eyeImages[direction];
}

function getMouthShapeLabel(mouthShape: MouthShape) {
  if (mouthShape === "smallOpen") return "小開き";
  if (mouthShape === "wideOpen") return "大開き";
  return "通常口";
}

function getEyeDirectionLabel(direction: EyeDirection) {
  if (direction === "lookLeft") return "左";
  if (direction === "lookRight") return "右";
  return "中央";
}

function getCameraFollowStatus(settings: Settings, cameraFollow: CameraFollow) {
  if (!settings.lifeEnabled) return "生命感OFF";
  if (!settings.cameraFollowEnabled) return "追従OFF";
  if (!settings.trackingEnabled) return "トラッキングOFF";
  return cameraFollow.visible ? "検出中" : "未検出";
}

function isMouthShape(value: unknown): value is MouthShape {
  return value === "closed" || value === "smallOpen" || value === "wideOpen";
}

function isCameraFollow(value: unknown): value is CameraFollow {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CameraFollow>;
  return typeof item.x === "number" && typeof item.y === "number" && typeof item.visible === "boolean";
}

function getGazeStatus(reaction: Reaction, settings: Settings, direction: EyeDirection) {
  if (reaction !== "normal") return "通常表示ではありません";
  if (!settings.lifeEnabled) return "生命感がOFF";
  if (!settings.gazeEnabled) return "目線差分がOFF";
  if (!isValidBlinkCrop(settings.blinkCrop)) return "目元範囲が無効";
  if (!settings.eyeImages.lookLeft && !settings.eyeImages.lookRight) return "目線差分画像が未登録";
  if (direction === "lookLeft") return "目線左を表示中";
  if (direction === "lookRight") return "目線右を表示中";
  return "自動目線待機中";
}

function getGazeDebug(reaction: Reaction, settings: Settings, direction: EyeDirection): GazeDebug {
  const cropValid = isValidBlinkCrop(settings.blinkCrop);
  const hasLeft = Boolean(settings.eyeImages.lookLeft);
  const hasRight = Boolean(settings.eyeImages.lookRight);
  return {
    direction,
    status: getGazeStatus(reaction, settings, direction),
    canGaze:
      reaction === "normal" &&
      settings.lifeEnabled &&
      settings.gazeEnabled &&
      cropValid &&
      (hasLeft || hasRight),
    hasLeft,
    hasRight,
    cropValid,
  };
}

function useIdleGaze(
  reaction: Reaction,
  settings: Settings,
  manualGazeRequest: { direction: EyeImageSlot; signal: number },
  cameraFollow: CameraFollow,
): EyeDirection {
  const [direction, setDirection] = useState<EyeDirection>("center");
  const canGaze =
    reaction === "normal" &&
    settings.lifeEnabled &&
    settings.gazeEnabled &&
    (Boolean(settings.eyeImages.lookLeft) || Boolean(settings.eyeImages.lookRight));

  useEffect(() => {
    if (!canGaze) {
      setDirection("center");
      return;
    }

    let timeout = 0;
    let cancelled = false;
    const available: EyeImageSlot[] = [];
    if (settings.eyeImages.lookLeft) available.push("lookLeft");
    if (settings.eyeImages.lookRight) available.push("lookRight");

    const schedule = () => {
      timeout = window.setTimeout(() => {
        if (cancelled || !available.length) return;
        const next = available[randomBetween(0, available.length - 1)];
        setDirection(next);
        timeout = window.setTimeout(() => {
          if (cancelled) return;
          setDirection("center");
          schedule();
        }, randomBetween(650, 1800));
      }, randomBetween(4500, 11000));
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [canGaze, settings.eyeImages.lookLeft, settings.eyeImages.lookRight]);

  useEffect(() => {
    if (!manualGazeRequest.signal || !canGaze || !settings.eyeImages[manualGazeRequest.direction]) return;
    setDirection(manualGazeRequest.direction);
    const timeout = window.setTimeout(() => setDirection("center"), 1600);
    return () => window.clearTimeout(timeout);
  }, [canGaze, manualGazeRequest.direction, manualGazeRequest.signal, settings.eyeImages]);

  useEffect(() => {
    if (!canGaze || !settings.cameraFollowEnabled || !cameraFollow.visible) return;
    let timeout = 0;
    if (cameraFollow.x < -0.28 && settings.eyeImages.lookLeft) {
      setDirection("lookLeft");
      timeout = window.setTimeout(() => setDirection("center"), 900);
    } else if (cameraFollow.x > 0.28 && settings.eyeImages.lookRight) {
      setDirection("lookRight");
      timeout = window.setTimeout(() => setDirection("center"), 900);
    }
    return () => window.clearTimeout(timeout);
  }, [
    cameraFollow.visible,
    cameraFollow.x,
    canGaze,
    settings.cameraFollowEnabled,
    settings.eyeImages.lookLeft,
    settings.eyeImages.lookRight,
  ]);

  return direction;
}

function useLifeV2Motion(
  reaction: Reaction,
  settings: Settings,
  mouthShape: MouthShape,
  audioLevel: number,
  cameraFollow: CameraFollow,
): React.CSSProperties {
  const [idleNudge, setIdleNudge] = useState({ x: 0, y: 0, rotate: 0 });
  const enabled = reaction === "normal" && settings.lifeEnabled;

  useEffect(() => {
    if (!enabled || !settings.idleMotionEnabled) {
      setIdleNudge({ x: 0, y: 0, rotate: 0 });
      return;
    }

    let timeout = 0;
    let cancelled = false;
    const schedule = () => {
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        const strength = settings.lifeMotionStrength / 50;
        setIdleNudge({
          x: randomBetween(-2, 2) * strength,
          y: randomBetween(-1, 1) * strength,
          rotate: randomBetween(-12, 12) * 0.04 * strength,
        });
        timeout = window.setTimeout(() => {
          if (cancelled) return;
          setIdleNudge({ x: 0, y: 0, rotate: 0 });
          schedule();
        }, randomBetween(800, 1600));
      }, randomBetween(9000, 18000));
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [enabled, settings.idleMotionEnabled, settings.lifeMotionStrength]);

  if (!enabled) {
    return {};
  }

  const strength = settings.lifeMotionStrength / 50;
  const speaking = settings.speechMotionEnabled && mouthShape !== "closed";
  const mouthBoost = mouthShape === "wideOpen" ? 1 : mouthShape === "smallOpen" ? 0.62 : 0;
  const audioBoost = clamp(audioLevel / 60, 0, 1);
  const speechAmount = speaking ? (0.45 + mouthBoost * 0.35 + audioBoost * 0.2) * strength : 0;
  const followAmount = settings.cameraFollowEnabled && cameraFollow.visible ? settings.cameraFollowStrength / 50 : 0;
  const followX = clamp(cameraFollow.x, -1, 1) * followAmount;
  const followY = clamp(cameraFollow.y, -1, 1) * followAmount;

  return {
    ["--life-v2-x" as string]: `${idleNudge.x + followX * 7}px`,
    ["--life-v2-y" as string]: `${idleNudge.y + followY * 3}px`,
    ["--life-v2-rotate" as string]: `${idleNudge.rotate - followX * 1.6}deg`,
    ["--speech-motion-scale" as string]: 1 + speechAmount * 0.006,
    ["--speech-motion-y" as string]: `${speechAmount * -2.2}px`,
    ["--speech-motion-rotate" as string]: `${speechAmount * 0.24}deg`,
    ["--speech-motion-duration" as string]: `${Math.round(620 - speechAmount * 160)}ms`,
  } as React.CSSProperties;
}

function CanvasRecordPanel({
  settings,
  reaction,
  mouthShape,
  visualState,
}: {
  settings: Settings;
  reaction: Reaction;
  mouthShape: MouthShape;
  visualState: AvatarVisualState;
}) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [message, setMessage] = useState("録画を開始すると、表示中のキャラをWebMで保存します。");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [filename, setFilename] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const animationFrameRef = useRef(0);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const imageCacheRef = useRef<CanvasImageCache>(new Map());
  const recordingActiveRef = useRef(false);
  const settingsRef = useRef(settings);
  const reactionRef = useRef(reaction);
  const mouthShapeRef = useRef(mouthShape);
  const visualStateRef = useRef(visualState);
  const downloadUrlRef = useRef("");

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    reactionRef.current = reaction;
  }, [reaction]);

  useEffect(() => {
    mouthShapeRef.current = mouthShape;
  }, [mouthShape]);

  useEffect(() => {
    visualStateRef.current = visualState;
  }, [visualState]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    return () => {
      recordingActiveRef.current = false;
      window.cancelAnimationFrame(animationFrameRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!("MediaRecorder" in window)) {
      setRecordingState("error");
      setMessage("このブラウザはMediaRecorder録画に対応していません。Chrome/Safariの最新版で試してください。");
      return;
    }

    if (!HTMLCanvasElement.prototype.captureStream) {
      setRecordingState("error");
      setMessage("このブラウザはCanvas録画に対応していません。Chrome/Safariの最新版で試してください。");
      return;
    }

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      setDownloadUrl("");
      downloadUrlRef.current = "";
    }

    const size = getRecordingSize(settingsRef.current.canvasAspectRatio);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      setRecordingState("error");
      setMessage("録画用Canvasを準備できませんでした。");
      return;
    }

    chunksRef.current = [];
    let mediaStream = canvas.captureStream(30);
    let audioNotice = "";
    recordingActiveRef.current = true;

    if (settingsRef.current.audioInputEnabled) {
      try {
        const audioConstraints: MediaTrackConstraints | boolean = settingsRef.current.selectedAudioDeviceId
          ? { deviceId: { exact: settingsRef.current.selectedAudioDeviceId } }
          : true;
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        audioStreamRef.current = audioStream;
        audioStream.getAudioTracks().forEach((track) => mediaStream.addTrack(track));
      } catch {
        audioNotice = " マイク音声は取得できなかったため、映像のみで録画します。";
      }
    }

    const drawLoop = () => {
      if (!recordingActiveRef.current) return;
      void drawRecordingFrame(
        context,
        settingsRef.current,
        reactionRef.current,
        mouthShapeRef.current,
        visualStateRef.current,
        imageCacheRef.current,
        getRecordingFrameMetrics(canvas),
      ).finally(() => {
        if (recordingActiveRef.current) animationFrameRef.current = window.requestAnimationFrame(drawLoop);
      });
    };
    drawLoop();

    try {
      const mimeType = getSupportedRecordingMimeType();
      const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      const nextFilename = getRecordingFilename();
      setFilename(nextFilename);
      setRecordingState("recording");
      setMessage(`録画中です。停止すると ${nextFilename} を保存できます。${audioNotice}`);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setRecordingState("error");
        setMessage("録画中にエラーが起きました。短めの録画で再試行してください。");
      };

      recorder.onstop = () => {
        recordingActiveRef.current = false;
        window.cancelAnimationFrame(animationFrameRef.current);
        audioStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = new MediaStream();

        if (!chunksRef.current.length) {
          setRecordingState("error");
          setMessage("録画データを作成できませんでした。もう一度試してください。");
          return;
        }

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;
        setDownloadUrl(url);
        setRecordingState("ready");
        setMessage("録画が完了しました。ダウンロードして確認できます。");
      };

      recorder.start(1000);
    } catch {
      recordingActiveRef.current = false;
      window.cancelAnimationFrame(animationFrameRef.current);
      mediaStream.getTracks().forEach((track) => track.stop());
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      setRecordingState("error");
      setMessage("録画を開始できませんでした。ブラウザの録画権限や対応形式を確認してください。");
    }
  }, []);

  const size = getRecordingSize(settings.canvasAspectRatio);

  return (
    <aside className={`recordPanel ${recordingState}`} aria-label="recording controls">
      <div>
        <strong>{recordingState === "recording" ? "録画中" : recordingState === "ready" ? "録画完了" : "Canvas録画実験"}</strong>
        <span>
          {size.width}x{size.height} / WebM
        </span>
      </div>
      <p>{message}</p>
      <div className="recordActions">
        <button type="button" onClick={() => void startRecording()} disabled={recordingState === "recording"}>
          録画開始
        </button>
        <button type="button" onClick={stopRecording} disabled={recordingState !== "recording"}>
          停止
        </button>
        {downloadUrl && (
          <a className="avatarLink" href={downloadUrl} download={filename}>
            ダウンロード
          </a>
        )}
      </div>
    </aside>
  );
}

function AvatarStage({
  audioLevel,
  cameraFollow,
  manualGazeRequest,
  manualBlinkSignal,
  mouthShape,
  onGazeDebug,
  onVisualState,
  reaction,
  route,
  settings,
  perfOptions,
}: {
  audioLevel: number;
  cameraFollow: CameraFollow;
  manualGazeRequest: { direction: EyeImageSlot; signal: number };
  manualBlinkSignal: number;
  mouthShape: MouthShape;
  onGazeDebug: (debug: GazeDebug) => void;
  onVisualState: (state: AvatarVisualState) => void;
  reaction: Reaction;
  route: AppRoute;
  settings: Settings;
  perfOptions: PerfOptions;
}) {
  const isBlinking = useNormalBlink(reaction, settings, manualBlinkSignal);
  const eyeDirection = useIdleGaze(reaction, settings, manualGazeRequest, cameraFollow);
  const [reactionStartedAt, setReactionStartedAt] = useState(() => performance.now());
  const lifeMotionStyle = useLifeV2Motion(reaction, settings, mouthShape, audioLevel, cameraFollow);
  const image = settings.images[reaction];
  const showBlinkOverlay =
    !perfOptions.noOverlays && reaction === "normal" && isBlinking && Boolean(settings.normalBlinkImage) && isValidBlinkCrop(settings.blinkCrop);
  const showBlinkGuide =
    route === "settings" &&
    reaction === "normal" &&
    settings.adjustmentGuidesEnabled &&
    settings.blinkEnabled &&
    Boolean(settings.normalBlinkImage);
  const eyeOverlaySrc = reaction === "normal" && !isBlinking && settings.gazeEnabled ? getEyeOverlaySrc(eyeDirection, settings.eyeImages) : undefined;
  const showEyeOverlay = !perfOptions.noOverlays && Boolean(eyeOverlaySrc) && isValidBlinkCrop(settings.blinkCrop);
  const mouthOverlaySrc = reaction === "normal" ? getMouthOverlaySrc(mouthShape, settings.mouthImages) : undefined;
  const showMouthOverlay =
    reaction === "normal" &&
    !perfOptions.noOverlays &&
    settings.lipSyncEnabled &&
    mouthShape !== "closed" &&
    Boolean(mouthOverlaySrc) &&
    isValidMouthCrop(settings.mouthCrop);
  const showMouthGuide = route === "settings" && reaction === "normal" && settings.adjustmentGuidesEnabled && settings.lipSyncEnabled;
  const label = reactions.find((item) => item.key === reaction)?.label ?? reaction;
  const useAvatarLayout = route !== "settings";
  const size = useAvatarLayout ? settings.avatarSize : settings.size;
  const x = useAvatarLayout ? settings.avatarX : settings.x;
  const y = useAvatarLayout ? settings.avatarY : settings.y;
  const staticImage = publicAssetUrl(`reactions/${reaction}.png`);
  const frameBackground = perfOptions.noBackground ? "#090d14" : getFrameBackground(settings);
  const aspectRatioValue = getAspectRatioValue(settings.canvasAspectRatio);

  useEffect(() => {
    onGazeDebug(getGazeDebug(reaction, settings, eyeDirection));
  }, [
    eyeDirection,
    onGazeDebug,
    reaction,
    settings.blinkCrop,
    settings.eyeImages.lookLeft,
    settings.eyeImages.lookRight,
    settings.gazeEnabled,
    settings.lifeEnabled,
  ]);

  useEffect(() => {
    setReactionStartedAt(performance.now());
  }, [reaction]);

  useEffect(() => {
    onVisualState({ isBlinking, eyeDirection, reactionStartedAt });
  }, [eyeDirection, isBlinking, onVisualState, reactionStartedAt]);

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
            <ReactionEffects disabled={perfOptions.noEffects} reaction={reaction} />
            <div className="avatarLifeLayer" style={lifeMotionStyle}>
              <div className={`avatarTalkLayer${reaction === "normal" && settings.lifeEnabled && settings.speechMotionEnabled && mouthShape !== "closed" ? " speaking" : ""}`}>
                <AvatarImage
                  alt={label}
                  blinkCrop={settings.blinkCrop}
                  blinkOverlaySrc={reaction === "normal" ? settings.normalBlinkImage : undefined}
                  eyeOverlaySrc={eyeOverlaySrc}
                  mouthCrop={settings.mouthCrop}
                  mouthOverlaySrc={mouthOverlaySrc}
                  outlineQuality={settings.outlineQuality ?? "standard"}
                  outlineWidth={settings.outlineEnabled ? `${settings.outlineWidth}px` : "0px"}
                  primarySrc={image}
                  reaction={reaction}
                  showBlinkGuide={showBlinkGuide}
                  showBlinkOverlay={showBlinkOverlay}
                  showEyeOverlay={showEyeOverlay}
                  showMouthGuide={showMouthGuide}
                  showMouthOverlay={showMouthOverlay}
                  staticSrc={staticImage}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AvatarImage({
  alt,
  blinkCrop,
  blinkOverlaySrc,
  eyeOverlaySrc,
  mouthCrop,
  mouthOverlaySrc,
  outlineQuality,
  outlineWidth,
  primarySrc,
  reaction,
  showBlinkGuide,
  showBlinkOverlay,
  showEyeOverlay,
  showMouthGuide,
  showMouthOverlay,
  staticSrc,
}: {
  alt: string;
  blinkCrop: BlinkCrop;
  blinkOverlaySrc: string | undefined;
  eyeOverlaySrc: string | undefined;
  mouthCrop: MouthCrop;
  mouthOverlaySrc: string | undefined;
  outlineQuality: OutlineQuality;
  outlineWidth: string;
  primarySrc: string | undefined;
  reaction: Reaction;
  showBlinkGuide: boolean;
  showBlinkOverlay: boolean;
  showEyeOverlay: boolean;
  showMouthGuide: boolean;
  showMouthOverlay: boolean;
  staticSrc: string;
}) {
  const [failedSrc, setFailedSrc] = useState("");
  const src = primarySrc ?? staticSrc;
  const blinkClipPath = getBlinkClipPath(blinkCrop);
  const mouthClipPath = getMouthClipPath(mouthCrop);

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
    <div className="avatarImageWrap">
      <img
        className={`avatarImage outline-${outlineQuality}`}
        src={src}
        alt={alt}
        draggable={false}
        onError={() => setFailedSrc(src)}
        style={{
          ["--outline-width" as string]: outlineWidth,
        }}
      />
      {blinkOverlaySrc && (
        <img
          className={`blinkOverlayImage${showBlinkOverlay ? " visible" : ""}`}
          src={blinkOverlaySrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ clipPath: blinkClipPath }}
        />
      )}
      {eyeOverlaySrc && (
        <img
          className={`eyeOverlayImage${showEyeOverlay ? " visible" : ""}`}
          src={eyeOverlaySrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ clipPath: blinkClipPath }}
        />
      )}
      {mouthOverlaySrc && (
        <img
          className={`mouthOverlayImage${showMouthOverlay ? " visible" : ""}`}
          src={mouthOverlaySrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ clipPath: mouthClipPath }}
        />
      )}
      {showBlinkGuide && (
        <span
          className="blinkCropGuide"
          aria-hidden="true"
          style={{
            left: `${blinkCrop.x}%`,
            top: `${blinkCrop.y}%`,
            width: `${blinkCrop.width}%`,
            height: `${blinkCrop.height}%`,
          }}
        />
      )}
      {showMouthGuide && (
        <span
          className="mouthCropGuide"
          aria-hidden="true"
          style={{
            left: `${mouthCrop.x}%`,
            top: `${mouthCrop.y}%`,
            width: `${mouthCrop.width}%`,
            height: `${mouthCrop.height}%`,
          }}
        />
      )}
    </div>
  );
}

function ReactionEffects({ disabled, reaction }: { disabled: boolean; reaction: Reaction }) {
  if (disabled) return null;

  if (reaction === "joy") {
    return (
      <div className="effectLayer joyFx" aria-hidden="true">
        <img className="effectAsset joyAsset" src={publicAssetUrl("effects/joy-sparkle-field.svg")} alt="" draggable={false} />
        <span className="jumpShadow" />
        <i />
        <i />
      </div>
    );
  }

  if (reaction === "surprised") {
    return (
      <div className="effectLayer surprisedFx" aria-hidden="true">
        <img
          className="effectAsset surprisedAsset"
          src={publicAssetUrl("effects/surprised-shockwave.svg")}
          alt=""
          draggable={false}
        />
      </div>
    );
  }

  if (reaction === "troubled") {
    return <div className="effectLayer troubledFx" aria-hidden="true" />;
  }

  if (reaction === "explain") {
    return (
      <div className="effectLayer explainFx" aria-hidden="true">
        <img
          className="effectAsset explainAsset"
          src={publicAssetUrl("effects/explain-pointer-light.svg")}
          alt=""
          draggable={false}
        />
        <span className="explainGlow" />
        <span className="pointerBeam" />
      </div>
    );
  }

  return null;
}

function usePerfMetrics(enabled: boolean): PerfMetrics {
  const [metrics, setMetrics] = useState<PerfMetrics>({
    avgFrameMs: 0,
    fps: 0,
    longFrames: 0,
    worstFrameMs: 0,
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let bucketStartedAt = lastFrameAt;
    let frames = 0;
    let totalFrameMs = 0;
    let longFrames = 0;
    let worstFrameMs = 0;

    const tick = (now: number) => {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;
      frames += 1;
      totalFrameMs += frameMs;
      if (frameMs > 50) longFrames += 1;
      worstFrameMs = Math.max(worstFrameMs, frameMs);

      if (now - bucketStartedAt >= 1000) {
        const elapsedSeconds = (now - bucketStartedAt) / 1000;
        setMetrics({
          avgFrameMs: totalFrameMs / Math.max(1, frames),
          fps: frames / Math.max(0.001, elapsedSeconds),
          longFrames,
          worstFrameMs,
        });
        bucketStartedAt = now;
        frames = 0;
        totalFrameMs = 0;
        longFrames = 0;
        worstFrameMs = 0;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [enabled]);

  return metrics;
}

function getRuntimeLabel() {
  const ua = navigator.userAgent;
  if (ua.includes("ReactionStandeeWKPreview")) return "WKWebView";
  if (ua.includes("Electron")) return "Electron";
  if (ua.includes("Chrome") || ua.includes("Chromium") || ua.includes("CriOS")) return "Chrome/Chromium";
  if (ua.includes("Safari")) return "Safari";
  return "Browser";
}

function PerfOverlay({ debug, options, route }: { debug: TrackingDebug; options: PerfOptions; route: AppRoute }) {
  const metrics = usePerfMetrics(options.enabled);
  const flags = [
    options.cameraPreset === "low" ? "camera=low" : "",
    options.maxInferenceFps ? `inferFps=${options.maxInferenceFps}` : "",
    options.noBackground ? "noBg" : "",
    options.noEffects ? "noEffects" : "",
    options.noMotion ? "noMotion" : "",
    options.noOutline ? "noOutline" : "",
    options.noOverlays ? "noOverlays" : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <aside className="perfOverlay" aria-label="performance diagnostics">
      <strong>Perf</strong>
      <span>{getRuntimeLabel()}</span>
      <span>route: {route}</span>
      <span>fps: {metrics.fps.toFixed(1)}</span>
      <span>avg: {metrics.avgFrameMs.toFixed(1)}ms</span>
      <span>worst: {metrics.worstFrameMs.toFixed(1)}ms</span>
      <span>long: {metrics.longFrames}</span>
      <span>infer: {(debug.inferenceFps ?? 0).toFixed(1)}fps / {(debug.inferenceMs ?? 0).toFixed(1)}ms</span>
      {debug.videoWidth && debug.videoHeight ? <span>cam: {debug.videoWidth}x{debug.videoHeight}</span> : null}
      {flags && <small>{flags}</small>}
    </aside>
  );
}

type SettingsPanelProps = {
  settings: Settings;
  reaction: Reaction;
  debug: TrackingDebug;
  gazeDebug: GazeDebug;
  cameraFollow: CameraFollow;
  audioDebug: AudioDebug;
  devices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  cameraError: string;
  audioError: string;
  onChange: (patch: Partial<Settings>) => void;
  onCalibrateAudio: () => void;
  onManualBlink: () => void;
  onManualGaze: (direction: EyeImageSlot) => void;
  onManualMouth: (mouthShape: MouthShape) => void;
  onManualReaction: (reaction: Reaction) => void;
  onNavigate: (route: AppRoute) => void;
};

function SettingsPanel({
  settings,
  reaction,
  debug,
  gazeDebug,
  cameraFollow,
  audioDebug,
  devices,
  audioDevices,
  cameraError,
  audioError,
  onChange,
  onCalibrateAudio,
  onManualBlink,
  onManualGaze,
  onManualMouth,
  onManualReaction,
  onNavigate,
}: SettingsPanelProps) {
  const [imageMessage, setImageMessage] = useState("");
  const lifeMode = getLifeMode(settings);
  const updateBlinkCrop = (patch: Partial<BlinkCrop>) => {
    onChange({ blinkCrop: clampBlinkCrop({ ...settings.blinkCrop, ...patch }) });
  };
  const updateMouthCrop = (patch: Partial<MouthCrop>) => {
    onChange({ mouthCrop: clampMouthCrop({ ...settings.mouthCrop, ...patch }) });
  };

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
          eyeImages: {},
          mouthImages: {},
        });
        setImageMessage("登録画像をクリアしました。");
      })
      .catch((error) => {
        setImageMessage("画像のクリアに失敗しました。");
        console.error(error);
        console.error("Reaction images could not be cleared.");
      });
  };

  const handleExportBackup = () => {
    setImageMessage("設定と画像を書き出しています...");
    void exportAppBackup(settings)
      .then(() => {
        setImageMessage("設定と画像を書き出しました。");
      })
      .catch((error) => {
        setImageMessage("設定データの書き出しに失敗しました。");
        console.error(error);
      });
  };

  const handleImportBackup = (file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を読み込んでいます...`);
    void importAppBackup(file)
      .then(() => {
        setImageMessage("設定と画像を読み込みました。画面を更新します。");
        window.location.reload();
      })
      .catch((error) => {
        setImageMessage(error instanceof Error ? error.message : "設定データの読み込みに失敗しました。");
        console.error(error);
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

  const handleEyeUpload = (slot: EyeImageSlot, file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を${eyeImageSlots.find((item) => item.key === slot)?.label ?? "目線差分"}として読み込み中...`);
    void readFileAsDataUrl(file)
      .then((dataUrl) => {
        onChange({
          eyeImages: {
            ...settings.eyeImages,
            [slot]: dataUrl,
          },
          gazeEnabled: true,
        });
        return saveEyeImage(slot, dataUrl).then(() => {
          setImageMessage(`${file.name} を目線差分として登録しました。`);
        });
      })
      .catch((error) => {
        setImageMessage("目線差分の登録に失敗しました。容量が大きすぎる可能性があります。");
        console.error(error);
        console.error(`${slot} eye image could not be saved.`);
      });
  };

  const handleDeleteEye = (slot: EyeImageSlot) => {
    void deleteEyeImage(slot)
      .then(() => {
        const nextEyeImages = { ...settings.eyeImages };
        delete nextEyeImages[slot];
        onChange({ eyeImages: nextEyeImages });
        setImageMessage(`${eyeImageSlots.find((item) => item.key === slot)?.label ?? "目線差分"}を削除しました。`);
      })
      .catch((error) => {
        setImageMessage("目線差分の削除に失敗しました。");
        console.error(error);
        console.error(`${slot} eye image could not be deleted.`);
      });
  };

  const handleMouthUpload = (slot: MouthImageSlot, file: File | undefined) => {
    if (!file) return;
    setImageMessage(`${file.name} を${mouthImageSlots.find((item) => item.key === slot)?.label ?? "口パク画像"}として読み込み中...`);
    void readFileAsDataUrl(file)
      .then((dataUrl) => {
        onChange({
          mouthImages: {
            ...settings.mouthImages,
            [slot]: dataUrl,
          },
          lipSyncEnabled: true,
        });
        return saveMouthImage(slot, dataUrl).then(() => {
          setImageMessage(`${file.name} を口パク画像として登録しました。`);
        });
      })
      .catch((error) => {
        setImageMessage("口パク画像の登録に失敗しました。容量が大きすぎる可能性があります。");
        console.error(error);
        console.error(`${slot} mouth image could not be saved.`);
      });
  };

  const handleDeleteMouth = (slot: MouthImageSlot) => {
    void deleteMouthImage(slot)
      .then(() => {
        const nextMouthImages = { ...settings.mouthImages };
        delete nextMouthImages[slot];
        onChange({ mouthImages: nextMouthImages });
        setImageMessage(`${mouthImageSlots.find((item) => item.key === slot)?.label ?? "口パク画像"}を削除しました。`);
      })
      .catch((error) => {
        setImageMessage("口パク画像の削除に失敗しました。");
        console.error(error);
        console.error(`${slot} mouth image could not be deleted.`);
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
          <a
            className="avatarLink"
            href={getAppRouteHref("record")}
            target={pwaEnabled ? undefined : "_blank"}
            rel="noreferrer"
            onClick={
              pwaEnabled
                ? (event) => {
                    event.preventDefault();
                    onNavigate("record");
                  }
                : undefined
            }
          >
            録画表示
          </a>
          {localApiEnabled && (
            <a className="avatarLink" href={getAppRouteHref("canvas")} target="_blank" rel="noreferrer">
              Canvas実験
            </a>
          )}
        </div>
      </header>

      {localApiEnabled && (
        <section className="desktopLaunchNote" aria-label="WKWebView録画ウィンドウ起動">
          <div>
            <strong>WKWebView録画ウィンドウ実験</strong>
            <p>Safariに近いWebKit環境で、ツールバーなしの録画用ウィンドウを起動します。計測は npm run wk:record:perf です。</p>
          </div>
          <code>npm run wk:record</code>
        </section>
      )}

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
        <div className="fileActions backupActions">
          <button type="button" onClick={handleExportBackup}>
            設定一式を書き出す
          </button>
          <label className="filePicker">
            設定一式を読み込む
            <input
              type="file"
              accept="application/json,.json"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => {
                handleImportBackup(event.target.files?.[0]);
              }}
            />
          </label>
        </div>
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
        <div className="segmentedControl" aria-label="動きの強さ">
          {lifeModeOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={lifeMode === item.key ? "active" : ""}
              onClick={() => onChange(getLifeModePatch(item.key))}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="hint">通常表示中のまばたき、呼吸、発話ゆらぎ、目線、カメラ反応をまとめて調整します。</p>

        <h3 className="sectionSubhead">基本</h3>
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
        <label className="switchRow">
          <span>口パク連動ゆらぎ</span>
          <input
            type="checkbox"
            checked={settings.speechMotionEnabled}
            onChange={(event) => onChange({ speechMotionEnabled: event.target.checked })}
          />
        </label>
        <Range
          label="動きの量"
          min={0}
          max={100}
          step={5}
          value={settings.lifeMotionStrength}
          onChange={(lifeMotionStrength) => onChange({ lifeMotionStrength, lifeEnabled: lifeMotionStrength > 0 })}
        />

        <h3 className="sectionSubhead">反応</h3>
        <label className="switchRow">
          <span>待機ランダム</span>
          <input
            type="checkbox"
            checked={settings.idleMotionEnabled}
            onChange={(event) => onChange({ idleMotionEnabled: event.target.checked })}
          />
        </label>
        <label className="switchRow">
          <span>目線差分</span>
          <input
            type="checkbox"
            checked={settings.gazeEnabled}
            onChange={(event) => onChange({ gazeEnabled: event.target.checked })}
          />
        </label>
        <label className="switchRow">
          <span>カメラ追従</span>
          <input
            type="checkbox"
            checked={settings.cameraFollowEnabled}
            onChange={(event) => onChange({ cameraFollowEnabled: event.target.checked })}
          />
        </label>
        <Range
          label="カメラ追従強度"
          min={0}
          max={100}
          step={5}
          value={settings.cameraFollowStrength}
          onChange={(cameraFollowStrength) => onChange({ cameraFollowStrength })}
        />

        <h3 className="sectionSubhead">調整表示</h3>
        <label className="switchRow">
          <span>位置調整枠</span>
          <input
            type="checkbox"
            checked={settings.adjustmentGuidesEnabled}
            onChange={(event) => onChange({ adjustmentGuidesEnabled: event.target.checked })}
          />
        </label>

        <h3 className="sectionSubhead">差分画像</h3>
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
        <div className="imageGrid">
          {eyeImageSlots.map((item) => (
            <div key={item.key} className="fileSlot">
              <span>
                {item.label}
                <small>{item.file}</small>
                <small className={settings.eyeImages[item.key] ? "savedBadge" : "emptyBadge"}>
                  {settings.eyeImages[item.key] ? "登録済み" : "未登録"}
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
                      handleEyeUpload(item.key, event.target.files?.[0]);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="deleteImageButton"
                  disabled={!settings.eyeImages[item.key]}
                  onClick={() => handleDeleteEye(item.key)}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
        <h3 className="sectionSubhead">範囲調整</h3>
        <div className="rangeGroup">
          <p className="hint">黄色い枠を通常画像の目元に合わせてください。</p>
          <Range
            label="目元 X"
            min={0}
            max={98}
            step={1}
            value={settings.blinkCrop.x}
            onChange={(x) => updateBlinkCrop({ x })}
          />
          <Range
            label="目元 Y"
            min={0}
            max={98}
            step={1}
            value={settings.blinkCrop.y}
            onChange={(y) => updateBlinkCrop({ y })}
          />
          <Range
            label="目元 幅"
            min={1}
            max={100}
            step={1}
            value={settings.blinkCrop.width}
            onChange={(width) => updateBlinkCrop({ width })}
          />
          <Range
            label="目元 高さ"
            min={1}
            max={100}
            step={1}
            value={settings.blinkCrop.height}
            onChange={(height) => updateBlinkCrop({ height })}
          />
        </div>
        <p className="hint">まばたきは通常表示中だけ有効です。未登録の場合は自動で何もしません。</p>
      </section>

      <section className="section">
        <h2>口パク</h2>
        <label className="switchRow">
          <span>口パク</span>
          <input
            type="checkbox"
            checked={settings.lipSyncEnabled}
            onChange={(event) => onChange({ lipSyncEnabled: event.target.checked })}
          />
        </label>
        <label className="switchRow">
          <span>マイク音声で動かす</span>
          <input
            type="checkbox"
            checked={settings.audioInputEnabled}
            onChange={(event) => onChange({ audioInputEnabled: event.target.checked })}
          />
        </label>
        <label>
          マイク
          <select
            value={settings.selectedAudioDeviceId}
            onChange={(event) => onChange({ selectedAudioDeviceId: event.target.value })}
          >
            <option value="">既定のマイク</option>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `マイク ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <Range
          label="発話しきい値"
          min={1}
          max={100}
          step={1}
          value={settings.mouthThreshold}
          onChange={(mouthThreshold) => onChange({ mouthThreshold })}
        />
        <div className="statusGrid">
          <Status label="音量" value={audioDebug.volume.toFixed(1)} />
          <Status label="差分" value={audioDebug.speechLevel.toFixed(1)} />
          <Status label="口形" value={getMouthShapeLabel(audioDebug.mouthShape)} />
        </div>
        <p className="hint">{audioDebug.status}</p>
        {audioError && <p className="error">{audioError}</p>}
        <button type="button" onClick={onCalibrateAudio} disabled={!settings.lipSyncEnabled || !settings.audioInputEnabled}>
          環境音を再測定
        </button>
        <p className="hint">通常表示中だけ、登録した口元差分を音量に合わせて重ねます。マイク連動には「口パク」と「マイク音声で動かす」の両方をONにしてください。</p>
        <div className="imageGrid">
          {mouthImageSlots.map((item) => (
            <div key={item.key} className="fileSlot">
              <span>
                {item.label}
                <small>{item.file}</small>
                <small className={settings.mouthImages[item.key] ? "savedBadge" : "emptyBadge"}>
                  {settings.mouthImages[item.key] ? "登録済み" : "未登録"}
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
                      handleMouthUpload(item.key, event.target.files?.[0]);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="deleteImageButton"
                  disabled={!settings.mouthImages[item.key]}
                  onClick={() => handleDeleteMouth(item.key)}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="rangeGroup">
          <p className="hint">オレンジ枠を通常画像の口元に合わせてください。通常口は normal.png をそのまま使います。</p>
          <Range
            label="口元 X"
            min={0}
            max={98}
            step={1}
            value={settings.mouthCrop.x}
            onChange={(x) => updateMouthCrop({ x })}
          />
          <Range
            label="口元 Y"
            min={0}
            max={98}
            step={1}
            value={settings.mouthCrop.y}
            onChange={(y) => updateMouthCrop({ y })}
          />
          <Range
            label="口元 幅"
            min={1}
            max={100}
            step={1}
            value={settings.mouthCrop.width}
            onChange={(width) => updateMouthCrop({ width })}
          />
          <Range
            label="口元 高さ"
            min={1}
            max={100}
            step={1}
            value={settings.mouthCrop.height}
            onChange={(height) => updateMouthCrop({ height })}
          />
        </div>
      </section>

      <section className="section">
        <h2>表示</h2>
        <p className="hint">設定画面プレビュー</p>
        <Range label="サイズ" min={180} max={1300} step={10} value={settings.size} onChange={(size) => onChange({ size })} />
        <Range label="位置 X" min={-900} max={900} step={5} value={settings.x} onChange={(x) => onChange({ x })} />
        <Range label="位置 Y" min={-520} max={520} step={5} value={settings.y} onChange={(y) => onChange({ y })} />
        <p className="hint">録画表示（/record・Dockアプリ・WKWebView）</p>
        <Range
          label="録画表示サイズ"
          min={180}
          max={1300}
          step={10}
          value={settings.avatarSize}
          onChange={(avatarSize) => onChange({ avatarSize })}
        />
        <Range
          label="録画表示位置 X"
          min={-900}
          max={900}
          step={5}
          value={settings.avatarX}
          onChange={(avatarX) => onChange({ avatarX })}
        />
        <Range
          label="録画表示位置 Y"
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
        <label>
          白フチ品質
          <select
            value={settings.outlineQuality ?? "standard"}
            onChange={(event) => onChange({ outlineQuality: event.target.value as OutlineQuality })}
            disabled={!settings.outlineEnabled}
          >
            <option value="light">軽量</option>
            <option value="standard">標準</option>
          </select>
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
        <div className="statusGrid">
          <Status label="目線" value={getEyeDirectionLabel(gazeDebug.direction)} />
          <Status label="目線状態" value={gazeDebug.status} />
          <Status label="目線左" value={gazeDebug.hasLeft ? "登録済み" : "未登録"} />
          <Status label="目線右" value={gazeDebug.hasRight ? "登録済み" : "未登録"} />
          <Status label="目元範囲" value={gazeDebug.cropValid ? "有効" : "無効"} />
          <Status label="顔追従" value={getCameraFollowStatus(settings, cameraFollow)} />
          <Status label="追従X" value={cameraFollow.visible ? cameraFollow.x.toFixed(2) : "-"} />
          <Status label="追従Y" value={cameraFollow.visible ? cameraFollow.y.toFixed(2) : "-"} />
          <Status label="追従強度" value={`${settings.cameraFollowStrength}`} />
        </div>
        <div className="reactionButtons">
          {reactions.map((item) => (
            <button key={item.key} type="button" onClick={() => onManualReaction(item.key)}>
              {item.label}
            </button>
          ))}
          <button
            type="button"
            disabled={reaction !== "normal" || !settings.normalBlinkImage || !isValidBlinkCrop(settings.blinkCrop)}
            onClick={onManualBlink}
          >
            目閉じ
          </button>
          <button
            type="button"
            disabled={
              reaction !== "normal" ||
              !settings.lifeEnabled ||
              !settings.gazeEnabled ||
              !settings.eyeImages.lookLeft ||
              !isValidBlinkCrop(settings.blinkCrop)
            }
            onClick={() => onManualGaze("lookLeft")}
          >
            目線左
          </button>
          <button
            type="button"
            disabled={
              reaction !== "normal" ||
              !settings.lifeEnabled ||
              !settings.gazeEnabled ||
              !settings.eyeImages.lookRight ||
              !isValidBlinkCrop(settings.blinkCrop)
            }
            onClick={() => onManualGaze("lookRight")}
          >
            目線右
          </button>
          <button
            type="button"
            disabled={reaction !== "normal" || !settings.lipSyncEnabled || !getMouthOverlaySrc("smallOpen", settings.mouthImages)}
            onClick={() => onManualMouth("smallOpen")}
          >
            小開き口
          </button>
          <button
            type="button"
            disabled={reaction !== "normal" || !settings.lipSyncEnabled || !getMouthOverlaySrc("wideOpen", settings.mouthImages)}
            onClick={() => onManualMouth("wideOpen")}
          >
            大開き口
          </button>
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

if (pwaEnabled && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(publicAssetUrl("sw.js"), { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
