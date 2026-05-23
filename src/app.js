import { words } from "./words.js";
import { createSlashDetector } from "./pose.js";
import { createJumpDetector } from "./jump_pose.js";
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
const ROUND_DURATION_MS = 60000;
const MAX_REVIEW_WORDS = 6;
const JUMP_GIFT_SLOTS = [0.18, 0.5, 0.82];

const learnRuntime = {
  detector: null,
  running: false,
  reviewing: false,
  roundActive: false,
  gameRaf: 0,
  lastTick: 0,
  // 新的匹配学习模式
  matchingMode: true,  // 使用新的匹配模式
  targetEmoji: null,   // 目标 emoji
  currentWordSet: [],   // 当前4张词卡
  correctIndex: -1,     // 正确词卡的索引
  matched: false,      // 是否已匹配成功
  matchResult: null,    // 匹配结果
  // 旧的礼包模式保留（备用）
  nextGiftId: 1,
  spawnCursor: 0,
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
    roundCollection: null,
    // 新的匹配模式元素
    targetEmojiDisplay: null,
    cardContainer: null,
    cardNodes: new Map()
  },
  gestureStatus: "打开摄像头后，屏幕下方有4张词卡，上方有1个emoji，找出对应的那张词卡，大幅挥手臂切中它！",
  debugText: ""
};

// 匹配模式词卡位置配置（屏幕中下方）
const CARD_POSITIONS = [
  { x: 0.18, y: 0.82 },  // 左
  { x: 0.38, y: 0.82 },  // 中左
  { x: 0.62, y: 0.82 },  // 中右
  { x: 0.82, y: 0.82 }   // 右
];

// emoji 显示位置（屏幕中央偏上）
const EMOJI_POSITION = { x: 0.5, y: 0.28 };

const jumpRuntime = {
  detector: null,
  running: false,
  raf: 0,
  lastTick: 0,
  nextWordCursor: 0,
  gifts: [],
  giftNodes: new Map(),
  avatarX: 0.5,
  targetX: 0.5,
  avatarY: 0,
  avatarVelocity: 0,
  pendingGiftId: null,
  activeGiftId: null,
  flashcardWordIndex: null,
  lessonStatus: "站到镜头前，左右移动小人，再跳起来顶礼包。",
  detectorStatus: "我会跟着你移动，跳起来就能顶开奖包。",
  debugText: "",
  elements: {
    stage: null,
    gifts: null,
    avatar: null,
    video: null,
    canvas: null,
    detectorStatus: null,
    debug: null,
    flashcard: null,
    flashcardCard: null,
    flashcardEmoji: null,
    flashcardEnglish: null,
    flashcardChinese: null,
    flashcardStatus: null,
    latest: null
  }
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
        ${tabButton("jump", "跳跳开礼包", "2")}
        ${tabButton("quiz", "听读闯关", "3")}
        ${tabButton("summary", "学习总结", "4")}
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
  if (state.screen === "jump") return renderJump();
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
  // 确保进入页面时初始化词卡
  if (learnRuntime.matchingMode && learnRuntime.currentWordSet.length === 0) {
    generateMatchSet();
  }
  
  const current = words[state.learningIndex] || words[0];
  const latestWord = learnRuntime.lastHitIndex == null ? "-" : words[learnRuntime.lastHitIndex].english;
  const learnedWords = words.filter((word) => state.learned.has(word.id));
  const learnedPreview = (learnedWords.length ? learnedWords : words.slice(0, 6))
    .map((word) => compactCard(word, true, state.learned.has(word.id)))
    .join("");
  
  // 获取匹配模式的词卡
  const matchCardsHtml = learnRuntime.currentWordSet.length > 0
    ? learnRuntime.currentWordSet.map((word, index) => matchingCardHtml(word, index, learnRuntime.correctIndex, learnRuntime.matched)).join("")
    : "<p style='color:#fff;text-align:center;padding:40px;'>加载词卡中...</p>";
  
  // 获取目标 emoji
  const targetEmojiHtml = learnRuntime.targetEmoji 
    ? `<div class="match-target-emoji">${learnRuntime.targetEmoji.emoji}</div>` 
    : `<div class="match-target-emoji">❓</div>`;
  
  // 匹配结果提示
  const matchResultHtml = learnRuntime.matchResult 
    ? `<div class="match-result ${learnRuntime.matchResult.success ? 'is-success' : 'is-fail'}">
        <span class="match-result-emoji">${learnRuntime.matchResult.success ? '🎉' : '❌'}</span>
        <span class="match-result-word">${learnRuntime.matchResult.word.english}</span>
        <span class="match-result-chinese">${learnRuntime.matchResult.word.chinese}</span>
       </div>`
    : "";

  return `
    <section class="learn-layout arcade-learn">
      <div class="learn-stage-head">
        <div>
          <p class="eyebrow">Match To Learn</p>
          <h1>匹配学习</h1>
          <p class="learn-stage-copy">屏幕上方显示一个emoji，下方有4张词卡，找出对应的词卡并大幅挥手臂切中它！</p>
        </div>
        <div class="learn-scoreboard">
          <span><b id="learn-score-learned">${state.learned.size}</b> 已学会</span>
          <span><b>${learnRuntime.matched ? '✓' : '-'}</b> 本轮匹配</span>
        </div>
      </div>

      <div class="learn-arcade-grid learn-arcade-grid--single">
        <section class="arena-panel arena-panel--immersive">
          <div class="wheel-status ${state.isBusy ? "is-busy" : ""}">
            <span class="wheel-status-dot"></span>
            <strong id="learn-stage-label">${getLearnStageLabel()}</strong>
          </div>
          
          <!-- 姿态检测层 + 匹配舞台 -->
          <div class="slash-stage">
            <video id="learn-video" class="hidden-pose-video" autoplay muted playsinline></video>
            <canvas id="learn-overlay" class="pose-stage-overlay"></canvas>
            <canvas id="learn-slash-overlay" class="slash-overlay"></canvas>
            
            <!-- 匹配模式覆盖层 -->
            <div class="match-overlay" id="learn-match-stage">
              <!-- 目标 emoji 区域 -->
              <div class="match-emoji-area">
                ${targetEmojiHtml}
              </div>
              
              <!-- 词卡区域 -->
              <div class="match-cards-area" id="learn-card-container">
                ${matchCardsHtml}
              </div>
              
              <!-- 匹配结果 -->
              ${matchResultHtml}
            </div>
          </div>
          
          <div class="learn-controls">
            <button class="primary" data-action="next-match" ${state.isBusy ? "disabled" : ""}>下一题</button>
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

      <div class="ribbon-grid learned-preview">
        ${learnedPreview}
      </div>
    </section>
  `;
}

// 生成匹配模式的词卡HTML
function matchingCardHtml(word, index, correctIndex, matched) {
  const isCorrect = index === correctIndex;
  const showEmoji = matched && isCorrect;
  return `
    <article class="match-card ${isCorrect && matched ? 'is-correct' : ''}" 
             data-index="${index}" 
             data-word-id="${word.id}"
             style="--card:${word.color};--accent:${word.accent}">
      <div class="match-card-inner">
        ${showEmoji ? `<div class="match-card-emoji">${word.emoji}</div>` : ''}
        <div class="match-card-text">
          <b>${word.english}</b>
          <small>${word.chinese}</small>
        </div>
      </div>
    </article>
  `;
}

function renderJump() {
  const currentIndex = jumpRuntime.flashcardWordIndex ?? jumpRuntime.gifts[0]?.wordIndex ?? 0;
  const current = words[currentIndex] || words[0];
  const latestWord = words[state.learningIndex]?.english || "-";

  return `
    <section class="learn-layout jump-learn">
      <div class="learn-stage-head">
        <div>
          <p class="eyebrow">Jump To Learn</p>
          <h1>跳跳开礼包</h1>
          <p class="learn-stage-copy">上方有 3 个礼包。小朋友左右移动时，动漫小人会跟着走；一跳起来，就能顶开奖包，打开闪卡并进入跟读。</p>
        </div>
        <div class="learn-scoreboard">
          <span><b>${state.learned.size}</b> 已学会</span>
          <span><b>${latestWord}</b> 最新顶开</span>
          <span><b>${words.length}</b> 总词卡</span>
        </div>
      </div>

      <section class="jump-stage-panel">
          <div class="wheel-status ${state.isBusy ? "is-busy" : ""}">
            <span class="wheel-status-dot"></span>
            <strong>${state.isBusy ? "跟读中，小人先暂停一下" : "左右移动小人，跳起来顶开上方礼包"}</strong>
          </div>

          <div id="jump-stage" class="jump-stage">
            <div id="jump-gifts" class="jump-gifts"></div>
            <div id="jump-avatar" class="jump-avatar">
              <div class="jump-avatar-shadow"></div>
              <div class="jump-avatar-body">
                <div class="jump-avatar-head">🧒</div>
                <div class="jump-avatar-torso"></div>
                <div class="jump-avatar-arm left"></div>
                <div class="jump-avatar-arm right"></div>
                <div class="jump-avatar-leg left"></div>
                <div class="jump-avatar-leg right"></div>
              </div>
            </div>
            <article id="jump-flashcard" class="jump-flashcard">
              <div id="jump-flashcard-card" class="spotlight-card jump-flashcard-card" data-word="${current.id}" style="--card:${current.color};--accent:${current.accent}">
                ${cardImage(current, "jump-flashcard-emoji")}
                <div class="word-meta">
                  <p class="eyebrow">Gift Card</p>
                  <h2 id="jump-flashcard-english">${current.english}</h2>
                  <p id="jump-flashcard-chinese">${current.chinese}</p>
                  <div id="jump-flashcard-status" class="status">${jumpRuntime.lessonStatus}</div>
                </div>
              </div>
          </div>

          <div class="learn-controls">
            <button class="secondary" data-action="retry-jump-camera">重新打开摄像头</button>
          </div>

          <small>玩法提示：不用挥手，只要左右移动身体让小人跟着走，再原地跳一下就能顶开奖包。</small>
      </section>

      <aside class="vision-panel jump-camera-panel">
        <div class="vision-frame jump-vision-frame">
          <video id="jump-video" autoplay muted playsinline></video>
          <canvas id="jump-overlay"></canvas>
          <div class="vision-badge">Jump Camera</div>
        </div>
        <div class="vision-copy">
          <p class="eyebrow">Motion Tracking</p>
          <h2>跟随与跳跃识别</h2>
          <p id="jump-detector-status" class="status">${jumpRuntime.detectorStatus}</p>
          <pre id="jump-debug" class="debug-panel">${jumpRuntime.debugText || "等待躯干跟随与跳跃调试数据..."}</pre>
        </div>
      </aside>
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
  if (state.screen === "jump") {
    mountJumpRuntime();
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

  jumpRuntime.elements = {
    stage: null,
    gifts: null,
    avatar: null,
    video: null,
    canvas: null,
    detectorStatus: null,
    debug: null,
    flashcard: null,
    flashcardCard: null,
    flashcardEmoji: null,
    flashcardEnglish: null,
    flashcardChinese: null,
    flashcardStatus: null,
    latest: null
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

function mountJumpRuntime() {
  ensureJumpRuntime();
  jumpRuntime.elements.stage = document.querySelector("#jump-stage");
  jumpRuntime.elements.gifts = document.querySelector("#jump-gifts");
  jumpRuntime.elements.avatar = document.querySelector("#jump-avatar");
  jumpRuntime.elements.video = document.querySelector("#jump-video");
  jumpRuntime.elements.canvas = document.querySelector("#jump-overlay");
  jumpRuntime.elements.detectorStatus = document.querySelector("#jump-detector-status");
  jumpRuntime.elements.debug = document.querySelector("#jump-debug");
  jumpRuntime.elements.flashcard = document.querySelector("#jump-flashcard");
  jumpRuntime.elements.flashcardCard = document.querySelector("#jump-flashcard-card");
  jumpRuntime.elements.flashcardEmoji = document.querySelector("#jump-flashcard-emoji");
  jumpRuntime.elements.flashcardEnglish = document.querySelector("#jump-flashcard-english");
  jumpRuntime.elements.flashcardChinese = document.querySelector("#jump-flashcard-chinese");
  jumpRuntime.elements.flashcardStatus = document.querySelector("#jump-flashcard-status");

  jumpRuntime.detector.attach({
    video: jumpRuntime.elements.video,
    canvas: jumpRuntime.elements.canvas,
    statusElement: jumpRuntime.elements.detectorStatus,
    debugElement: jumpRuntime.elements.debug
  });

  ensureJumpGifts();
  syncJumpScene();
  syncJumpFlashcard();
}

function ensureJumpRuntime() {
  if (jumpRuntime.detector) return;
  jumpRuntime.detector = createJumpDetector({
    onStatus: (message) => {
      jumpRuntime.detectorStatus = message;
    },
    onDebug: (message) => {
      jumpRuntime.debugText = message;
    },
    onTrack: (payload) => {
      handleJumpTrack(payload);
    },
    onJump: (payload) => {
      handleJumpDetected(payload);
    }
  });
}

async function handleAction(action) {
  if (["home", "learn", "jump", "quiz", "summary"].includes(action)) {
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
  if (action === "retry-jump-camera") await retryJumpCamera();
  if (action === "next-match") await nextMatch();
}

function navigateTo(screen) {
  const leavingLearn = state.screen === "learn" && screen !== "learn";
  const leavingJump = state.screen === "jump" && screen !== "jump";
  stopSpeech();
  state.runId += 1;
  state.isBusy = false;
  state.transcript = "";
  if (leavingLearn) stopLearnExperience();
  if (leavingJump) stopJumpExperience();
  state.screen = screen;
  render();
  if (screen === "learn") startLearnExperience();
  if (screen === "jump") startJumpExperience();
}

async function startLearnExperience() {
  ensureLearnRuntime();
  mountLearnRuntime();
  
  // 匹配模式初始化
  if (learnRuntime.matchingMode && learnRuntime.currentWordSet.length === 0) {
    initMatchingMode();
  }
  
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

async function startJumpExperience() {
  ensureJumpRuntime();
  mountJumpRuntime();
  resumeJumpStage();
  await jumpRuntime.detector.start();
}

function stopJumpExperience() {
  pauseJumpStage();
  jumpRuntime.detector?.stop();
  jumpRuntime.giftNodes.forEach((node) => node.remove());
  jumpRuntime.giftNodes.clear();
  jumpRuntime.gifts = [];
  jumpRuntime.activeGiftId = null;
  jumpRuntime.pendingGiftId = null;
  jumpRuntime.flashcardWordIndex = null;
  jumpRuntime.avatarX = 0.5;
  jumpRuntime.targetX = 0.5;
  jumpRuntime.avatarY = 0;
  jumpRuntime.avatarVelocity = 0;
}

async function retryJumpCamera() {
  if (state.screen !== "jump") return;
  ensureJumpRuntime();
  await jumpRuntime.detector.restart();
}

function resumeJumpStage() {
  if (state.screen !== "jump") return;
  ensureJumpGifts();
  jumpRuntime.detector?.setPaused(state.isBusy);
  if (jumpRuntime.running) return;
  jumpRuntime.running = true;
  jumpRuntime.lastTick = performance.now();
  tickJumpStage(jumpRuntime.lastTick);
}

function pauseJumpStage() {
  jumpRuntime.running = false;
  if (jumpRuntime.raf) {
    window.cancelAnimationFrame(jumpRuntime.raf);
    jumpRuntime.raf = 0;
  }
  jumpRuntime.lastTick = 0;
}

function tickJumpStage(timestamp) {
  if (!jumpRuntime.running) return;
  const delta = Math.min(0.033, jumpRuntime.lastTick ? (timestamp - jumpRuntime.lastTick) / 1000 : 0);
  jumpRuntime.lastTick = timestamp;

  jumpRuntime.avatarX += (jumpRuntime.targetX - jumpRuntime.avatarX) * Math.min(1, delta * 8);

  if (jumpRuntime.avatarY > 0 || jumpRuntime.avatarVelocity > 0) {
    jumpRuntime.avatarY += jumpRuntime.avatarVelocity * delta;
    jumpRuntime.avatarVelocity -= 4.6 * delta;

    if (jumpRuntime.pendingGiftId && jumpRuntime.avatarY > 0.17) {
      const gift = jumpRuntime.gifts.find((item) => item.id === jumpRuntime.pendingGiftId);
      if (gift?.state === "closed") {
        void openJumpGift(gift);
      }
    }

    if (jumpRuntime.avatarY <= 0) {
      jumpRuntime.avatarY = 0;
      jumpRuntime.avatarVelocity = 0;
      jumpRuntime.pendingGiftId = null;
    }
  }

  syncJumpScene();
  jumpRuntime.raf = window.requestAnimationFrame((nextTimestamp) => tickJumpStage(nextTimestamp));
}

function ensureJumpGifts() {
  if (jumpRuntime.gifts.length) return;
  jumpRuntime.gifts = JUMP_GIFT_SLOTS.map((x, slot) => createJumpGift(slot, x));
}

function createJumpGift(slot, x) {
  const wordIndex = jumpRuntime.nextWordCursor % words.length;
  jumpRuntime.nextWordCursor += 1;
  return {
    id: `jump-gift-${slot}`,
    slot,
    x,
    wordIndex,
    state: "closed",
    openedAt: 0
  };
}

function replaceJumpGiftWord(gift) {
  gift.wordIndex = jumpRuntime.nextWordCursor % words.length;
  jumpRuntime.nextWordCursor += 1;
  gift.state = "closed";
  gift.openedAt = 0;
}

function handleJumpTrack(payload) {
  if (state.screen !== "jump") return;
  jumpRuntime.targetX = clamp(payload.x, 0.12, 0.88);
}

function handleJumpDetected(payload) {
  if (state.screen !== "jump" || state.isBusy) return;
  jumpRuntime.targetX = clamp(payload.x, 0.12, 0.88);
  if (jumpRuntime.avatarY > 0.04) return;
  jumpRuntime.avatarVelocity = 1.45;
  jumpRuntime.pendingGiftId = findJumpTargetGiftId(jumpRuntime.targetX);
}

function findJumpTargetGiftId(targetX) {
  let bestGift = null;
  let bestDistance = Infinity;
  for (const gift of jumpRuntime.gifts) {
    if (gift.state !== "closed") continue;
    const distanceToGift = Math.abs(gift.x - targetX);
    if (distanceToGift < 0.18 && distanceToGift < bestDistance) {
      bestGift = gift;
      bestDistance = distanceToGift;
    }
  }
  return bestGift?.id || null;
}

async function openJumpGift(gift) {
  if (state.screen !== "jump" || state.isBusy || gift.state !== "closed") return;
  const runId = ++state.runId;
  const word = words[gift.wordIndex];
  gift.state = "open";
  gift.openedAt = performance.now();
  jumpRuntime.activeGiftId = gift.id;
  jumpRuntime.pendingGiftId = null;
  jumpRuntime.flashcardWordIndex = gift.wordIndex;
  jumpRuntime.lessonStatus = `${word.english}，${word.chinese}`;
  jumpRuntime.detector?.setPaused(true);
  state.learningIndex = gift.wordIndex;
  state.isBusy = true;
  syncJumpScene();
  syncJumpFlashcard();

  await wait(260);
  if (runId !== state.runId || state.screen !== "jump") return;

  try {
    await speak(word.english, { lang: "en-US", rate: 0.8, style: "jump-hit", pause: 80 });
    if (runId !== state.runId || state.screen !== "jump") return;
    jumpRuntime.lessonStatus = `跟我读：${word.english}`;
    syncJumpFlashcard();
    await speak(`Now say ${word.english}`, { lang: "en-US", rate: 0.78, style: "jump-repeat" });
    if (runId !== state.runId || state.screen !== "jump") return;

    if (!canListen()) {
      jumpRuntime.lessonStatus = "这个浏览器不支持录音，我们先继续下一次跳跃。";
      syncJumpFlashcard();
      await wait(900);
    } else {
      jumpRuntime.lessonStatus = `请大声读出 ${word.english}`;
      syncJumpFlashcard();
      const transcript = await listenOnce();
      if (runId !== state.runId || state.screen !== "jump") return;
      const ok = isPronunciationMatch(transcript, word.english);
      jumpRuntime.lessonStatus = ok ? `太棒了，你读对了：${transcript}` : `我听到：${transcript || "没有听清"}，下次再试一次。`;
      if (ok) {
        state.learned.add(word.id);
        state.correct.add(word.id);
        await speak("Great job!", { lang: "en-US", rate: 0.82, style: "reward" });
      } else {
        await speak("再跳一次，我们继续。", { lang: "zh-CN", rate: 0.84, style: "jump-encourage" });
      }
    }
  } catch (error) {
    if (runId !== state.runId || state.screen !== "jump") return;
    jumpRuntime.lessonStatus = error?.message || "这次没有成功读出来，我们继续下一轮。";
    syncJumpFlashcard();
    await wait(900);
  }

  if (runId !== state.runId || state.screen !== "jump") return;
  replaceJumpGiftWord(gift);
  jumpRuntime.activeGiftId = null;
  jumpRuntime.flashcardWordIndex = null;
  jumpRuntime.lessonStatus = "继续左右移动，再跳起来顶下一个礼包。";
  state.isBusy = false;
  jumpRuntime.detector?.setPaused(false);
  syncJumpScene();
  syncJumpFlashcard();
}

function syncJumpScene() {
  const giftsContainer = jumpRuntime.elements.gifts;
  if (giftsContainer) {
    const presentIds = new Set();
    for (const gift of jumpRuntime.gifts) {
      presentIds.add(gift.id);
      let node = jumpRuntime.giftNodes.get(gift.id);
      if (!node) {
        node = document.createElement("article");
        node.className = "jump-gift";
        node.innerHTML = `
          <div class="jump-gift-core">
            <span class="jump-gift-icon"></span>
            <b class="jump-gift-title"></b>
            <small class="jump-gift-sub"></small>
          </div>
        `;
        giftsContainer.appendChild(node);
        jumpRuntime.giftNodes.set(gift.id, node);
      }
      const word = words[gift.wordIndex];
      node.className = `jump-gift is-${gift.state}`;
      node.style.left = `${gift.x * 100}%`;
      node.style.setProperty("--gift", word.color);
      node.style.setProperty("--accent", word.accent);
      node.querySelector(".jump-gift-icon").textContent = gift.state === "open" ? word.emoji : PACKAGE_ICONS[gift.slot % PACKAGE_ICONS.length];
      node.querySelector(".jump-gift-title").textContent = gift.state === "open" ? word.english : "Jump";
      node.querySelector(".jump-gift-sub").textContent = gift.state === "open" ? word.chinese : "Hit me";
    }

    for (const [id, node] of Array.from(jumpRuntime.giftNodes.entries())) {
      if (presentIds.has(id)) continue;
      node.remove();
      jumpRuntime.giftNodes.delete(id);
    }
  }

  const avatar = jumpRuntime.elements.avatar;
  const stage = jumpRuntime.elements.stage;
  if (avatar && stage) {
    const height = Math.max(320, stage.clientHeight || 0);
    avatar.style.left = `${jumpRuntime.avatarX * 100}%`;
    avatar.style.transform = `translate(-50%, ${-jumpRuntime.avatarY * height}px)`;
    avatar.classList.toggle("is-jumping", jumpRuntime.avatarY > 0.02);
  }
}

function syncJumpFlashcard() {
  const flashcard = jumpRuntime.elements.flashcard;
  const wordIndex = jumpRuntime.flashcardWordIndex;
  if (!flashcard || wordIndex == null) {
    if (flashcard) flashcard.classList.remove("is-visible");
    return;
  }

  const word = words[wordIndex];
  flashcard.classList.add("is-visible");
  if (jumpRuntime.elements.flashcardCard) {
    jumpRuntime.elements.flashcardCard.dataset.word = word.id;
    jumpRuntime.elements.flashcardCard.style.setProperty("--card", word.color);
    jumpRuntime.elements.flashcardCard.style.setProperty("--accent", word.accent);
    const frame = jumpRuntime.elements.flashcardCard.querySelector(".image-frame");
    if (frame) frame.setAttribute("aria-label", `${word.english} image`);
  }
  if (jumpRuntime.elements.flashcardEmoji) jumpRuntime.elements.flashcardEmoji.textContent = word.emoji;
  if (jumpRuntime.elements.flashcardEnglish) jumpRuntime.elements.flashcardEnglish.textContent = word.english;
  if (jumpRuntime.elements.flashcardChinese) jumpRuntime.elements.flashcardChinese.textContent = word.chinese;
  if (jumpRuntime.elements.flashcardStatus) jumpRuntime.elements.flashcardStatus.textContent = jumpRuntime.lessonStatus;
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

// ============== 匹配模式核心逻辑 ==============

// 生成4张随机词卡，其中1张正确
function generateMatchSet() {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const correctWord = shuffled[0];
  const wordSet = shuffled.slice(0, 4);
  const correctIndex = 0; // 第一张是正确答案
  
  // 打乱顺序
  for (let i = wordSet.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wordSet[i], wordSet[j]] = [wordSet[j], wordSet[i]];
  }
  
  // 找到正确词卡的新位置
  const newCorrectIndex = wordSet.findIndex(w => w.id === correctWord.id);
  
  learnRuntime.targetEmoji = correctWord;
  learnRuntime.currentWordSet = wordSet;
  learnRuntime.correctIndex = newCorrectIndex;
  learnRuntime.matched = false;
  learnRuntime.matchResult = null;
}

// 初始化匹配模式
function initMatchingMode() {
  if (learnRuntime.currentWordSet.length === 0) {
    generateMatchSet();
  }
}

// 处理匹配挥砍
async function handleMatchSlash(payload) {
  const hitCardIndex = findHitCardIndex(payload.path);
  if (hitCardIndex === -1 || learnRuntime.matched) return;
  
  const hitWord = learnRuntime.currentWordSet[hitCardIndex];
  const correctWord = learnRuntime.targetEmoji;
  const isCorrect = hitWord.id === correctWord.id;
  
  learnRuntime.matchResult = {
    success: isCorrect,
    word: hitWord,
    index: hitCardIndex
  };
  
  if (isCorrect) {
    learnRuntime.matched = true;
    state.learned.add(correctWord.id);
    
    // 显示匹配成功动画
    render();
    
    // 播放匹配成功语音（重复两遍）
    state.isBusy = true;
    await playMatchSuccessAudio(correctWord);
    state.isBusy = false;
  } else {
    // 错误选择，提示并重新生成
    await speak("再试一次，找出对应的词卡！", { lang: "zh-CN", rate: 0.85 });
    learnRuntime.matchResult = null;
  }
}

// 播放匹配成功语音（重复两遍）然后自动下一题
async function playMatchSuccessAudio(word) {
  const runId = state.runId;
  
  // 第一次：说出单词
  await speak(word.english, { lang: "en-US", rate: 0.78, style: "reward", pause: 100 });
  if (runId !== state.runId) return;
  
  // 第二次：再次说出单词
  await speak(word.english, { lang: "en-US", rate: 0.82, style: "reward", pause: 80 });
  if (runId !== state.runId) return;
  
  // 最后说出中文
  await speak(word.chinese, { lang: "zh-CN", rate: 0.85, pause: 50 });
  if (runId !== state.runId) return;
  
  // 停留0.75秒
  await wait(750);
  if (runId !== state.runId) return;
  
  // 自动下一题
  generateMatchSet();
  render();
}

// 查找命中的词卡
function findHitCardIndex(path) {
  const cardContainer = document.querySelector("#learn-card-container");
  if (!cardContainer) return -1;
  
  const cards = cardContainer.querySelectorAll(".match-card");
  if (cards.length === 0) return -1;
  
  let bestIndex = -1;
  let bestDistance = Infinity;
  
  cards.forEach((card, index) => {
    const rect = card.getBoundingClientRect();
    const containerRect = cardContainer.getBoundingClientRect();
    
    // 计算词卡中心点（相对于容器的比例）
    const cardCenterX = (rect.left - containerRect.left + rect.width / 2) / containerRect.width;
    const cardCenterY = (rect.top - containerRect.top + rect.height / 2) / containerRect.height;
    
    // 检查路径是否与词卡相交
    for (let i = 1; i < path.length; i += 1) {
      const start = path[i - 1];
      const end = path[i];
      const distance = pointToSegmentDistance(
        { x: cardCenterX, y: cardCenterY },
        start,
        end
      );
      
      // 词卡命中半径（约0.12）
      if (distance < 0.12 && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  });
  
  return bestIndex;
}

// 下一题
async function nextMatch() {
  if (state.isBusy) return;
  state.runId++;
  generateMatchSet();
  render();
}

// ============== 原有挥砍处理（保留兼容） ==============

async function handleLearnSlash(payload) {
  if (state.screen !== "learn") return;
  learnRuntime.slashTrails.push({
    createdAt: performance.now(),
    points: payload.path
  });

  // 匹配模式处理
  if (learnRuntime.matchingMode) {
    await handleMatchSlash(payload);
    return;
  }

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

render();
