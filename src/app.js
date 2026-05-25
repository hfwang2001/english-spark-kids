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
  runId: 0,
  jumpMastered: new Set(),  // 记录"跳跳开礼包"中成功拼对的单词ID
  jumpRoundCount: 0,         // 当前跳跳环节已完成的单词数
  learnRoundCount: 0,       // 当前背单词环节已完成的词数
  cyclePhase: "jump",        // 当前循环阶段：jump 或 learn
  allWordsLearned: false    // 是否所有单词都已学习
};

const ACTIVE_WORD_IDS = ["apple", "banana", "cat"];
const ACTIVE_WORDS = ACTIVE_WORD_IDS
  .map((id) => words.find((word) => word.id === id))
  .filter(Boolean);
const ACTIVE_WORD_ID_SET = new Set(ACTIVE_WORDS.map((word) => word.id));
const PACKAGE_ICONS = ["🎁", "🎀", "📦", "🎉", "🪅", "🎊"];
const ROUND_DURATION_MS = 60000;
const MAX_REVIEW_WORDS = 6;
const JUMP_MAX_LETTERS = 6;
const ROUND_WORD_COUNT = ACTIVE_WORDS.length;
const TOTAL_WORDS = ACTIVE_WORDS.length;
const JUMP_OPENING_VIDEO = assetHref("../word-video-assets/01-opening.mp4");
const JUMP_CUSTOM_MEDIA = {
  apple: [
    assetHref("../word-video-assets/apple/02-girl-apple.mp4"),
    assetHref("../word-video-assets/apple/03-boy-apple.mp4"),
    assetHref("../word-video-assets/apple/04-help-child-apple.mp4"),
    assetHref("../word-video-assets/apple/05-kid-apple-costume.mp4"),
    assetHref("../word-video-assets/apple/06-apple-bits-table.mp4"),
    assetHref("../word-video-assets/apple/07-cool-apple.mp4")
  ],
  banana: [
    assetHref("../word-video-assets/banana/02-girl-banana.mp4"),
    assetHref("../word-video-assets/banana/03-boy-banana.mp4"),
    assetHref("../word-video-assets/banana/04-help-child.mp4"),
    assetHref("../word-video-assets/banana/05-kid-banana-costume-rerun.mp4"),
    assetHref("../word-video-assets/banana/06-banana-bits-table.mp4"),
    assetHref("../word-video-assets/banana/07-cool-banana-fullbody.mp4")
  ],
  cat: [
    assetHref("../word-video-assets/cat/02-girl-cat.mp4"),
    assetHref("../word-video-assets/cat/03-boy-cat.mp4"),
    assetHref("../word-video-assets/cat/04-help-child-cat.mp4"),
    assetHref("../word-video-assets/cat/05-kid-cat-costume.mp4"),
    assetHref("../word-video-assets/cat/06-little-cat-play.mp4"),
    assetHref("../word-video-assets/cat/07-cool-cat.mp4")
  ]
};
const ALPHABET_PNG = Object.fromEntries(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => [
    letter,
    assetHref(`../alphabet/png/${letter}.png`)
  ])
);
const ALPHABET_GIF = Object.fromEntries(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => [
    letter,
    assetHref(`../alphabet/gif/${letter}.gif`)
  ])
);
const JUMP_AVATAR_GIF = assetHref("../stella-spring-rider/stella-spring-rider-transparent.gif");

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
  currentWordSet: [],   // 当前匹配词卡
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
  currentWordIndex: null,
  currentSpelling: "",
  currentLetterIndex: 0,
  promptTimer: 0,
  promptVersion: 0,
  gifts: [],
  giftNodes: new Map(),
  avatarX: 0.5,
  targetX: 0.5,
  avatarY: 0,
  avatarVelocity: 0,
  pendingGiftId: null,
  activeGiftId: null,
  flashcardWordIndex: null,
  mediaVisible: false,
  mediaTitle: "",
  mediaStatus: "",
  mediaToken: 0,
  lessonStatus: "站到镜头前，左右移动小人，再跳起来顶礼包。",
  detectorStatus: "我会跟着你移动，跳起来就能顶开奖包。",
  debugText: "",
  elements: {
    stage: null,
    gifts: null,
    avatar: null,
    avatarImage: null,
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
    mediaLayer: null,
    mediaVideo: null,
    mediaTitle: null,
    mediaStatus: null,
    latest: null
  }
};

const jumpWordPool = ACTIVE_WORDS
  .map((word, index) => ({
    index: words.findIndex((item) => item.id === word.id),
    spelling: normalizeJumpWord(word.english)
  }))
  .filter((entry) => entry.spelling && entry.spelling.length <= JUMP_MAX_LETTERS);

const app = document.querySelector("#app");

function render() {
  app.innerHTML = `
    <main class="shell screen-${state.screen}">
      ${state.screen === "complete" ? "" : renderHeader()}
      ${renderScreen()}
    </main>
  `;
  bindEvents();
  syncScreenRuntime();
}

function renderHeader() {
  const progress = Math.round((getActiveLearnedCount() / TOTAL_WORDS) * 100);
  return `
    <header class="topbar">
      <button class="brand" data-action="home" aria-label="返回首页">
        <span class="brand-mark">Aa</span>
        <span>English Spark</span>
      </button>
      <nav class="tabs" aria-label="游戏步骤">
        ${tabButton("jump", "跳跳开礼包", "1")}
        ${tabButton("learn", "背单词", "2")}
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
  if (state.screen === "complete") return renderComplete();
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
        <p class="hero-sub">${TOTAL_WORDS} words. Jump, match, repeat.</p>
        <div class="hero-actions">
          <button class="primary" data-action="jump">开始学习</button>
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
  const learnedWords = ACTIVE_WORDS.filter((word) => state.learned.has(word.id));
  const learnedPreview = (learnedWords.length ? learnedWords : ACTIVE_WORDS.slice(0, 3))
    .map((word) => compactCard(word, true, state.learned.has(word.id)))
    .join("");
  
  // 获取匹配模式的词卡
  const masteredCount = getActiveJumpMasteredCount();
  const matchCardsHtml = learnRuntime.currentWordSet.length > 0
    ? learnRuntime.currentWordSet.map((word, index) => matchingCardHtml(word, index, learnRuntime.correctIndex, learnRuntime.matched)).join("")
    : `<div style="color:#7ef9ff;text-align:center;padding:60px;background:rgba(126,249,255,0.1);border-radius:20px;margin:20px;">
        <p style="font-size:24px;margin:0 0 16px;">🎯 先完成"跳跳开礼包"</p>
        <p style="font-size:16px;margin:0;opacity:0.8;">完成字母拼读后，这里会出现对应单词的匹配题</p>
        <p style="font-size:14px;margin:20px 0 0;opacity:0.6;">已掌握: ${masteredCount} 个单词</p>
       </div>`;
  
  // 获取目标 emoji
  const targetEmojiHtml = learnRuntime.targetEmoji 
    ? `<div class="match-target-emoji">${learnRuntime.targetEmoji.emoji}</div>` 
    : masteredCount > 0 
      ? `<div class="match-target-emoji" style="opacity:0.3;">🎯</div>` 
      : `<div class="match-target-emoji" style="opacity:0.3;">🔒</div>`;
  
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
          <p class="learn-stage-copy">屏幕上方显示一个emoji，下方会出现 4 张词卡，找出对应的词卡并大幅挥手臂切中它！</p>
        </div>
        <div class="learn-scoreboard">
          <span><b id="learn-score-learned">${getActiveLearnedCount()}</b> 已学会</span>
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
  const currentIndex = jumpRuntime.flashcardWordIndex ?? jumpRuntime.currentWordIndex ?? 0;
  const current = words[currentIndex] || words[0];
  const latestWord = jumpRuntime.currentWordIndex == null ? "-" : words[jumpRuntime.currentWordIndex]?.english || "-";
  const targetLetter = getCurrentJumpTargetLetter()?.toUpperCase() || "-";
  const progressText = formatJumpProgress();

  return `
    <section class="learn-layout jump-learn">
      <div class="learn-stage-head">
        <div>
          <p class="eyebrow">Jump To Learn</p>
          <h1>跳跳开礼包</h1>
          <p class="learn-stage-copy">上方每个礼包代表一个字母。系统会按顺序播报字母，小朋友跳起来顶对对应礼包，直到把整个单词拼出来，再进入闪卡学习。</p>
        </div>
        <div class="learn-scoreboard">
          <span><b>${getActiveLearnedCount()}</b> 已学会</span>
          <span><b>${latestWord}</b> 当前单词</span>
          <span><b>${targetLetter}</b> 当前字母</span>
          <span><b>${progressText}</b> 拼写进度</span>
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
              <img class="jump-avatar-image" src="${JUMP_AVATAR_GIF}" alt="Stella spring rider" />
            </div>
            <div id="jump-media-layer" class="jump-media-layer">
              <video id="jump-media-video" class="jump-media-video" playsinline preload="auto"></video>
              <div class="jump-media-copy">
                <p id="jump-media-title" class="eyebrow">${jumpRuntime.mediaTitle || "Jump Story"}</p>
                <strong id="jump-media-status">${jumpRuntime.mediaStatus || "准备播放新素材..."}</strong>
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
            </article>
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

function renderComplete() {
  return `
    <section class="summary-layout">
      <div class="summary-head">
        <p class="eyebrow">Great Job</p>
        <h1>恭喜你！</h1>
        <p class="learn-stage-copy">今天学到了以下单词：${ACTIVE_WORDS.map((word) => word.english).join("、")}</p>
        <button class="primary" data-action="complete-home">返回首页</button>
      </div>
      <div class="summary-grid">
        ${ACTIVE_WORDS.map((word) => compactCard(word, true, true)).join("")}
      </div>
    </section>
  `;
}

function renderSummary() {
  const learned = getActiveLearnedCount() || TOTAL_WORDS;
  return `
    <section class="summary-layout">
      <div class="summary-head">
        <p class="eyebrow">Learning report</p>
        <h1>Today we learned ${TOTAL_WORDS} words</h1>
        <div class="summary-stats">
          <span><b>${learned}</b> learned</span>
          <span><b>${state.correct.size}</b> spoken well</span>
          <span><b>${TOTAL_WORDS}</b> cards</span>
        </div>
        <button class="primary" data-action="read-summary">播放总结</button>
      </div>
      <div class="summary-grid">
        ${ACTIVE_WORDS.map((word) => compactCard(word, true)).join("")}
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
    avatarImage: null,
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
    mediaLayer: null,
    mediaVideo: null,
    mediaTitle: null,
    mediaStatus: null,
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
  jumpRuntime.elements.avatarImage = document.querySelector(".jump-avatar-image");
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
  jumpRuntime.elements.mediaLayer = document.querySelector("#jump-media-layer");
  jumpRuntime.elements.mediaVideo = document.querySelector("#jump-media-video");
  jumpRuntime.elements.mediaTitle = document.querySelector("#jump-media-title");
  jumpRuntime.elements.mediaStatus = document.querySelector("#jump-media-status");

  jumpRuntime.detector.attach({
    video: jumpRuntime.elements.video,
    canvas: jumpRuntime.elements.canvas,
    statusElement: jumpRuntime.elements.detectorStatus,
    debugElement: jumpRuntime.elements.debug
  });

  syncJumpScene();
  syncJumpFlashcard();
  syncJumpMediaLayer();
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
  if (action === "complete-home") {
    resetLearningJourney();
    navigateTo("home");
    return;
  }
  if (["home", "learn", "jump", "quiz", "summary"].includes(action)) {
    if (action === "jump" && state.screen === "home" && state.allWordsLearned) {
      resetLearningJourney();
    }
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
  jumpRuntime.lessonStatus = "先看一段开场视频，马上进入跳跳开礼包。";
  syncJumpFlashcard();
  const introPlayed = await playJumpOpening();
  if (!introPlayed || state.screen !== "jump") return;
  await jumpRuntime.detector.start();
  if (state.screen !== "jump") return;
  ensureJumpWordRound();
  resumeJumpStage();
}

function stopJumpExperience() {
  pauseJumpStage();
  jumpRuntime.detector?.stop();
  cancelJumpPrompt();
  cancelJumpMediaPlayback();
  jumpRuntime.giftNodes.forEach((node) => node.remove());
  jumpRuntime.giftNodes.clear();
  jumpRuntime.gifts = [];
  jumpRuntime.activeGiftId = null;
  jumpRuntime.pendingGiftId = null;
  jumpRuntime.flashcardWordIndex = null;
  jumpRuntime.mediaVisible = false;
  jumpRuntime.mediaTitle = "";
  jumpRuntime.mediaStatus = "";
  jumpRuntime.currentWordIndex = null;
  jumpRuntime.currentSpelling = "";
  jumpRuntime.currentLetterIndex = 0;
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
  ensureJumpWordRound();
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
        void handleJumpGiftSelection(gift);
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

function ensureJumpWordRound() {
  if (jumpRuntime.currentWordIndex != null && jumpRuntime.gifts.length) return;
  setupNextJumpWord();
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
    if (gift.state === "used") continue;
    const distanceToGift = Math.abs(gift.x - targetX);
    if (distanceToGift < 0.18 && distanceToGift < bestDistance) {
      bestGift = gift;
      bestDistance = distanceToGift;
    }
  }
  return bestGift?.id || null;
}

async function handleJumpGiftSelection(gift) {
  if (state.screen !== "jump" || state.isBusy || !gift) return;
  jumpRuntime.pendingGiftId = null;
  jumpRuntime.activeGiftId = gift.id;
  const expectedLetter = getCurrentJumpTargetLetter();
  if (!expectedLetter) return;

  if (gift.letter !== expectedLetter) {
    jumpRuntime.lessonStatus = `还不是 ${gift.letter.toUpperCase()}，继续找 ${expectedLetter.toUpperCase()}。`;
    gift.state = "wrong";
    gift.openedAt = performance.now();
    syncJumpScene();
    queueJumpLetterPrompt(260);
    return;
  }

  gift.state = "correct";
  gift.openedAt = performance.now();
  jumpRuntime.lessonStatus = `答对了，这是 ${gift.letter.toUpperCase()}。`;
  jumpRuntime.currentLetterIndex += 1;
  syncJumpScene();

  if (jumpRuntime.currentLetterIndex < jumpRuntime.currentSpelling.length) {
    queueJumpLetterPrompt(260);
    return;
  }

  await completeJumpSpellingWord();
}

function setupNextJumpWord() {
  const entry = jumpWordPool[jumpRuntime.nextWordCursor % jumpWordPool.length] || jumpWordPool[0];
  jumpRuntime.nextWordCursor = (jumpRuntime.nextWordCursor + 1) % Math.max(1, jumpWordPool.length);
  jumpRuntime.currentWordIndex = entry.index;
  jumpRuntime.currentSpelling = entry.spelling;
  jumpRuntime.currentLetterIndex = 0;
  jumpRuntime.flashcardWordIndex = null;
  jumpRuntime.activeGiftId = null;
  jumpRuntime.pendingGiftId = null;
  jumpRuntime.lessonStatus = `先听字母，再跳起来顶对礼包。`;

  const uniqueLetters = shuffleLetters(Array.from(new Set(entry.spelling.split(""))));
  const slots = computeJumpGiftSlots(uniqueLetters.length);
  jumpRuntime.gifts = uniqueLetters.map((letter, index) => ({
    id: `jump-gift-${index}-${letter}`,
    slot: index,
    x: slots[index],
    letter,
    state: "closed",
    openedAt: 0
  }));

  jumpRuntime.giftNodes.forEach((node) => node.remove());
  jumpRuntime.giftNodes.clear();
  syncJumpScene();
  syncJumpFlashcard();
  queueJumpLetterPrompt(420);
}

function queueJumpLetterPrompt(delay = 0) {
  cancelJumpPrompt();
  resetJumpGiftVisualStates();
  const version = ++jumpRuntime.promptVersion;
  jumpRuntime.promptTimer = window.setTimeout(() => {
    jumpRuntime.promptTimer = 0;
    void playJumpLetterPrompt(version);
  }, delay);
}

async function playJumpLetterPrompt(version) {
  if (state.screen !== "jump" || state.isBusy) return;
  if (version !== jumpRuntime.promptVersion) return;
  const letter = getCurrentJumpTargetLetter();
  if (!letter) return;

  jumpRuntime.lessonStatus = `请跳起来顶字母 ${letter.toUpperCase()}`;
  syncJumpScene();
  syncJumpFlashcard();

  try {
    await speak(repeatJumpLetter(letter), {
      lang: "en-US",
      rate: 0.72,
      style: "jump-letter",
      pause: 80
    });
  } catch {}

  if (state.screen !== "jump" || state.isBusy) return;
  if (version !== jumpRuntime.promptVersion) return;
  if (getCurrentJumpTargetLetter() !== letter) return;
  queueJumpLetterPrompt(1100);
}

function cancelJumpPrompt() {
  jumpRuntime.promptVersion += 1;
  if (jumpRuntime.promptTimer) {
    window.clearTimeout(jumpRuntime.promptTimer);
    jumpRuntime.promptTimer = 0;
  }
}

function cancelJumpMediaPlayback() {
  jumpRuntime.mediaToken += 1;
  jumpRuntime.mediaVisible = false;
  jumpRuntime.mediaTitle = "";
  jumpRuntime.mediaStatus = "";
  const video = jumpRuntime.elements.mediaVideo;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  syncJumpMediaLayer();
}

async function playJumpOpening() {
  jumpRuntime.mediaTitle = "Jump Story";
  jumpRuntime.mediaStatus = "开场视频播放中...";
  syncJumpMediaLayer();
  return playJumpMediaSequence([JUMP_OPENING_VIDEO], {
    title: "Jump Story",
    statusPrefix: "开场动画"
  });
}

function getJumpCustomMedia(word) {
  const key = normalizeJumpWord(word?.english || "");
  return JUMP_CUSTOM_MEDIA[key] || null;
}

async function playJumpWordMedia(word, mediaSources, runId) {
  jumpRuntime.lessonStatus = `${word.english} 新素材播放中...`;
  syncJumpFlashcard();
  const finished = await playJumpMediaSequence(mediaSources, {
    title: `${word.english.toUpperCase()} Story`,
    statusPrefix: word.english
  });
  if (!finished || runId !== state.runId || state.screen !== "jump") return false;
  jumpRuntime.lessonStatus = `${word.english} 播放完成。`;
  syncJumpFlashcard();
  return true;
}

async function playJumpMediaSequence(sources, { title, statusPrefix } = {}) {
  const video = jumpRuntime.elements.mediaVideo;
  if (!video || !sources?.length) return false;

  cancelJumpMediaPlayback();
  const token = jumpRuntime.mediaToken;
  jumpRuntime.mediaVisible = true;
  jumpRuntime.mediaTitle = title || "Jump Story";
  syncJumpMediaLayer();

  for (let index = 0; index < sources.length; index += 1) {
    if (token !== jumpRuntime.mediaToken || state.screen !== "jump") return false;
    jumpRuntime.mediaStatus = `${statusPrefix || "素材"} ${index + 1}/${sources.length}`;
    syncJumpMediaLayer();
    const played = await playJumpMediaClip(video, sources[index], token);
    if (!played) return false;
  }

  if (token !== jumpRuntime.mediaToken || state.screen !== "jump") return false;
  jumpRuntime.mediaVisible = false;
  jumpRuntime.mediaStatus = "";
  syncJumpMediaLayer();
  return true;
}

function playJumpMediaClip(video, source, token) {
  return new Promise((resolve) => {
    const finish = (result) => {
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      resolve(result);
    };
    const handleEnded = () => finish(token === jumpRuntime.mediaToken && state.screen === "jump");
    const handleError = () => finish(false);

    video.pause();
    video.currentTime = 0;
    video.src = source;
    video.load();
    video.addEventListener("ended", handleEnded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.play().catch(() => finish(false));
  });
}

function resetJumpGiftVisualStates() {
  for (const gift of jumpRuntime.gifts) {
    gift.state = "closed";
    gift.openedAt = 0;
  }
  syncJumpScene();
}

async function completeJumpSpellingWord() {
  if (state.screen !== "jump" || state.isBusy || jumpRuntime.currentWordIndex == null) return;
  cancelJumpPrompt();
  const runId = ++state.runId;
  const word = words[jumpRuntime.currentWordIndex];
  const customMedia = getJumpCustomMedia(word);
  jumpRuntime.flashcardWordIndex = customMedia ? null : jumpRuntime.currentWordIndex;
  jumpRuntime.lessonStatus = customMedia ? `拼对了 ${word.english}，开始播放新素材。` : `${word.english}，${word.chinese}`;
  state.learningIndex = jumpRuntime.currentWordIndex;
  state.isBusy = true;
  jumpRuntime.detector?.setPaused(true);
  syncJumpScene();
  syncJumpFlashcard();

  await wait(280);
  if (runId !== state.runId || state.screen !== "jump") return;

  try {
    if (customMedia?.length) {
      const played = await playJumpWordMedia(word, customMedia, runId);
      if (!played || runId !== state.runId || state.screen !== "jump") return;
      state.learned.add(word.id);
      state.correct.add(word.id);
      state.jumpMastered.add(word.id);
      jumpRuntime.lessonStatus = `${word.english} 学完了，继续下一个单词。`;
      syncJumpFlashcard();
      await wait(260);
    } else {
    await speak(word.english, { lang: "en-US", rate: 0.8, style: "jump-hit", pause: 100 });
    if (runId !== state.runId || state.screen !== "jump") return;
    jumpRuntime.lessonStatus = `跟我读：${word.english}`;
    syncJumpFlashcard();
    await speak(`Now say ${word.english}`, { lang: "en-US", rate: 0.78, style: "jump-repeat" });
    if (runId !== state.runId || state.screen !== "jump") return;

    if (!canListen()) {
      jumpRuntime.lessonStatus = "这个浏览器不支持录音，我们先继续下一个单词。";
      syncJumpFlashcard();
      await wait(900);
    } else {
      jumpRuntime.lessonStatus = `请大声读出 ${word.english}`;
      syncJumpFlashcard();
      const transcript = await listenOnce();
      if (runId !== state.runId || state.screen !== "jump") return;
      const ok = isPronunciationMatch(transcript, word.english);
      jumpRuntime.lessonStatus = ok ? `太棒了，你读对了：${transcript}` : `我听到：${transcript || "没有听清"}，我们继续。`;
      syncJumpFlashcard();
      if (ok) {
        state.learned.add(word.id);
        state.correct.add(word.id);
        // 记录成功拼对的单词，用于"背单词"模式
        state.jumpMastered.add(word.id);
        await speak("Great job!", { lang: "en-US", rate: 0.82, style: "reward" });
      } else {
        await speak(`The word is ${word.english}`, { lang: "en-US", rate: 0.78, style: "jump-repeat" });
      }
    }
    }
  } catch (error) {
    if (runId !== state.runId || state.screen !== "jump") return;
    jumpRuntime.lessonStatus = error?.message || "这次没有成功读出来，我们继续下一个单词。";
    syncJumpFlashcard();
    await wait(900);
  }

  if (runId !== state.runId || state.screen !== "jump") return;
  state.isBusy = false;
  jumpRuntime.detector?.setPaused(false);
  
  // 更新计数
  state.jumpRoundCount++;
  
  // 检查是否完成5个单词
  if (state.jumpRoundCount >= ROUND_WORD_COUNT) {
    // 重置计数
    state.jumpRoundCount = 0;
    // 检查是否所有单词都已学习
    if (getActiveLearnedCount() >= TOTAL_WORDS) {
      state.allWordsLearned = true;
      jumpRuntime.lessonStatus = "跳跳环节完成，准备进入匹配学习。";
      syncJumpFlashcard();
    }
    // 切换到"背单词"环节
    state.cyclePhase = "learn";
    jumpRuntime.lessonStatus = "跳跳环节完成，准备进入背单词环节...";
    syncJumpFlashcard();
    wait(1500).then(() => {
      if (state.screen === "jump") {
        navigateTo("learn");
      }
    });
    return;
  }
  
  setupNextJumpWord();
}

function syncJumpScene() {
  const giftsContainer = jumpRuntime.elements.gifts;
  if (giftsContainer) {
    const presentIds = new Set();
    const targetLetter = getCurrentJumpTargetLetter();
    for (const gift of jumpRuntime.gifts) {
      presentIds.add(gift.id);
      let node = jumpRuntime.giftNodes.get(gift.id);
      if (!node) {
        node = document.createElement("article");
        node.className = "jump-gift";
        node.innerHTML = `
          <div class="jump-gift-core">
            <img class="jump-gift-letter-art" alt="" />
          </div>
        `;
        giftsContainer.appendChild(node);
        jumpRuntime.giftNodes.set(gift.id, node);
      }
      node.className = `jump-gift is-${gift.state} ${gift.letter === targetLetter ? "is-target" : ""}`;
      node.style.left = `${gift.x * 100}%`;
      const word = words[jumpRuntime.currentWordIndex ?? 0] || words[0];
      const upperLetter = gift.letter.toUpperCase();
      const isTarget = gift.letter === targetLetter;
      const letterAsset = isTarget ? ALPHABET_GIF[upperLetter] : ALPHABET_PNG[upperLetter];
      node.style.setProperty("--gift", word.color);
      node.style.setProperty("--accent", word.accent);
      const image = node.querySelector(".jump-gift-letter-art");
      if (image) {
        if (image.dataset.asset !== letterAsset) {
          image.src = letterAsset;
          image.dataset.asset = letterAsset;
        }
        if (image.alt !== upperLetter) {
          image.alt = upperLetter;
        }
      }
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
    const isJumping = jumpRuntime.avatarY > 0.02;
    avatar.style.left = `${jumpRuntime.avatarX * 100}%`;
    avatar.style.transform = `translate(-50%, ${-jumpRuntime.avatarY * height}px)`;
    avatar.classList.toggle("is-jumping", isJumping);
    const avatarImage = jumpRuntime.elements.avatarImage;
    if (avatarImage && avatarImage.dataset.asset !== JUMP_AVATAR_GIF) {
      avatarImage.src = JUMP_AVATAR_GIF;
      avatarImage.dataset.asset = JUMP_AVATAR_GIF;
    }
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

function syncJumpMediaLayer() {
  const layer = jumpRuntime.elements.mediaLayer;
  if (!layer) return;
  layer.classList.toggle("is-visible", !!jumpRuntime.mediaVisible);
  if (jumpRuntime.elements.mediaTitle) {
    jumpRuntime.elements.mediaTitle.textContent = jumpRuntime.mediaTitle || "Jump Story";
  }
  if (jumpRuntime.elements.mediaStatus) {
    jumpRuntime.elements.mediaStatus.textContent = jumpRuntime.mediaStatus || "";
  }
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
// 规则：正确答案必须来自"跳跳开礼包"成功拼对的单词，其他3张可以是任意单词
function generateMatchSet() {
  // 获取已掌握的单词（来自"跳跳开礼包"）
  const masteredWords = [...state.jumpMastered]
    .map(id => words.find(w => w.id === id))
    .filter((word) => word && ACTIVE_WORD_ID_SET.has(word.id));
  
  // 如果没有掌握任何单词，显示提示
  if (masteredWords.length === 0) {
    learnRuntime.targetEmoji = null;
    learnRuntime.currentWordSet = [];
    learnRuntime.correctIndex = -1;
    learnRuntime.matched = false;
    learnRuntime.matchResult = null;
    return;
  }
  
  // 随机选择一个正确答案
  const correctWord = masteredWords[Math.floor(Math.random() * masteredWords.length)];
  
  const otherActiveWords = ACTIVE_WORDS.filter((word) => word.id !== correctWord.id);
  const extraPool = words.filter((word) => !ACTIVE_WORD_ID_SET.has(word.id) && word.id !== correctWord.id);
  const extraWord = extraPool[Math.floor(Math.random() * extraPool.length)] || null;
  const wrongWords = extraWord ? [...otherActiveWords, extraWord] : [...otherActiveWords];
  
  // 组合词卡并打乱顺序
  const wordSet = [correctWord, ...wrongWords];
  for (let i = wordSet.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wordSet[i], wordSet[j]] = [wordSet[j], wordSet[i]];
  }
  
  // 找到正确词卡的位置
  const correctIndex = wordSet.findIndex(w => w.id === correctWord.id);
  
  learnRuntime.targetEmoji = correctWord;
  learnRuntime.currentWordSet = wordSet;
  learnRuntime.correctIndex = correctIndex;
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
  
  // 更新计数
  state.learnRoundCount++;
  
  // 停留0.75秒
  await wait(750);
  if (runId !== state.runId) return;
  
  // 检查是否完成5个单词
  if (state.learnRoundCount >= ROUND_WORD_COUNT) {
    // 重置计数
    state.learnRoundCount = 0;
    state.allWordsLearned = true;
    await speak("恭喜你，今天学到了 apple、banana、cat。", { lang: "zh-CN", rate: 0.85 });
    if (runId !== state.runId) return;
    await wait(900);
    if (runId !== state.runId) return;
    navigateTo("complete");
    return;
  }
  
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
  if (!await speak(`Today we learn about ${ACTIVE_WORDS.map((word) => word.english).join(", ")}.`, { lang: "en-US", rate: 0.74, style: "summary" })) return;
  if (runId !== state.runId) return;
  await speak(`今天我们学习了${ACTIVE_WORDS.map((word) => word.chinese).join("、")}。`, { lang: "zh-CN", rate: 0.82, style: "summary" });
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

  if (learnRuntime.elements.scoreLearned) learnRuntime.elements.scoreLearned.textContent = String(getActiveLearnedCount());
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

function assetHref(relativePath) {
  return new URL(relativePath, import.meta.url).href;
}

function getActiveLearnedCount() {
  return ACTIVE_WORDS.filter((word) => state.learned.has(word.id)).length;
}

function getActiveJumpMasteredCount() {
  return ACTIVE_WORDS.filter((word) => state.jumpMastered.has(word.id)).length;
}

function resetLearningJourney() {
  stopSpeech();
  state.runId += 1;
  state.learningIndex = 0;
  state.quizIndex = 0;
  state.learned = new Set();
  state.correct = new Set();
  state.transcript = "";
  state.isBusy = false;
  state.jumpMastered = new Set();
  state.jumpRoundCount = 0;
  state.learnRoundCount = 0;
  state.cyclePhase = "jump";
  state.allWordsLearned = false;

  learnRuntime.currentWordSet = [];
  learnRuntime.targetEmoji = null;
  learnRuntime.correctIndex = -1;
  learnRuntime.matched = false;
  learnRuntime.matchResult = null;
  learnRuntime.lastHitIndex = null;

  jumpRuntime.nextWordCursor = 0;
  jumpRuntime.currentWordIndex = null;
  jumpRuntime.currentSpelling = "";
  jumpRuntime.currentLetterIndex = 0;
  jumpRuntime.flashcardWordIndex = null;
  jumpRuntime.lessonStatus = "站到镜头前，左右移动小人，再跳起来顶礼包。";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeJumpWord(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function getCurrentJumpTargetLetter() {
  return jumpRuntime.currentSpelling[jumpRuntime.currentLetterIndex] || "";
}

function formatJumpProgress() {
  if (!jumpRuntime.currentSpelling) return "-";
  return jumpRuntime.currentSpelling
    .split("")
    .map((letter, index) => (index < jumpRuntime.currentLetterIndex ? letter.toUpperCase() : "_"))
    .join("");
}

function repeatJumpLetter(letter) {
  const upper = letter.toUpperCase();
  return `${upper}, ${upper}, ${upper}`;
}

function shuffleLetters(list) {
  const next = [...list];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function computeJumpGiftSlots(count) {
  if (count <= 1) return [0.5];
  const start = 0.12;
  const end = 0.88;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

render();
