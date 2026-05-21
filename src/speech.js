let currentAudio = null;
let currentSequence = null;
let letterAudioManifestPromise = null;
let currentRecorder = null;
let currentRecordStream = null;
const activeControllers = new Set();

function sleep(ms) {
  const controller = createTrackedController();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);

    const cleanup = () => {
      window.clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      unregisterController(controller);
    };

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function canListen() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function stopSpeech() {
  currentSequence = null;
  for (const controller of Array.from(activeControllers)) {
    controller.abort();
  }
  if (currentRecorder && currentRecorder.state !== "inactive") {
    try {
      currentRecorder.stop();
    } catch {}
  }
  currentRecorder = null;
  if (currentRecordStream) {
    currentRecordStream.getTracks().forEach((track) => track.stop());
    currentRecordStream = null;
  }
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

export async function speak(text, options = {}) {
  if (!text) return false;
  stopSpeech();
  const sequenceId = Symbol("remote-tts");
  currentSequence = sequenceId;

  const completed = await speakWithRemoteTts(text, options, sequenceId);
  if (!completed || currentSequence !== sequenceId) return false;
  const stillActive = await sleep(options.pause ?? 180);
  return Boolean(stillActive && currentSequence === sequenceId);
}

export async function speakLearningScript(word) {
  if (!await speak(bilingualLabel(word), { lang: "auto", rate: 0.82, style: "learn-bilingual" })) return false;
  if (!await speak("小朋友们，read after me", { lang: "auto", rate: 0.82, style: "read-after-me" })) return false;
  if (!await speakSpelling(word.english, { lang: "en-US", rate: 0.62 })) return false;
  return speak(bilingualLabel(word), { lang: "auto", rate: 0.82, style: "learn-bilingual" });
}

export function spellOut(english) {
  return english.replace(/\s+/g, " ").split("").map((char) => char === " " ? "space" : char).join(", ");
}

function bilingualLabel(word) {
  return `${word.english}，${word.chinese}`;
}

async function speakSpelling(english, options = {}) {
  const sequenceId = Symbol("spelling");
  stopSpeech();
  currentSequence = sequenceId;

  const letters = english.toLowerCase().replace(/\s+/g, " ").split("");
  const manifest = await getLetterAudioManifest();
  const canUseLocalAudio = letters.every((char) => char === " " || Boolean(manifest[char]));

  if (!canUseLocalAudio) {
    if (currentSequence !== sequenceId) return;
    const completed = await speakWithRemoteTts(spellOut(english), options, sequenceId);
    if (!completed || currentSequence !== sequenceId) return false;
    const stillActive = await sleep(options.pause ?? 180);
    return Boolean(stillActive && currentSequence === sequenceId);
  }

  for (const char of letters) {
    if (currentSequence !== sequenceId) return false;
    if (char === " ") {
      continue;
    }
    await playAudioUrl(manifest[char], sequenceId);
    if (currentSequence !== sequenceId) return false;
    const stillActive = await sleep(200);
    if (!stillActive || currentSequence !== sequenceId) return false;
  }

  if (currentSequence !== sequenceId) return false;
  const stillActive = await sleep(options.pause ?? 180);
  return Boolean(stillActive && currentSequence === sequenceId);
}

export function listenOnce() {
  if (!canListen()) {
    return Promise.reject(new Error("当前浏览器不支持录音上传，请用 Chrome 或 Edge 体验。"));
  }

  return recordAudio(2800).then((blob) => blob ? transcribeWithQwenAsr(blob) : "");
}

export function isPronunciationMatch(transcript, expected) {
  const spoken = normalize(transcript);
  const target = normalize(expected);
  if (!spoken || !target) return false;
  if (spoken.includes(target)) return true;
  return levenshtein(spoken, target) <= Math.max(1, Math.floor(target.length * 0.28));
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function guessLang(text) {
  return /[\u4e00-\u9fa5]/.test(text) ? "zh-CN" : "en-US";
}

async function speakWithRemoteTts(text, options, sequenceId) {
  if (!window.APP_CONFIG?.useRemoteTts) {
    throw new Error("Qwen TTS is required but disabled.");
  }
  const controller = new AbortController();
  let response;
  try {
    registerController(controller);
    response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lang: options.lang || guessLang(text),
        style: options.style || "default",
        rate: options.rate
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") return false;
    throw error;
  } finally {
    unregisterController(controller);
  }
  if (currentSequence !== sequenceId) return false;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || "Qwen TTS request failed.");
  }
  const blob = await response.blob().catch((error) => {
    if (error.name === "AbortError") return null;
    throw error;
  });
  if (!blob || currentSequence !== sequenceId) return false;
  const audioUrl = URL.createObjectURL(blob);
  try {
    await playAudioUrl(audioUrl, sequenceId);
    return currentSequence === sequenceId;
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

async function playAudioUrl(url, sequenceId = currentSequence) {
  if (currentSequence !== sequenceId) return;
  const audio = new Audio(url);
  currentAudio = audio;
  try {
    await audio.play();
  } catch (error) {
    if (currentSequence !== sequenceId || error.name === "AbortError") return;
    throw error;
  }
  if (currentSequence !== sequenceId) {
    audio.pause();
    audio.src = "";
    if (currentAudio === audio) currentAudio = null;
    return;
  }
  await new Promise((resolve) => {
    const finish = () => resolve();
    audio.onended = finish;
    audio.onerror = finish;
    audio.onpause = finish;
  });
  if (currentAudio === audio) currentAudio = null;
}

async function getLetterAudioManifest() {
  if (!letterAudioManifestPromise) {
    const controller = createTrackedController();
    letterAudioManifestPromise = fetch("/audio/letters/manifest.json", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : {})
      .then((payload) => normalizeLetterManifest(payload))
      .catch((error) => {
        if (error.name === "AbortError") {
          letterAudioManifestPromise = null;
          return {};
        }
        return {};
      })
      .finally(() => unregisterController(controller));
  }
  return letterAudioManifestPromise;
}

function normalizeLetterManifest(payload) {
  const letters = payload?.letters;
  if (!letters || typeof letters !== "object") return {};

  return Object.fromEntries(
    Object.entries(letters)
      .filter(([key, value]) => /^[a-z]$/.test(key) && typeof value === "string" && value)
      .map(([key, value]) => [key, value.startsWith("/") ? value : `/${value}`])
  );
}

async function recordAudio(durationMs) {
  const controller = createTrackedController();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (controller.signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    unregisterController(controller);
    return null;
  }
  const mimeType = pickAudioMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  currentRecorder = recorder;
  currentRecordStream = stream;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const stopRecording = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  controller.signal.addEventListener("abort", stopRecording, { once: true });
  recorder.start();
  const finishedDelay = await sleep(durationMs);
  if (!finishedDelay && recorder.state !== "inactive") recorder.stop();

  await new Promise((resolve) => {
    recorder.onstop = resolve;
    if (recorder.state !== "inactive") recorder.stop();
  });
  stream.getTracks().forEach((track) => track.stop());
  controller.signal.removeEventListener("abort", stopRecording);
  unregisterController(controller);
  if (currentRecorder === recorder) currentRecorder = null;
  if (currentRecordStream === stream) currentRecordStream = null;

  return new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
}

async function transcribeWithQwenAsr(blob) {
  const controller = createTrackedController();
  let response;
  try {
    response = await fetch("/api/asr", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm"
      },
      body: blob,
      signal: controller.signal
    });
  } catch (error) {
    unregisterController(controller);
    if (error.name === "AbortError") return "";
    throw error;
  }
  unregisterController(controller);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Qwen ASR 没有听清楚，再试一次。");
  }
  return payload.text || "";
}

function createTrackedController() {
  const controller = new AbortController();
  registerController(controller);
  return controller;
}

function registerController(controller) {
  activeControllers.add(controller);
}

function unregisterController(controller) {
  activeControllers.delete(controller);
}

function pickAudioMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, y) => [y]);
  for (let x = 0; x <= a.length; x += 1) matrix[0][x] = x;
  for (let y = 1; y <= b.length; y += 1) {
    for (let x = 1; x <= a.length; x += 1) {
      matrix[y][x] = Math.min(
        matrix[y - 1][x] + 1,
        matrix[y][x - 1] + 1,
        matrix[y - 1][x - 1] + (a[x - 1] === b[y - 1] ? 0 : 1)
      );
    }
  }
  return matrix[b.length][a.length];
}
