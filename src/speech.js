let currentAudio = null;

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function canListen() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function stopSpeech() {
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

export async function speak(text, options = {}) {
  if (!text) return;
  stopSpeech();

  await speakWithRemoteTts(text, options);
  await sleep(options.pause ?? 180);
}

export async function speakLearningScript(word) {
  await speak(word.english, { lang: "en-US", rate: 0.74 });
  await speak(word.chinese, { lang: "zh-CN", rate: 0.82 });
  await speak("小朋友们，read after me", { lang: "zh-CN", rate: 0.82 });
  await speak(spellOut(word.english), { lang: "en-US", rate: 0.62 });
  await speak(word.english, { lang: "en-US", rate: 0.74 });
  await speak(word.chinese, { lang: "zh-CN", rate: 0.82 });
}

export function spellOut(english) {
  return english.replace(/\s+/g, " ").split("").map((char) => char === " " ? "space" : char).join(", ");
}

export function listenOnce() {
  if (!canListen()) {
    return Promise.reject(new Error("当前浏览器不支持录音上传，请用 Chrome 或 Edge 体验。"));
  }

  return recordAudio(2800).then(transcribeWithQwenAsr);
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

async function speakWithRemoteTts(text, options) {
  if (!window.APP_CONFIG?.useRemoteTts) {
    throw new Error("Qwen TTS is required but disabled.");
  }
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang: options.lang || guessLang(text) })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || "Qwen TTS request failed.");
  }
  const blob = await response.blob();
  const audio = new Audio(URL.createObjectURL(blob));
  currentAudio = audio;
  await audio.play();
  await new Promise((resolve) => {
    audio.onended = resolve;
    audio.onerror = resolve;
  });
  if (currentAudio === audio) currentAudio = null;
}

async function recordAudio(durationMs) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickAudioMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start();
  await sleep(durationMs);

  await new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.stop();
  });
  stream.getTracks().forEach((track) => track.stop());

  return new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
}

async function transcribeWithQwenAsr(blob) {
  const response = await fetch("/api/asr", {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "audio/webm"
    },
    body: blob
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Qwen ASR 没有听清楚，再试一次。");
  }
  return payload.text || "";
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
