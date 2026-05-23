import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { acquireSharedCamera, releaseSharedCamera } from "./camera.js";

const POSE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const JUMP_WARMUP_MS = 4000;

const LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24
};

export function createJumpDetector({ onStatus, onDebug, onTrack, onJump }) {
  return new JumpDetector(onStatus, onDebug, onTrack, onJump);
}

class JumpDetector {
  constructor(onStatus, onDebug, onTrack, onJump) {
    this.onStatus = onStatus;
    this.onDebug = onDebug;
    this.onTrack = onTrack;
    this.onJump = onJump;
    this.poseLandmarker = null;
    this.video = null;
    this.canvas = null;
    this.statusElement = null;
    this.debugElement = null;
    this.stream = null;
    this.running = false;
    this.paused = false;
    this.animationFrame = 0;
    this.lastVideoTime = -1;
    this.latestStatus = "摄像头准备中...";
    this.latestDebug = "";
    this.latestLandmarks = [];
    this.state = createDetectorState();
    this.cameraOwner = `jump-${Math.random().toString(36).slice(2)}`;
  }

  attach({ video, canvas, statusElement, debugElement }) {
    this.video = video;
    this.canvas = canvas;
    this.statusElement = statusElement;
    this.debugElement = debugElement;
    this.syncMountedMedia();
    this.renderStatus(this.latestStatus);
    this.renderDebug(this.latestDebug);
  }

  async start() {
    if (this.running) {
      this.syncMountedMedia();
      return;
    }

    try {
      this.renderStatus("正在打开摄像头...");
      await this.ensureLandmarker();
      await this.ensureCamera();
      this.running = true;
      this.state.warmupUntil = performance.now() + JUMP_WARMUP_MS;
      this.lastVideoTime = -1;
      this.loop();
      this.renderStatus("摄像头刚打开，先稳定 4 秒，再开始跳跃识别。");
    } catch (error) {
      this.renderStatus(error?.message || "摄像头没有启动成功。");
    }
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.lastVideoTime = -1;
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    if (this.stream) {
      releaseSharedCamera(this.cameraOwner);
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.clearCanvas();
    this.state = createDetectorState();
    this.renderDebug("");
  }

  setPaused(value) {
    this.paused = value;
    if (value) {
      this.renderStatus("闪卡打开了，等会儿再继续跳。");
      return;
    }
    if (this.running) this.renderStatus("继续左右移动，再跳一下。");
  }

  async restart() {
    this.stop();
    await this.start();
  }

  async ensureLandmarker() {
    if (this.poseLandmarker) return this.poseLandmarker;
    const vision = await FilesetResolver.forVisionTasks(POSE_WASM_URL);
    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35
    });
    return this.poseLandmarker;
  }

  async ensureCamera() {
    if (this.stream) {
      this.syncMountedMedia();
      return;
    }

    const stream = await acquireSharedCamera(this.cameraOwner);
    this.stream = stream;
    this.syncMountedMedia();
    if (!this.video) return;
    await this.video.play();
    this.resizeCanvas();
  }

  syncMountedMedia() {
    if (this.video && this.stream && this.video.srcObject !== this.stream) {
      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.play().catch(() => {});
    }
    this.resizeCanvas();
  }

  resizeCanvas() {
    if (!this.video || !this.canvas) return;
    const width = this.video.videoWidth || 640;
    const height = this.video.videoHeight || 360;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  loop() {
    if (!this.running) return;

    if (this.video && this.poseLandmarker && this.video.readyState >= 2) {
      this.resizeCanvas();
      if (this.video.currentTime !== this.lastVideoTime) {
        const now = performance.now();
        this.lastVideoTime = this.video.currentTime;
        const result = this.poseLandmarker.detectForVideo(this.video, now);
        const landmarks = result?.landmarks?.[0] || [];
        this.latestLandmarks = landmarks;
        const pose = buildTrackedPose(landmarks);
        this.draw(pose);
        if (!this.paused) this.processPose(pose, now);
      }
    }

    this.animationFrame = window.requestAnimationFrame(() => this.loop());
  }

  processPose(pose, timestamp) {
    if (!pose) {
      this.state = resetDetectorState(this.state);
      this.renderStatus("请站进镜头里，尽量露出头和肩膀，看到上半身就可以。");
      this.renderDebug(formatMissingPoseDebug(this.latestLandmarks));
      return;
    }

    const dt = this.state.lastTorsoY == null
      ? 0.016
      : Math.max(0.016, (timestamp - this.state.lastTimestamp) / 1000);
    const verticalVelocity = this.state.lastTorsoY == null ? 0 : (this.state.lastTorsoY - pose.torso.y) / dt;

    if (this.state.baselineTorsoY == null) this.state.baselineTorsoY = pose.torso.y;
    if (this.state.baselineHeadY == null) this.state.baselineHeadY = pose.head.y;

    const torsoLift = this.state.baselineTorsoY - pose.torso.y;
    const headLift = this.state.baselineHeadY - pose.head.y;
    const cooldownMs = Math.max(0, this.state.jumpCooldownUntil - timestamp);
    const warmupMs = Math.max(0, this.state.warmupUntil - timestamp);
    const stable = Math.abs(verticalVelocity) < 0.08 && torsoLift < 0.035;

    if (stable) {
      this.state.baselineTorsoY = this.state.baselineTorsoY * 0.9 + pose.torso.y * 0.1;
      this.state.baselineHeadY = this.state.baselineHeadY * 0.9 + pose.head.y * 0.1;
    }

    const jumpSignal = warmupMs === 0
      && cooldownMs === 0
      && torsoLift > 0.04
      && headLift > 0.03
      && verticalVelocity > 0.2;

    this.state.lastTorsoY = pose.torso.y;
    this.state.lastTimestamp = timestamp;

    this.onTrack?.({
      x: clamp(1 - pose.torso.x, 0, 1),
      torsoLift,
      headLift,
      verticalVelocity
    });

    if (jumpSignal) {
      this.state.jumpCooldownUntil = timestamp + 900;
      this.renderStatus("检测到跳跃，小人也跳起来了。");
      this.onJump?.({
        x: clamp(1 - pose.torso.x, 0, 1),
        torsoLift,
        headLift,
        verticalVelocity
      });
    } else if (warmupMs > 0) {
      this.renderStatus(`摄像头预热中，还剩 ${Math.ceil(warmupMs / 1000)} 秒，先左右移动让小人跟着你。`);
    } else {
      this.renderStatus(torsoLift > 0.02 ? "很好，身体已经抬起来了，再跳高一点。" : "左右移动身体，小人会跟着你走。");
    }

    this.renderDebug([
      `torso x=${(1 - pose.torso.x).toFixed(3)} y=${pose.torso.y.toFixed(3)}`,
      `head y=${pose.head.y.toFixed(3)}`,
      `baseline torso=${this.state.baselineTorsoY.toFixed(3)}`,
      `lift torso=${torsoLift.toFixed(3)} head=${headLift.toFixed(3)}`,
      `vY=${verticalVelocity.toFixed(3)} cooldown=${cooldownMs.toFixed(0)}ms warmup=${warmupMs.toFixed(0)}ms`,
      `jump=${jumpSignal}`
    ].join("\n"));
  }

  draw(pose) {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!pose) return;

    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(126, 249, 255, 0.82)";
    ctx.shadowColor = "rgba(126, 249, 255, 0.42)";
    ctx.shadowBlur = 18;

    drawLine(ctx, width, height, pose.leftShoulder, pose.rightShoulder);
    drawLine(ctx, width, height, pose.leftShoulder, pose.leftElbow);
    drawLine(ctx, width, height, pose.leftElbow, pose.leftWrist);
    drawLine(ctx, width, height, pose.rightShoulder, pose.rightElbow);
    drawLine(ctx, width, height, pose.rightElbow, pose.rightWrist);
    drawLine(ctx, width, height, pose.leftShoulder, pose.leftHip);
    drawLine(ctx, width, height, pose.rightShoulder, pose.rightHip);
    drawLine(ctx, width, height, pose.leftHip, pose.rightHip);
    drawLine(ctx, width, height, pose.head, pose.torso);

    drawJoint(ctx, width, height, pose.head, 10, "rgba(255, 248, 179, 0.92)");
    drawJoint(ctx, width, height, pose.torso, 12, "rgba(255, 209, 102, 0.9)");
    drawJoint(ctx, width, height, pose.leftShoulder, 7);
    drawJoint(ctx, width, height, pose.rightShoulder, 7);
    drawJoint(ctx, width, height, pose.leftHip, 7);
    drawJoint(ctx, width, height, pose.rightHip, 7);
    drawJoint(ctx, width, height, pose.leftWrist, 7, "rgba(104, 255, 224, 0.95)");
    drawJoint(ctx, width, height, pose.rightWrist, 7, "rgba(255, 209, 102, 0.95)");
  }

  clearCanvas() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  renderStatus(message) {
    this.latestStatus = message;
    if (this.statusElement) this.statusElement.textContent = message;
    this.onStatus?.(message);
  }

  renderDebug(message) {
    this.latestDebug = message;
    if (this.debugElement) this.debugElement.textContent = message;
    this.onDebug?.(message);
  }
}

function createDetectorState() {
  return {
    baselineTorsoY: null,
    baselineHeadY: null,
    lastTorsoY: null,
    lastTimestamp: 0,
    jumpCooldownUntil: 0,
    warmupUntil: 0
  };
}

function resetDetectorState(state) {
  return {
    ...createDetectorState(),
    jumpCooldownUntil: state.jumpCooldownUntil,
    warmupUntil: state.warmupUntil
  };
}

function buildTrackedPose(landmarks) {
  const nose = landmarks[LANDMARK.nose];
  const leftShoulder = landmarks[LANDMARK.leftShoulder];
  const rightShoulder = landmarks[LANDMARK.rightShoulder];
  const leftElbow = landmarks[LANDMARK.leftElbow];
  const rightElbow = landmarks[LANDMARK.rightElbow];
  const leftWrist = landmarks[LANDMARK.leftWrist];
  const rightWrist = landmarks[LANDMARK.rightWrist];
  const leftHip = landmarks[LANDMARK.leftHip];
  const rightHip = landmarks[LANDMARK.rightHip];

  if (![nose, leftShoulder, rightShoulder].every(isConfident)) return null;

  const shoulderMid = averagePoint(leftShoulder, rightShoulder);
  const hipsAvailable = [leftHip, rightHip].every(isRenderable);
  const hipMid = hipsAvailable ? averagePoint(leftHip, rightHip) : null;
  const syntheticHipMid = {
    x: shoulderMid.x,
    y: Math.min(0.95, shoulderMid.y + Math.max(0.09, Math.abs(nose.y - shoulderMid.y) * 1.8)),
    visibility: shoulderMid.visibility
  };
  const torso = hipMid
    ? averagePoint(shoulderMid, hipMid)
    : {
      x: shoulderMid.x,
      y: shoulderMid.y + Math.max(0.04, (syntheticHipMid.y - shoulderMid.y) * 0.45),
      visibility: shoulderMid.visibility
    };

  return {
    head: averagePoint(nose, shoulderMid),
    torso,
    leftShoulder,
    rightShoulder,
    leftElbow: isRenderable(leftElbow) ? leftElbow : leftShoulder,
    rightElbow: isRenderable(rightElbow) ? rightElbow : rightShoulder,
    leftWrist: isRenderable(leftWrist) ? leftWrist : leftShoulder,
    rightWrist: isRenderable(rightWrist) ? rightWrist : rightShoulder,
    leftHip: hipsAvailable ? leftHip : syntheticHipMid,
    rightHip: hipsAvailable ? rightHip : syntheticHipMid,
    hipsAvailable
  };
}

function averagePoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(scorePoint(a), scorePoint(b))
  };
}

function isConfident(point) {
  return point && scorePoint(point) >= 0.25;
}

function isRenderable(point) {
  return point && scorePoint(point) >= 0.2;
}

function scorePoint(point) {
  if (!point) return 0;
  return typeof point.visibility === "number" ? point.visibility : point.presence || 0;
}

function drawLine(ctx, width, height, start, end) {
  if (!isRenderable(start) || !isRenderable(end)) return;
  ctx.beginPath();
  ctx.moveTo(start.x * width, start.y * height);
  ctx.lineTo(end.x * width, end.y * height);
  ctx.stroke();
}

function drawJoint(ctx, width, height, point, radius = 6, color = "rgba(214, 251, 255, 0.88)") {
  if (!isRenderable(point)) return;
  const x = point.x * width;
  const y = point.y * height;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.8);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMissingPoseDebug(landmarks = []) {
  const nose = landmarks[LANDMARK.nose];
  const leftShoulder = landmarks[LANDMARK.leftShoulder];
  const rightShoulder = landmarks[LANDMARK.rightShoulder];
  const leftHip = landmarks[LANDMARK.leftHip];
  const rightHip = landmarks[LANDMARK.rightHip];

  return [
    "no pose",
    `nose=${scorePoint(nose).toFixed(2)}`,
    `shoulders=${scorePoint(leftShoulder).toFixed(2)}/${scorePoint(rightShoulder).toFixed(2)}`,
    `hips=${scorePoint(leftHip).toFixed(2)}/${scorePoint(rightHip).toFixed(2)}`
  ].join("\n");
}
