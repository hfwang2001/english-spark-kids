import { words } from "./words.js";
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

const app = document.querySelector("#app");

function render() {
  app.innerHTML = `
    <main class="shell screen-${state.screen}">
      ${renderHeader()}
      ${renderScreen()}
    </main>
  `;
  bindEvents();
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
  const seen = words.slice(0, state.learningIndex + 1);
  return `
    <section class="learn-layout">
      <div class="learn-status">
        <span>${state.learningIndex + 1} / ${words.length}</span>
        <div class="learn-line"><i style="width:${((state.learningIndex + 1) / words.length) * 100}%"></i></div>
      </div>
      <article class="spotlight-card" data-word="${current.id}" style="--card:${current.color};--accent:${current.accent}">
        ${cardImage(current)}
        <div class="word-meta">
          <h2>${current.english}</h2>
          <p>${current.chinese}</p>
        </div>
        <div class="card-sparkles"><i></i><i></i><i></i></div>
      </article>
      <div class="learn-controls">
        <button class="primary" data-action="play-current" ${state.isBusy ? "disabled" : ""}>播放这一张</button>
        <button class="secondary" data-action="next-learn" ${state.isBusy ? "disabled" : ""}>下一张</button>
        <small>${state.isBusy ? "读完后 5 秒自动进入下一张" : "准备开始"}</small>
      </div>
      <div class="ribbon-grid">
        ${seen.map((word) => compactCard(word)).join("")}
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

function cardImage(word) {
  return `
    <div class="image-frame" role="img" aria-label="${word.english} image">
      <div class="image-glow"></div>
      <div class="emoji-art">${word.emoji}</div>
    </div>
  `;
}

function compactCard(word, showEnglish = false) {
  return `
    <article class="compact" style="--card:${word.color};--accent:${word.accent}">
      <span>${word.emoji}</span>
      <b>${showEnglish ? word.english : word.chinese}</b>
      <small>${showEnglish ? word.chinese : word.english}</small>
    </article>
  `;
}

function miniCard(word, index) {
  return `
    <span class="mini" style="--card:${word.color};--accent:${word.accent};--i:${index}">
      ${word.emoji}
    </span>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action));
  });
}

async function handleAction(action) {
  if (["home", "learn", "quiz", "summary"].includes(action)) {
    stopSpeech();
    state.runId += 1;
    state.isBusy = false;
    state.screen = action;
    state.transcript = "";
    render();
    if (action === "learn") playCurrentLearning();
    return;
  }
  if (action === "play-current") await playCurrentLearning();
  if (action === "next-learn") nextLearn();
  if (action === "listen") await listenForWord();
  if (action === "skip-reward") showReward();
  if (action === "next-quiz") nextQuiz();
  if (action === "read-summary") await readSummary();
}

async function playCurrentLearning() {
  const runId = ++state.runId;
  const current = words[state.learningIndex] || words[0];
  state.isBusy = true;
  render();
  await speakLearningScript(current);
  if (runId !== state.runId) return;
  state.learned.add(current.id);
  render();
  await delay(5000);
  if (runId !== state.runId) return;
  if (state.learningIndex < words.length - 1) {
    state.learningIndex += 1;
    render();
    await playCurrentLearning();
    return;
  }
  state.isBusy = false;
  render();
}

function nextLearn() {
  state.runId += 1;
  stopSpeech();
  state.isBusy = false;
  state.learningIndex = Math.min(words.length - 1, state.learningIndex + 1);
  render();
  playCurrentLearning();
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
  const current = words[state.quizIndex] || words[0];
  state.correct.add(current.id);
  state.screen = "reward";
  render();
  await speak(`I am ${current.english}. ${introLine(current)}`, { lang: "en-US", rate: 0.78 });
}

function nextQuiz() {
  state.quizIndex = (state.quizIndex + 1) % words.length;
  state.screen = "quiz";
  state.transcript = "";
  render();
}

async function readSummary() {
  await speak(`Today we learn about ${words.map((word) => word.english).join(", ")}.`, { lang: "en-US", rate: 0.74 });
  await speak(`今天我们学习了${words.map((word) => word.chinese).join("、")}。`, { lang: "zh-CN", rate: 0.82 });
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

render();
