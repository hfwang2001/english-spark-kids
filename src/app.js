import { words } from "./words.js";
import { createSlashDetector } from "./pose.js";
import { canListen, isPronunciationMatch, listenOnce, speak, speakLearningScript, stopSpeech } from "./speech.js";

window.APP_CONFIG = {
  useRemoteTts: true
};

const state = {
  screen: "home",
  learningIndex: 0,
  quizIndex: 0,
  learned: new Set(),
  correct: new Set(),
  transcript: "",
  isBusy: false,
  runId: 0
};

const PACKAGE_ICONS = ["🎁", "🎀", "📦", "🎉", "🪅", "🎊"];
const ROUND_DURATION_MS = 30000;
const MAX_REVIEW_WORDS = 6;

const learnRuntime = {
  detector: null,
  running: false,
  reviewing: false,
  roundActive: false,
  gameRaf: 0,
  lastTick: 0,
  lastSpawnAt: 0,
  nextGiftId: 1,
  spawnCursor: 0,
  roundNumber: 0,
  roundRemainingMs: ROUND_DURATION_MS,
  collectedOrder: [],
  collectedSet: new Set(),
  gifts: [],
  giftNodes: new Map(),
  slashTrails: [],
  lastHitIndex: null,
  hitPopup: null,
  elements: {
    arena: null,
    slashCanvas: null,
    video: null,
    canvas: null,
    status: null,
    debug: null,
    stageLabel: null,
    scoreLearned: null,
    scoreRound: null,
    scoreLatest: null,
    scoreTimer: null,
    reviewButton: null,
    popup: null,
    spotlightCard: null,
    spotlightEmoji: null,
    spotlightEnglish: null,
    spotlightChinese: null,
    roundCollection: null
  },
  gestureStatus: "打开摄像头后，直接大幅挥动手臂，像切水果一样切开礼包。",
  debugText: ""
};

const app = document.querySelector("#app");

function render() {
  app.innerHTML = `
    <main class="shell screen-${state.screen}">
      ${renderHeader()}
      ${renderScreen()}
    </main>
  `;
  bindEvents();
  syncScreenRuntime();
}

function renderHeader() {
  const progress = Math.round((state.learned.size / words.length) * 100);
  return `
    <header class="topbar">
      <button class="brand" data-action="home" aria-label="返回首页">
        <span class="brand-mark">Aa</span>
        <span>English Spark</span>
      </button>
      <nav class="tabs" aria-label="游戏步骤">
        ${tabButton("learn", "背单词", "1")}
        ${tabButton("quiz", "听读闯关", "2")}
        ${tabButton("summary", "学习总结", "3")}
      </nav>
      <div class="meter" aria-label="学习进度">
        <span style="width:${progress}%"></span>
      </div>
    </header>
  `;
}

function tabButton(screen, label, step) {
  return `<button class="tab ${state.screen === screen ? "is-active" : ""}" data-action="${screen}">
    <b>${step}</b><span>${label}</span>
  </button>`;
}

function renderScreen() {
  if (state.screen === "learn") return renderLearn();
  if (state.screen === "quiz") return renderQuiz();
  if (state.screen === "reward") return renderReward();
  if (state.screen === "summary") return renderSummary();
  return renderHome();
}

function renderHome() {
  return `
    <section class="cyber-hero">
      <div class="cyber-grid" aria-hidden="true"></div>
      <div class="hero-copy">
        <p class="eyebrow">English for kids</p>
        <h1>Flash Card<br>Learning</h1>
        <p class="hero-sub">20 words. Listen, repeat, play.</p>
        <div class="hero-actions">
          <button class="primary" data-action="learn">开始背单词</button>
          <button class="secondary" data-action="quiz">直接闯关</button>
        </div>
      </div>
    </section>
  `;
}

function renderLearn() {
  const current = words[state.learningIndex] || words[0];
  const latestWord = learnRuntime.lastHitIndex == null ? "-" : words[learnRuntime.lastHitIndex].english;
  const learnedWords = words.filter((word) => state.learned.has(word.id));
  const learnedPreview = (learnedWords.length ? learnedWords : words.slice(0, 6))
    .map((word) => compactCard(word, true, state.learned.has(word.id)))
    .join("");
  const roundCollection = learnRuntime.collectedOrder.length
    ? learnRuntime.collectedOrder
      .slice(0, MAX_REVIEW_WORDS)
      .map((wordIndex) => compactCard(words[wordIndex], true, true))
      .join("")
    : `<div class="round-collection-empty">这一轮先随便挥，切中的单词会收进这里。</div>`;

  return `
    <section class="learn-layout arcade-learn">
      <div class="learn-stage-head">
        <div>
          <p class="eyebrow">Slice To Learn</p>
          <h1>挥砍礼包舞台</h1>
          <p class="learn-stage-copy">先玩 30 秒礼包雨。切中后只弹大字和音效，不停下来；时间到了再把这一轮收集到的单词统一学一遍。</p>
        </div>
        <div class="learn-scoreboard">
          <span><b id="learn-score-learned">${state.learned.size}</b> 已学会</span>
          <span><b id="learn-score-round">${learnRuntime.collectedOrder.length}</b> 本轮收集</span>
          <span><b id="learn-score-latest">${latestWord}</b> 最新切开</span>
          <span><b id="learn-score-timer">${getRoundSecondsLeft()}s</b> 本轮剩余</span>
        </div>
      </div>

      <div class="learn-arcade-grid learn-arcade-grid--single">
        <section class="arena-panel arena-panel--immersive">
          <div class="wheel-status ${state.isBusy ? "is-busy" : ""}">
            <span class="wheel-status-dot"></span>
            <strong id="learn-stage-label">${getLearnStageLabel()}</strong>
          </div>
          <div class="slash-stage">
            <div class="slash-stage-copy">
              <span>礼包雨</span>
              <b>Fruit Ninja For Words</b>
            </div>
            <video id="learn-video" class="hidden-pose-video" autoplay muted playsinline></video>
            <canvas id="learn-overlay" class="pose-stage-overlay"></canvas>
            <div class="gift-arena" id="learn-arena">
              <canvas id="learn-slash-overlay" class="slash-overlay"></canvas>
            </div>
            <div id="learn-hit-popup" class="hit-popup" aria-live="polite"></div>
          </div>
          <div class="learn-controls">
            <button class="primary" data-action="play-current" ${state.isBusy ? "disabled" : ""}>重播当前词卡</button>
            <button class="secondary" data-action="review-round" id="learn-review-button" ${state.isBusy || !learnRuntime.collectedOrder.length ? "disabled" : ""}>立即复习本轮</button>
            <button class="secondary" data-action="retry-camera">重新打开摄像头</button>
          </div>
          <div class="stage-tracking-bar">
            <div class="stage-tracking-copy">
              <p class="eyebrow">Body Tracking</p>
              <h2>骨架挥砍舞台</h2>
              <p id="learn-gesture-status" class="status">${learnRuntime.gestureStatus}</p>
            </div>
            <div class="stage-tracking-debug">
              <div class="vision-badge">Pose Skeleton</div>
              <pre id="learn-gesture-debug" class="debug-panel">${learnRuntime.debugText || "等待动作调试数据..."}</pre>
            </div>
          </div>
          <small>玩法提示：不用看摄像头画面，只看骨架和手腕发光点，像挥光剑一样切过去就行。</small>
        </section>
      </div>

      <article id="learn-spotlight-card" class="spotlight-card learn-spotlight" data-word="${current.id}" style="--card:${current.color};--accent:${current.accent}">
        ${cardImage(current, "learn-spotlight-emoji")}
        <div class="word-meta">
          <p class="eyebrow">Latest Surprise</p>
          <h2 id="learn-spotlight-english">${current.english}</h2>
          <p id="learn-spotlight-chinese">${current.chinese}</p>
        </div>
        <div class="card-sparkles"><i></i><i></i><i></i></div>
      </article>

      <section class="round-collection-panel">
        <div class="round-collection-head">
          <p class="eyebrow">Round Loot</p>
          <h2>这一轮收集到的单词</h2>
          <p>回合结束后，我们会按照这里的顺序统一学一遍。</p>
        </div>
        <div id="learn-round-collection" class="ribbon-grid round-collection-grid">
          ${roundCollection}
        </div>
      </section>

      <div class="ribbon-grid learned-preview">
        ${learnedPreview}
      </div>
    </section>
  `;
}

function renderQuiz() {
  const current = words[state.quizIndex] || words[0];
  return `
    <section class="quiz-layout">
      <article class="quiz-card" style="--card:${current.color};--accent:${current.accent}">
        ${cardImage(current)}
        <div class="quiz-mask">?</div>
        <p class="quiz-cn">${current.chinese}</p>
      </article>
      <div class="quiz-panel">
        <h1>听图读单词</h1>
        <p>看图片，大声读出英文。读对就进入奖励动画。</p>
        <div class="quiz-actions">
          <button class="primary mic" data-action="listen" ${state.isBusy ? "disabled" : ""}>开始读</button>
          <button class="secondary" data-action="skip-reward">演示奖励</button>
        </div>
        <p class="status">${state.transcript || (canListen() ? "准备好了，按下按钮开始。" : "这个浏览器不支持语音识别，可用 Chrome 或 Edge。")}</p>
      </div>
    </section>
  `;
}

function renderReward() {
  const current = words[state.quizIndex] || words[0];
  return `
    <section class="reward-layout" style="--card:${current.color};--accent:${current.accent}">
      <div class="reward-stage">
        <div class="character">
          <div class="face">${current.emoji}</div>
          <div class="word-bubble">${current.english}</div>
          <span class="arm left"></span>
          <span class="arm right"></span>
          <span class="leg left"></span>
          <span class="leg right"></span>
        </div>
        <div class="confetti">${Array.from({ length: 28 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
      </div>
      <div class="reward-copy">
        <p class="eyebrow">Great job!</p>
        <h1>I am ${current.english}.</h1>
        <p>${introLine(current)} 小朋友读得真棒。</p>
        <button class="primary" data-action="next-quiz">继续闯关</button>
      </div>
    </section>
  `;
}

function renderSummary() {
  const learned = state.learned.size || words.length;
  return `
    <section class="summary-layout">
      <div class="summary-head">
        <p class="eyebrow">Learning report</p>
        <h1>Today we learned ${words.length} words</h1>
        <div class="summary-stats">
          <span><b>${learned}</b> learned</span>
          <span><b>${state.correct.size}</b> spoken well</span>
          <span><b>${words.length}</b> cards</span>
        </div>
        <button class="primary" data-action="read-summary">播放总结</button>
      </div>
      <div class="summary-grid">
        ${words.map((word) => compactCard(word, true)).join("")}
      </div>
    </section>
  `;
}

function cardImage(word, emojiId = "") {
  return `
    <div class="image-frame" role="img" aria-label="${word.english} image">
      <div class="image-glow"></div>
      <div class="emoji-art"${emojiId ? ` id="${emojiId}"` : ""}>${word.emoji}</div>
    </div>
  `;
}

function compactCard(word, showEnglish = false, learned = false) {
  return `
    <article class="compact ${learned ? "is-learned" : ""}" style="--card:${word.color};--accent:${word.accent}">
      <span>${word.emoji}</span>
      <b>${showEnglish ? word.english : word.chinese}</b>
      <small>${showEnglish ? word.chinese : word.english}</small>
    </article>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action));
  });
}

function syncScreenRuntime() {
  if (state.screen === "learn") {
    mountLearnRuntime();
    return;
  }

  learnRuntime.elements = {
    arena: null,
    slashCanvas: null,
    video: null,
    canvas: null,
    status: null,
    debug: null,
    stageLabel: null,
    scoreLearned: null,
    scoreRound: null,
    scoreLatest: null,
    scoreTimer: null,
    reviewButton: null,
    popup: null,
    spotlightCard: null,
    spotlightEmoji: null,
    spotlightEnglish: null,
    spotlightChinese: null,
    roundCollection: null
  };
}

function mountLearnRuntime() {
  ensureLearnRuntime();
  learnRuntime.elements.arena = document.querySelector("#learn-arena");
  learnRuntime.elements.slashCanvas = document.querySelector("#learn-slash-overlay");
  learnRuntime.elements.video = document.querySelector("#learn-video");
  learnRuntime.elements.canvas = document.querySelector("#learn-overlay");
  learnRuntime.elements.status = document.querySelector("#learn-gesture-status");
  learnRuntime.elements.debug = document.querySelector("#learn-gesture-debug");
  learnRuntime.elements.stageLabel = document.querySelector("#learn-stage-label");
  learnRuntime.elements.scoreLearned = document.querySelector("#learn-score-learned");
  learnRuntime.elements.scoreRound = document.querySelector("#learn-score-round");
  learnRuntime.elements.scoreLatest = document.querySelector("#learn-score-latest");
  learnRuntime.elements.scoreTimer = document.querySelector("#learn-score-timer");
  learnRuntime.elements.reviewButton = document.querySelector("#learn-review-button");
  learnRuntime.elements.popup = document.querySelector("#learn-hit-popup");
  learnRuntime.elements.spotlightCard = document.querySelector("#learn-spotlight-card");
  learnRuntime.elements.spotlightEmoji = document.querySelector("#learn-spotlight-emoji");
  learnRuntime.elements.spotlightEnglish = document.querySelector("#learn-spotlight-english");
  learnRuntime.elements.spotlightChinese = document.querySelector("#learn-spotlight-chinese");
  learnRuntime.elements.roundCollection = document.querySelector("#learn-round-collection");

  learnRuntime.detector.attach({
    video: learnRuntime.elements.video,
    canvas: learnRuntime.elements.canvas,
    statusElement: learnRuntime.elements.status,
    debugElement: learnRuntime.elements.debug
  });

  syncArenaCanvasSize();
  syncArenaDom();
  drawSlashOverlay();
  syncLearnHud();
  syncRoundCollection();
}

function ensureLearnRuntime() {
  if (learnRuntime.detector) return;
  learnRuntime.detector = createSlashDetector({
    onStatus: (message) => {
      learnRuntime.gestureStatus = message;
    },
    onDebug: (message) => {
      learnRuntime.debugText = message;
    },
    onSlash: (payload) => {
      handleLearnSlash(payload);
    }
  });
}

async function handleAction(action) {
  if (["home", "learn", "quiz", "summary"].includes(action)) {
    navigateTo(action);
    return;
  }
  if (action === "play-current") await playCurrentLearning();
  if (action === "listen") await listenForWord();
  if (action === "skip-reward") showReward();
  if (action === "next-quiz") nextQuiz();
  if (action === "read-summary") await readSummary();
  if (action === "resume-arena") resumeLearnArena();
  if (action === "review-round") await reviewCurrentRound();
  if (action === "retry-camera") await retryLearnCamera();
}

function navigateTo(screen) {
  const leavingLearn = state.screen === "learn" && screen !== "learn";
  stopSpeech();
  state.runId += 1;
  state.isBusy = false;
  state.transcript = "";
  if (leavingLearn) stopLearnExperience();
  state.screen = screen;
  render();
  if (screen === "learn") startLearnExperience();
}

async function startLearnExperience() {
  ensureLearnRuntime();
  mountLearnRuntime();
  if (!learnRuntime.roundActive && !learnRuntime.reviewing) startNewLearnRound();
  resumeLearnArena();
  await learnRuntime.detector.start();
}

function stopLearnExperience() {
  pauseLearnArena();
  learnRuntime.detector?.stop();
  learnRuntime.gifts = [];
  learnRuntime.giftNodes.forEach((node) => node.remove());
  learnRuntime.giftNodes.clear();
  learnRuntime.slashTrails = [];
  learnRuntime.reviewing = false;
  learnRuntime.roundActive = false;
  learnRuntime.roundRemainingMs = ROUND_DURATION_MS;
  learnRuntime.collectedOrder = [];
  learnRuntime.collectedSet = new Set();
  learnRuntime.hitPopup = null;
}

async function retryLearnCamera() {
  if (state.screen !== "learn") return;
  ensureLearnRuntime();
  await learnRuntime.detector.restart();
}

function resumeLearnArena() {
  if (state.screen !== "learn" || state.isBusy) return;
  if (!learnRuntime.roundActive) startNewLearnRound();
  learnRuntime.detector?.setPaused(false);
  if (learnRuntime.running) return;
  learnRuntime.running = true;
  learnRuntime.lastTick = performance.now();
  learnRuntime.lastSpawnAt = learnRuntime.lastTick;
  tickLearnArena(learnRuntime.lastTick);
}

function pauseLearnArena() {
  learnRuntime.running = false;
  if (learnRuntime.gameRaf) {
    window.cancelAnimationFrame(learnRuntime.gameRaf);
    learnRuntime.gameRaf = 0;
  }
  learnRuntime.lastTick = 0;
}

function tickLearnArena(timestamp) {
  if (!learnRuntime.running) return;
  const delta = Math.min(0.033, learnRuntime.lastTick ? (timestamp - learnRuntime.lastTick) / 1000 : 0);
  learnRuntime.lastTick = timestamp;
  if (learnRuntime.roundActive && !state.isBusy) {
    learnRuntime.roundRemainingMs = Math.max(0, learnRuntime.roundRemainingMs - delta * 1000);
  }
  updateGifts(delta, timestamp);
  pruneTrails(timestamp);
  pruneHitPopup(timestamp);
  syncArenaDom();
  drawSlashOverlay();
  syncLearnHud();
  if (learnRuntime.roundActive && learnRuntime.roundRemainingMs === 0 && !state.isBusy) {
    void completeLearnRound();
    return;
  }
  learnRuntime.gameRaf = window.requestAnimationFrame((nextTimestamp) => tickLearnArena(nextTimestamp));
}

function updateGifts(delta, timestamp) {
  if (!state.isBusy && learnRuntime.roundActive) maybeSpawnGift(timestamp);

  for (const gift of learnRuntime.gifts) {
    if (gift.state === "burst") continue;
    gift.x += gift.vx * delta;
    gift.y += gift.vy * delta;
    gift.vy += 1.18 * delta;
    gift.rotation += gift.vr * delta;
  }

  learnRuntime.gifts = learnRuntime.gifts.filter((gift) => {
    if (gift.state === "burst") {
      return timestamp - gift.hitAt < 420;
    }
    return gift.x > -0.18 && gift.x < 1.18 && gift.y < 1.28;
  });
}

function maybeSpawnGift(timestamp) {
  const activeCount = learnRuntime.gifts.filter((gift) => gift.state !== "burst").length;
  if (activeCount >= 3) return;
  if (timestamp - learnRuntime.lastSpawnAt < 920) return;
  learnRuntime.lastSpawnAt = timestamp;
  learnRuntime.gifts.push(createGift());
}

function createGift() {
  const id = learnRuntime.nextGiftId++;
  const wordIndex = learnRuntime.spawnCursor % words.length;
  learnRuntime.spawnCursor += 1;
  const fromLeft = Math.random() > 0.5;
  const x = fromLeft ? 0.18 + Math.random() * 0.18 : 0.64 + Math.random() * 0.18;
  return {
    id,
    wordIndex,
    icon: PACKAGE_ICONS[id % PACKAGE_ICONS.length],
    x,
    y: 1.08,
    vx: fromLeft ? 0.24 + Math.random() * 0.16 : -(0.24 + Math.random() * 0.16),
    vy: -(0.94 + Math.random() * 0.16),
    vr: (Math.random() - 0.5) * 180,
    rotation: Math.random() * 40 - 20,
    radius: 0.095,
    state: "flying",
    hitAt: 0
  };
}

function syncArenaDom() {
  const arena = learnRuntime.elements.arena;
  if (!arena) return;
  const presentIds = new Set();

  for (const gift of learnRuntime.gifts) {
    presentIds.add(gift.id);
    let node = learnRuntime.giftNodes.get(gift.id);
    if (!node) {
      node = document.createElement("article");
      node.className = "gift-node";
      node.innerHTML = `
        <div class="gift-core">
          <span class="gift-icon"></span>
          <b class="gift-title">Surprise</b>
          <small class="gift-sub">Slice me</small>
        </div>
      `;
      arena.appendChild(node);
      learnRuntime.giftNodes.set(gift.id, node);
    }
    if (node.parentElement !== arena) {
      arena.appendChild(node);
    }
    const word = words[gift.wordIndex];
    node.className = `gift-node ${gift.state === "burst" ? "is-burst" : ""}`;
    node.style.left = `${gift.x * 100}%`;
    node.style.top = `${gift.y * 100}%`;
    node.style.transform = `translate(-50%, -50%) rotate(${gift.rotation}deg) scale(${gift.state === "burst" ? 1.12 : 1})`;
    node.style.setProperty("--gift", word.color);
    node.style.setProperty("--accent", word.accent);
    node.querySelector(".gift-icon").textContent = gift.state === "burst" ? word.emoji : gift.icon;
    node.querySelector(".gift-title").textContent = gift.state === "burst" ? word.english : "Surprise";
    node.querySelector(".gift-sub").textContent = gift.state === "burst" ? word.chinese : "Slice me";
  }

  for (const [id, node] of Array.from(learnRuntime.giftNodes.entries())) {
    if (presentIds.has(id)) continue;
    node.remove();
    learnRuntime.giftNodes.delete(id);
  }
}

function syncArenaCanvasSize() {
  const canvas = learnRuntime.elements.slashCanvas;
  const arena = learnRuntime.elements.arena;
  if (!canvas || !arena) return;
  const rect = arena.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function pruneTrails(timestamp) {
  learnRuntime.slashTrails = learnRuntime.slashTrails.filter((trail) => timestamp - trail.createdAt < 420);
}

function drawSlashOverlay() {
  const canvas = learnRuntime.elements.slashCanvas;
  if (!canvas) return;
  syncArenaCanvasSize();
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const trail of learnRuntime.slashTrails) {
    const age = performance.now() - trail.createdAt;
    const alpha = Math.max(0, 1 - age / 420);
    if (trail.points.length < 2 || alpha <= 0) continue;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(126, 249, 255, ${0.5 * alpha})`;
    ctx.shadowColor = `rgba(180, 252, 255, ${0.8 * alpha})`;
    ctx.shadowBlur = 34;
    ctx.lineWidth = 18 * alpha + 6;
    ctx.beginPath();
    trail.points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    trail.points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const progress = trail.points.length <= 1 ? 1 : index / (trail.points.length - 1);
      const radius = (1 - progress * 0.4) * (20 * alpha + 8);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.98 * alpha})`);
      gradient.addColorStop(0.22, `rgba(255, 245, 186, ${0.88 * alpha})`);
      gradient.addColorStop(0.48, `rgba(126, 249, 255, ${0.82 * alpha})`);
      gradient.addColorStop(1, "rgba(126, 249, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * alpha})`;
    ctx.shadowColor = `rgba(255, 255, 255, ${0.7 * alpha})`;
    ctx.shadowBlur = 26;
    ctx.lineWidth = 5 * alpha + 1.5;
    ctx.beginPath();
    trail.points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

async function handleLearnSlash(payload) {
  if (state.screen !== "learn") return;
  learnRuntime.slashTrails.push({
    createdAt: performance.now(),
    points: payload.path
  });

  if (state.isBusy || !learnRuntime.roundActive) return;

  const hitGift = findHitGift(payload.path);
  if (!hitGift) return;

  const timestamp = performance.now();
  hitGift.state = "burst";
  hitGift.hitAt = timestamp;
  learnRuntime.lastHitIndex = hitGift.wordIndex;
  state.learningIndex = hitGift.wordIndex;
  learnRuntime.hitPopup = {
    wordIndex: hitGift.wordIndex,
    expiresAt: timestamp + 900
  };
  collectRoundWord(hitGift.wordIndex);
  playHitWord(words[hitGift.wordIndex]);
  syncArenaDom();
  syncLearnHud();
  syncRoundCollection();
}

function findHitGift(path) {
  let bestGift = null;
  let bestDistance = Infinity;

  for (const gift of learnRuntime.gifts) {
    if (gift.state !== "flying") continue;
    const center = { x: gift.x, y: gift.y };

    for (let i = 1; i < path.length; i += 1) {
      const start = path[i - 1];
      const end = path[i];
      const distanceToGift = pointToSegmentDistance(center, start, end);
      if (distanceToGift <= gift.radius && distanceToGift < bestDistance) {
        bestDistance = distanceToGift;
        bestGift = gift;
      }
    }
  }

  return bestGift;
}

function pointToSegmentDistance(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  if (!segmentX && !segmentY) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / (segmentX ** 2 + segmentY ** 2)));
  const projectionX = start.x + segmentX * t;
  const projectionY = start.y + segmentY * t;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

async function playCurrentLearning() {
  const runId = ++state.runId;
  const current = words[state.learningIndex] || words[0];
  state.isBusy = true;
  if (state.screen === "learn") {
    pauseLearnArena();
    learnRuntime.detector?.setPaused(true);
  }
  render();
  const completed = await speakLearningScript(current);
  if (runId !== state.runId) return;
  if (completed) state.learned.add(current.id);
  state.isBusy = false;
  render();
  if (state.screen === "learn") resumeLearnArena();
}

async function reviewCurrentRound() {
  if (state.screen !== "learn" || state.isBusy || !learnRuntime.collectedOrder.length) return;
  await completeLearnRound();
}

async function completeLearnRound() {
  if (state.screen !== "learn" || state.isBusy) return;
  const reviewQueue = learnRuntime.collectedOrder.slice(0, MAX_REVIEW_WORDS);
  const runId = ++state.runId;
  state.isBusy = true;
  learnRuntime.reviewing = true;
  learnRuntime.roundActive = false;
  pauseLearnArena();
  learnRuntime.detector?.setPaused(true);
  render();

  if (!reviewQueue.length) {
    await wait(900);
    if (runId !== state.runId || state.screen !== "learn") return;
    state.isBusy = false;
    learnRuntime.reviewing = false;
    startNewLearnRound();
    render();
    resumeLearnArena();
    return;
  }

  for (const wordIndex of reviewQueue) {
    if (runId !== state.runId || state.screen !== "learn") return;
    const current = words[wordIndex];
    state.learningIndex = wordIndex;
    syncLearnHud();
    const completed = await speakLearningScript(current);
    if (runId !== state.runId || state.screen !== "learn") return;
    if (completed) state.learned.add(current.id);
  }

  if (runId !== state.runId || state.screen !== "learn") return;
  state.isBusy = false;
  learnRuntime.reviewing = false;
  startNewLearnRound();
  render();
  resumeLearnArena();
}

async function listenForWord() {
  const runId = ++state.runId;
  const current = words[state.quizIndex] || words[0];
  state.isBusy = true;
  state.transcript = "正在听...";
  render();
  try {
    const transcript = await listenOnce();
    const ok = isPronunciationMatch(transcript, current.english);
    if (runId !== state.runId) return;
    state.transcript = `我听到：${transcript}`;
    state.isBusy = false;
    render();
    if (ok) showReward();
    else await speak("再试一次，你可以做到。", { lang: "zh-CN" });
  } catch (error) {
    if (runId !== state.runId) return;
    state.transcript = error.message;
    state.isBusy = false;
    render();
  }
}

async function showReward() {
  const runId = ++state.runId;
  const current = words[state.quizIndex] || words[0];
  stopSpeech();
  state.correct.add(current.id);
  state.isBusy = false;
  state.screen = "reward";
  render();
  if (runId !== state.runId) return;
  await speak(`I am ${current.english}. ${introLine(current)}`, { lang: "en-US", rate: 0.78, style: "reward" });
}

function nextQuiz() {
  state.runId += 1;
  stopSpeech();
  state.isBusy = false;
  state.quizIndex = (state.quizIndex + 1) % words.length;
  state.screen = "quiz";
  state.transcript = "";
  render();
}

async function readSummary() {
  const runId = ++state.runId;
  if (!await speak(`Today we learn about ${words.map((word) => word.english).join(", ")}.`, { lang: "en-US", rate: 0.74, style: "summary" })) return;
  if (runId !== state.runId) return;
  await speak(`今天我们学习了${words.map((word) => word.chinese).join("、")}。`, { lang: "zh-CN", rate: 0.82, style: "summary" });
}

function introLine(word) {
  const lines = {
    apple: "I am red and sweet. I make you smile.",
    banana: "I am yellow and happy. Monkeys like me.",
    cat: "I say meow and walk softly.",
    dog: "I am your friendly puppy. I can wag my tail.",
    ball: "I can bounce, roll, and play with you.",
    car: "I go beep beep and drive on the road.",
    sun: "I shine in the sky and warm the day.",
    moon: "I glow at night and watch your dreams.",
    star: "I twinkle in the sky.",
    fish: "I swim in blue water.",
    bird: "I can fly and sing a little song.",
    flower: "I smell nice and dance in the wind.",
    tree: "I am tall and green. Birds rest in me.",
    book: "I have stories and pictures inside.",
    chair: "You can sit on me when you read.",
    milk: "I am white and yummy.",
    water: "I help you drink and grow.",
    shoes: "I help your feet run and jump.",
    hat: "I sit on your head and look cool.",
    teddy: "I am soft, warm, and ready for a hug."
  };
  return lines[word.id] || `I am ${word.english}.`;
}

function startNewLearnRound() {
  learnRuntime.roundNumber += 1;
  learnRuntime.roundActive = true;
  learnRuntime.roundRemainingMs = ROUND_DURATION_MS;
  learnRuntime.collectedOrder = [];
  learnRuntime.collectedSet = new Set();
  learnRuntime.hitPopup = null;
  learnRuntime.gifts = [];
  learnRuntime.lastSpawnAt = 0;
  learnRuntime.lastTick = 0;
  learnRuntime.slashTrails = [];
  learnRuntime.giftNodes.forEach((node) => node.remove());
  learnRuntime.giftNodes.clear();
  syncArenaDom();
  drawSlashOverlay();
  syncLearnHud();
  syncRoundCollection();
}

function collectRoundWord(wordIndex) {
  if (learnRuntime.collectedSet.has(wordIndex)) return false;
  learnRuntime.collectedSet.add(wordIndex);
  learnRuntime.collectedOrder.push(wordIndex);
  return true;
}

function pruneHitPopup(timestamp) {
  if (!learnRuntime.hitPopup) return;
  if (timestamp < learnRuntime.hitPopup.expiresAt) return;
  learnRuntime.hitPopup = null;
}

function getRoundSecondsLeft() {
  return Math.max(0, Math.ceil(learnRuntime.roundRemainingMs / 1000));
}

function getLearnStageLabel() {
  if (state.isBusy && learnRuntime.reviewing) {
    return `本轮复习中，按顺序学习 ${Math.min(learnRuntime.collectedOrder.length, MAX_REVIEW_WORDS)} 个单词`;
  }
  if (state.isBusy) return "讲解中，礼包暂停飞入";
  if (!learnRuntime.roundActive) return "这一轮结束了，马上进入下一轮。";
  return `${getRoundSecondsLeft()}s 后统一学习本轮词卡`;
}

function syncLearnHud() {
  const current = words[state.learningIndex] || words[0];
  const latestWord = learnRuntime.lastHitIndex == null ? "-" : words[learnRuntime.lastHitIndex].english;

  if (learnRuntime.elements.scoreLearned) learnRuntime.elements.scoreLearned.textContent = String(state.learned.size);
  if (learnRuntime.elements.scoreRound) learnRuntime.elements.scoreRound.textContent = String(learnRuntime.collectedOrder.length);
  if (learnRuntime.elements.scoreLatest) learnRuntime.elements.scoreLatest.textContent = latestWord;
  if (learnRuntime.elements.scoreTimer) learnRuntime.elements.scoreTimer.textContent = `${getRoundSecondsLeft()}s`;
  if (learnRuntime.elements.stageLabel) learnRuntime.elements.stageLabel.textContent = getLearnStageLabel();
  if (learnRuntime.elements.reviewButton) {
    learnRuntime.elements.reviewButton.disabled = state.isBusy || !learnRuntime.collectedOrder.length;
  }
  if (learnRuntime.elements.spotlightCard) {
    learnRuntime.elements.spotlightCard.dataset.word = current.id;
    learnRuntime.elements.spotlightCard.style.setProperty("--card", current.color);
    learnRuntime.elements.spotlightCard.style.setProperty("--accent", current.accent);
    const frame = learnRuntime.elements.spotlightCard.querySelector(".image-frame");
    if (frame) frame.setAttribute("aria-label", `${current.english} image`);
  }
  if (learnRuntime.elements.spotlightEmoji) learnRuntime.elements.spotlightEmoji.textContent = current.emoji;
  if (learnRuntime.elements.spotlightEnglish) learnRuntime.elements.spotlightEnglish.textContent = current.english;
  if (learnRuntime.elements.spotlightChinese) learnRuntime.elements.spotlightChinese.textContent = current.chinese;
  syncHitPopup();
}

function syncRoundCollection() {
  const container = learnRuntime.elements.roundCollection;
  if (!container) return;
  if (!learnRuntime.collectedOrder.length) {
    container.innerHTML = `<div class="round-collection-empty">这一轮先随便挥，切中的单词会收进这里。</div>`;
    return;
  }
  container.innerHTML = learnRuntime.collectedOrder
    .slice(0, MAX_REVIEW_WORDS)
    .map((wordIndex) => compactCard(words[wordIndex], true, true))
    .join("");
}

function syncHitPopup() {
  const popup = learnRuntime.elements.popup;
  if (!popup) return;
  if (!learnRuntime.hitPopup) {
    popup.className = "hit-popup";
    popup.innerHTML = "";
    return;
  }
  const word = words[learnRuntime.hitPopup.wordIndex];
  popup.className = "hit-popup is-visible";
  popup.innerHTML = `<b>${word.english}</b><span>${word.chinese}</span>`;
}

function playHitWord(word) {
  if (!word?.english || state.isBusy) return;
  void speak(word.english, {
    lang: "en-US",
    rate: 0.8,
    style: "learn-hit",
    pause: 40
  }).catch(() => {});
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

render();
