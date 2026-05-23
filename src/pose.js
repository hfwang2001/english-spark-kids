import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { acquireSharedCamera, releaseSharedCamera } from "./camera.js";

const POSE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24
};

export function createSlashDetector({ onStatus, onSlash, onDebug }) {
  return new SlashDetector(onStatus, onSlash, onDebug);
}

class SlashDetector {
  constructor(onStatus, onSlash, onDebug) {
    this.onStatus = onStatus;
    this.onSlash = onSlash;
    this.onDebug = onDebug;
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
    this.state = createDetectorState();
    this.cameraOwner = `slash-${Math.random().toString(36).slice(2)}`;
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
      this.lastVideoTime = -1;
      this.loop();
      this.renderStatus("直接大幅挥手，像切水果一样切礼包。");
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
      this.state = createDetectorState({
        hands: {
          left: createHandState({ cooldownUntil: this.state.hands.left.cooldownUntil }),
          right: createHandState({ cooldownUntil: this.state.hands.right.cooldownUntil })
        }
      });
      this.renderStatus("讲解中，等会儿再继续切礼包。");
      return;
    }
    if (this.running) this.renderStatus("礼包又飞过来了，继续挥手切。");
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
        const worldLandmarks = result?.worldLandmarks?.[0] || [];
        this.draw(landmarks);
        if (!this.paused) this.processPose(landmarks, worldLandmarks, now);
      }
    }

    this.animationFrame = window.requestAnimationFrame(() => this.loop());
  }

  processPose(landmarks, worldLandmarks, timestamp) {
    if (!landmarks.length) {
      this.state = resetDetectorState(this.state);
      this.renderStatus("请站进镜头里，露出肩膀到手腕。");
      this.renderDebug("no pose");
      return;
    }

    const arms = ["right", "left"]
      .map((side) => buildArm(landmarks, worldLandmarks, side))
      .filter(Boolean);

    if (!arms.length) {
      this.state = resetDetectorState(this.state);
      this.renderStatus("我还没看清手臂，把肩膀、手肘、手腕都放进画面。");
      this.renderDebug(formatArmMissingDebug(landmarks));
      return;
    }

    let bestTrigger = null;
    let bestDebug = null;

    for (const arm of arms) {
      const handState = this.state.hands[arm.side];
      const analysis = analyzeArmSlash(arm, handState, timestamp);
      this.state.hands[arm.side] = analysis.nextHandState;

      if (!bestDebug || analysis.priority > bestDebug.priority) {
        bestDebug = analysis;
      }
      if (analysis.triggered && (!bestTrigger || analysis.priority > bestTrigger.priority)) {
        bestTrigger = analysis;
      }
    }

    if (bestTrigger) {
      this.renderStatus(`${bestTrigger.side === "right" ? "右手" : "左手"}挥砍成功，命中判定中...`);
      this.onSlash?.({
        side: bestTrigger.side,
        path: bestTrigger.path
      });
    } else if (bestDebug?.ready) {
      this.renderStatus("很好，继续大幅挥过去，把礼包切开。");
    } else {
      this.renderStatus("直接挥手就行，越大越容易识别。");
    }

    this.renderDebug(bestDebug?.debugText || "waiting");
  }

  draw(landmarks) {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks.length) return;

    drawWristTrail(ctx, width, height, this.state.hands.left.history, "rgba(104, 255, 224, 0.95)");
    drawWristTrail(ctx, width, height, this.state.hands.right.history, "rgba(255, 209, 102, 0.95)");

    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(126, 249, 255, 0.82)";
    ctx.shadowColor = "rgba(126, 249, 255, 0.35)";
    ctx.shadowBlur = 18;

    drawLine(ctx, width, height, landmarks[LANDMARK.leftShoulder], landmarks[LANDMARK.rightShoulder]);
    drawLine(ctx, width, height, landmarks[LANDMARK.leftShoulder], landmarks[LANDMARK.leftElbow]);
    drawLine(ctx, width, height, landmarks[LANDMARK.leftElbow], landmarks[LANDMARK.leftWrist]);
    drawLine(ctx, width, height, landmarks[LANDMARK.rightShoulder], landmarks[LANDMARK.rightElbow]);
    drawLine(ctx, width, height, landmarks[LANDMARK.rightElbow], landmarks[LANDMARK.rightWrist]);
    drawLine(ctx, width, height, landmarks[LANDMARK.leftShoulder], landmarks[LANDMARK.leftHip]);
    drawLine(ctx, width, height, landmarks[LANDMARK.rightShoulder], landmarks[LANDMARK.rightHip]);
    drawLine(ctx, width, height, landmarks[LANDMARK.leftHip], landmarks[LANDMARK.rightHip]);

    for (const index of Object.values(LANDMARK)) {
      const point = landmarks[index];
      if (!isRenderable(point)) continue;
      drawJoint(ctx, width, height, point, index === LANDMARK.leftWrist || index === LANDMARK.rightWrist);
    }
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

function createDetectorState(overrides = {}) {
  return {
    hands: {
      left: createHandState(),
      right: createHandState()
    },
    ...overrides
  };
}

function createHandState(overrides = {}) {
  return {
    history: [],
    cooldownUntil: 0,
    lastPoint: null,
    lastWorldPoint: null,
    ...overrides
  };
}

function resetDetectorState(state) {
  return createDetectorState({
    hands: {
      left: createHandState({ cooldownUntil: state.hands.left.cooldownUntil }),
      right: createHandState({ cooldownUntil: state.hands.right.cooldownUntil })
    }
  });
}

function buildArm(landmarks, worldLandmarks, side) {
  const shoulder = landmarks[LANDMARK[`${side}Shoulder`]];
  const elbow = landmarks[LANDMARK[`${side}Elbow`]];
  const wrist = landmarks[LANDMARK[`${side}Wrist`]];
  const shoulderWorld = worldLandmarks[LANDMARK[`${side}Shoulder`]] || shoulder;
  const wristWorld = worldLandmarks[LANDMARK[`${side}Wrist`]] || wrist;
  if (![shoulder, elbow, wrist].every(isConfident)) return null;

  return {
    side,
    shoulder,
    elbow,
    wrist,
    shoulderWorld,
    wristWorld,
    score: scorePoint(shoulder) + scorePoint(elbow) + scorePoint(wrist)
  };
}

function analyzeArmSlash(arm, handState, timestamp) {
  const shoulderSpan = Math.max(0.08, distance(arm.shoulder, arm.elbow) * 1.8);
  const dt = handState.lastPoint ? Math.max(0.016, (timestamp - handState.lastPoint.t) / 1000) : 0.016;
  const planarSpeed = handState.lastPoint ? distance(arm.wrist, handState.lastPoint) / dt : 0;
  const spatialSpeed = handState.lastWorldPoint ? distance3d(arm.wristWorld, handState.lastWorldPoint) / dt : 0;
  const forwardSwing = handState.lastWorldPoint ? handState.lastWorldPoint.z - arm.wristWorld.z : 0;
  const reach = distance(arm.shoulder, arm.wrist) / shoulderSpan;

  const snapshot = {
    t: timestamp,
    x: 1 - arm.wrist.x,
    y: arm.wrist.y,
    rawX: arm.wrist.x,
    rawY: arm.wrist.y,
    z: arm.wristWorld.z || 0,
    planarSpeed,
    spatialSpeed
  };

  const history = [...handState.history, snapshot].filter((entry) => timestamp - entry.t <= 220);
  const first = history[0] || snapshot;
  let pathLength = 0;
  for (let index = 1; index < history.length; index += 1) {
    pathLength += Math.hypot(history[index].x - history[index - 1].x, history[index].y - history[index - 1].y);
  }
  const directDistance = Math.hypot(snapshot.x - first.x, snapshot.y - first.y);
  const peakPlanarSpeed = history.reduce((max, entry) => Math.max(max, entry.planarSpeed || 0), planarSpeed);
  const peakSpatialSpeed = history.reduce((max, entry) => Math.max(max, entry.spatialSpeed || 0), spatialSpeed);
  const directionConsistency = pathLength ? directDistance / pathLength : 0;
  const ready = reach > 0.34 && arm.wrist.y < arm.shoulder.y + 0.42;
  const cooldownMs = Math.max(0, handState.cooldownUntil - timestamp);
  const slashSignal = peakPlanarSpeed > 0.85 || peakSpatialSpeed > 1.2;
  const sweepSignal = pathLength > 0.17 && directDistance > 0.1;
  const directionSignal = directionConsistency > 0.48;
  const triggered = cooldownMs === 0 && ready && slashSignal && sweepSignal && directionSignal;

  const debugText = [
    `arm=${arm.side}`,
    `conf s/e/w=${scorePoint(arm.shoulder).toFixed(2)}/${scorePoint(arm.elbow).toFixed(2)}/${scorePoint(arm.wrist).toFixed(2)}`,
    `reach=${reach.toFixed(3)} ready=${ready} cooldown=${cooldownMs.toFixed(0)}ms`,
    `planar speed=${planarSpeed.toFixed(3)} peak=${peakPlanarSpeed.toFixed(3)}`,
    `spatial speed=${spatialSpeed.toFixed(3)} peak=${peakSpatialSpeed.toFixed(3)} zSwing=${forwardSwing.toFixed(3)}`,
    `path=${pathLength.toFixed(3)} direct=${directDistance.toFixed(3)} consistency=${directionConsistency.toFixed(3)}`,
    `signals slash=${slashSignal} sweep=${sweepSignal} direction=${directionSignal}`,
    `trigger=${triggered}`
  ].join("\n");

  if (triggered) {
    return {
      side: arm.side,
      triggered: true,
      ready,
      priority: peakSpatialSpeed + pathLength,
      path: history.map((entry) => ({ x: clamp(entry.x, 0, 1), y: clamp(entry.y, 0, 1) })),
      debugText,
      nextHandState: createHandState({
        cooldownUntil: timestamp + 360,
        lastPoint: { x: arm.wrist.x, y: arm.wrist.y, t: timestamp },
        lastWorldPoint: { x: arm.wristWorld.x, y: arm.wristWorld.y, z: arm.wristWorld.z }
      })
    };
  }

  return {
    side: arm.side,
    triggered: false,
    ready,
    priority: peakSpatialSpeed + directDistance + (ready ? 0.2 : 0),
    debugText,
    nextHandState: createHandState({
      history,
      cooldownUntil: handState.cooldownUntil,
      lastPoint: { x: arm.wrist.x, y: arm.wrist.y, t: timestamp },
      lastWorldPoint: { x: arm.wristWorld.x, y: arm.wristWorld.y, z: arm.wristWorld.z }
    })
  };
}

function isConfident(point) {
  return point && scorePoint(point) >= 0.35;
}

function isRenderable(point) {
  return point && scorePoint(point) >= 0.2;
}

function scorePoint(point) {
  if (!point) return 0;
  return typeof point.visibility === "number" ? point.visibility : point.presence || 0;
}

function formatArmMissingDebug(landmarks) {
  return ["right", "left"]
    .map((side) => {
      const shoulder = landmarks[LANDMARK[`${side}Shoulder`]];
      const elbow = landmarks[LANDMARK[`${side}Elbow`]];
      const wrist = landmarks[LANDMARK[`${side}Wrist`]];
      return `${side} conf s/e/w=${scorePoint(shoulder).toFixed(2)}/${scorePoint(elbow).toFixed(2)}/${scorePoint(wrist).toFixed(2)}`;
    })
    .join("\n");
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawLine(ctx, width, height, start, end) {
  if (!isRenderable(start) || !isRenderable(end)) return;
  ctx.beginPath();
  ctx.moveTo((1 - start.x) * width, start.y * height);
  ctx.lineTo((1 - end.x) * width, end.y * height);
  ctx.stroke();
}

function drawJoint(ctx, width, height, point, isWrist = false) {
  const x = (1 - point.x) * width;
  const y = point.y * height;
  if (isWrist) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 22);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    glow.addColorStop(0.35, "rgba(126, 249, 255, 0.85)");
    glow.addColorStop(1, "rgba(126, 249, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = isWrist ? "rgba(255, 248, 179, 0.98)" : "rgba(214, 251, 255, 0.88)";
  ctx.beginPath();
  ctx.arc(x, y, isWrist ? 7.5 : 5.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawWristTrail(ctx, width, height, history, color) {
  if (!history?.length) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 28;
  ctx.shadowColor = color.replace("0.95", "0.72");
  ctx.strokeStyle = color.replace("0.95", "0.44");
  ctx.lineWidth = 16;
  ctx.beginPath();
  history.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(255,255,255,0.65)";
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  history.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  for (let index = 0; index < history.length; index += 1) {
    const point = history[index];
    const alpha = (index + 1) / history.length;
    const radius = 8 + alpha * 16;
    const gradient = ctx.createRadialGradient(point.x * width, point.y * height, 0, point.x * width, point.y * height, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${0.96 * alpha})`);
    gradient.addColorStop(0.2, color.replace("0.95", String(0.92 * alpha)));
    gradient.addColorStop(0.58, color.replace("0.95", String(0.46 * alpha)));
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
