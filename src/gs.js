// ==========================================
// CONFIGURATION & INITIALIZATION
// ==========================================

const SUPABASE_URL = "https://ndfdcobmnxsvtrdqpqti.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-CMSV99N3ovQggn-eJhLLA_z5WFtag4";

// Storage adapter that never throws (strict Incognito / restricted environments)
const memoryStorageAdapter = {
  getItem: (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  setItem: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  },
  removeItem: (key) => {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: memoryStorageAdapter,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// Customisable texts (overridden by window.gameParams in params.js)
let customThanksMessage = "Thank you for playing Kaun Banega Dharm Shiromani!";
let customInstructionsTitle = "Instructions / नियम एवं निर्देश";
let customInstructionsBody = "No specific instructions provided.";

const prizeLadder = [
  "1,000", "2,000", "3,000", "5,000", "10,000",
  "20,000", "40,000", "80,000", "1,60,000", "3,20,000",
  "6,40,000", "12,50,000", "25,00,000", "50,00,000", "7,00,00,000"
];

// Keyboard key -> option index
const OPTION_KEYS = {
  '1': 0, 'a': 0, 'A': 0,
  '2': 1, 'b': 1, 'B': 1,
  '3': 2, 'c': 2, 'C': 2,
  '4': 3, 'd': 3, 'D': 3
};

// Game state
let gameSessionId = null;
let distinctLevels = [];
let availableCount = 0;
let usedQuestionIDs = new Set();
let currentQuestionData = null;
let currentExplanation = null;
let currentIndex = 0;
let maxGameQuestions = 15;
let canSelect = true;
let gameModeSetting = "untimed";

// Lifelines state
let lifeline5050Used = false;
let lifelineAudienceUsed = false;
let lifelineFlipUsed = false;
let currentOptions = [];

// Timer state
let isTimedMode = false;
let timeLimitPerQuestion = 30;
let timeRemaining = 0;
let timerInterval = null;

// Flow control state
let nextStepTimeout = null;
let pendingNextStepCallback = null;

// Audio settings
let isAudioMuted = localStorage.getItem('kbds_audio_muted') === 'true';

window.addEventListener('DOMContentLoaded', () => {
  initApp();
  initKeyboardListeners();
  updateAudioToggleUI();
});

// Enables the Start button and shows a status message (used by fallback paths)
function unlockStartButton(message, color) {
  const statusEl = document.getElementById("status-msg");
  const startBtn = document.getElementById("start-btn");
  if (statusEl) {
    statusEl.innerText = message;
    statusEl.style.color = color;
  }
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerText = "Start Game";
  }
}

async function initApp() {
  const loader = document.getElementById('loading-overlay') || document.querySelector('.loader-screen');

  // Fail-safe: never leave the UI locked if initialisation hangs (e.g. Incognito)
  const safetyTimeout = setTimeout(() => {
    console.warn("Initialization timed out, forcing UI unlock for Incognito.");
    unlockStartButton("Ready to play (Offline/Restricted Mode)", "#38bdf8");
    if (loader) loader.style.display = 'none';
  }, 4000);

  try {
    loadGameParams();
    checkSavedSession();
    updateHighScoreDisplay();
    await loadQuestionBankMeta();
    clearTimeout(safetyTimeout);
  } catch (err) {
    console.warn("App initialization error (incognito restriction):", err);
    clearTimeout(safetyTimeout);
    unlockStartButton("Running in Restricted Mode", "#eab308");
  } finally {
    if (loader) loader.style.display = 'none';
  }
}


// ==========================================
// AUDIO MANAGER (Web Audio API)
// ==========================================

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playSound(type) {
  if (isAudioMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'correct') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);       // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (type === 'incorrect') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.setValueAtTime(110, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'tick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  } catch (e) {
    console.warn("Audio error:", e);
  }
}

function toggleAudioMute() {
  isAudioMuted = !isAudioMuted;
  localStorage.setItem('kbds_audio_muted', isAudioMuted);
  updateAudioToggleUI();
}

function updateAudioToggleUI() {
  const btn = document.getElementById('audio-toggle-btn');
  if (btn) btn.innerText = isAudioMuted ? '🔇' : '🔊';
}


// ==========================================
// SESSION PERSISTENCE (localStorage with in-memory fallback)
// ==========================================

let fallbackSessionStore = null; // Used when localStorage is blocked

function saveGameSession() {
  if (!gameSessionId) return;

  const sessionData = {
    gameSessionId,
    currentIndex,
    usedQuestionIDs: Array.from(usedQuestionIDs),
    maxGameQuestions,
    gameModeSetting,
    lifeline5050Used,
    lifelineAudienceUsed,
    lifelineFlipUsed,
    timeLimitPerQuestion,
    timeRemaining, // <-- Store active remaining seconds
    distinctLevels,
    currentQuestionData
  };

  try {
    localStorage.setItem('kbds_active_session', JSON.stringify(sessionData));
  } catch (e) {
    fallbackSessionStore = sessionData;
  }
}

// Returns the raw saved string from localStorage, or null if unavailable
function readSavedSessionRaw() {
  try {
    return localStorage.getItem('kbds_active_session');
  } catch (e) {
    return null;
  }
}

function checkSavedSession() {
  try {
    const saved = localStorage.getItem('kbds_active_session') || fallbackSessionStore;
    const resumeContainer = document.getElementById('resume-container');
    if (saved && resumeContainer) {
      resumeContainer.style.display = 'block';
    }
  } catch (e) {
    console.warn('localStorage access restricted:', e);
  }
}

async function resumeGameSession() {
  try {
    let saved = null;
    try {
      saved = localStorage.getItem('kbds_active_session');
    } catch (err) {
      saved = null;
    }
    
    const data = saved ? JSON.parse(saved) : fallbackSessionStore;
    if (!data) {
      alert("No saved session found.");
      clearSavedSession();
      return;
    }

    gameSessionId = data.gameSessionId;
    currentIndex = data.currentIndex;
    usedQuestionIDs = new Set(data.usedQuestionIDs || []);
    maxGameQuestions = data.maxGameQuestions;
    gameModeSetting = data.gameModeSetting;
    lifeline5050Used = data.lifeline5050Used;
    lifelineAudienceUsed = data.lifelineAudienceUsed;
    lifelineFlipUsed = data.lifelineFlipUsed;
    timeLimitPerQuestion = data.timeLimitPerQuestion;
    distinctLevels = data.distinctLevels || [];
    currentQuestionData = data.currentQuestionData || null;

    if (lifeline5050Used) document.getElementById('life-5050').classList.add('used');
    if (lifelineAudienceUsed) document.getElementById('life-audience').classList.add('used');
    if (lifelineFlipUsed) document.getElementById('life-flip').classList.add('used');

    if (gameModeSetting === "timed" || gameModeSetting === "kbds") {
      document.getElementById("timer-container").style.display = "block";
    }

    document.getElementById("setup-modal").style.display = "none";
    playSound('click');

    // If we have the exact active question saved, restore it directly!
    if (currentQuestionData) {
      canSelect = true;
      stopTimer();

      // Restore stored timeRemaining precisely without forcing a full reset
      if (typeof data.timeRemaining === 'number' && data.timeRemaining >= 0) {
        timeRemaining = data.timeRemaining;
      } else {
        timeRemaining = timeLimitPerQuestion;
      }

      document.getElementById('lbl-level').innerText = `${currentQuestionData.qId}9${currentQuestionData.numericLevel * 10}`;
      const currentPrize = prizeLadder[Math.min(currentIndex, prizeLadder.length - 1)];
      document.getElementById('lbl-prize').innerText = `Question ${currentIndex + 1} • Points: ${currentPrize}`;

      document.getElementById('lbl-question-en').innerText = currentQuestionData.en.qText;
      document.getElementById('lbl-question-hi').innerText = currentQuestionData.hi.qText;

      currentOptions = currentQuestionData.options;
      renderOptions();
      setupBulbState(false, null);

      updateMediaButton(currentQuestionData.qType);

      if (gameModeSetting === "timed" || (gameModeSetting === "kbds" && currentIndex < 10)) {
        isTimedMode = true;
        document.getElementById("timer-container").style.display = "block";
        runCountdown(); // Resumes using the exact restored timeRemaining
      } else {
        isTimedMode = false;
        document.getElementById("timer-container").style.display = "none";
      }
    } else {
      await loadQuestion();
    }
  } catch (e) {
    console.error("Failed to resume session:", e);
    clearSavedSession();
    alert("Could not resume the saved game session.");
  }
}

function clearSavedSession() {
  try {
    localStorage.removeItem('kbds_active_session');
  } catch (e) {
    // Ignore storage restriction errors
  }
  fallbackSessionStore = null;

  // Hide the resume container immediately
  const resumeContainer = document.getElementById('resume-container');
  if (resumeContainer) resumeContainer.style.display = 'none';
}


// ==========================================
// HIGH SCORES & LEADERBOARD (localStorage)
// ==========================================

function getNumericScoreVal(prizeStr) {
  if (!prizeStr) return 0;
  return parseInt(prizeStr.replace(/,/g, ''), 10) || 0;
}

function saveHighScore(pointsStr, mode) {
  const scoreVal = getNumericScoreVal(pointsStr);
  const key = `kbds_highscore_${mode}`;
  try {
    const existing = parseInt(localStorage.getItem(key) || '0', 10);
    if (scoreVal > existing) {
      localStorage.setItem(key, scoreVal);
      document.getElementById('new-highscore-badge').style.display = 'block';
      return true;
    }
  } catch (e) {
    console.warn('localStorage restricted:', e);
  }
  document.getElementById('new-highscore-badge').style.display = 'none';
  return false;
}

function openLeaderboardModal() {
  const modes = ['untimed', 'timed', 'kbds'];
  let html = '<ul style="list-style: none; padding: 0;">';
  modes.forEach(m => {
    const val = parseInt(localStorage.getItem(`kbds_highscore_${m}`) || '0', 10);
    html += `<li style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; display: flex; justify-content: space-between;">
      <span style="text-transform: uppercase; color: #38bdf8; font-weight: bold;">${m} Mode:</span>
      <span style="color: #00ff66; font-weight: bold;">${val.toLocaleString()} Points</span>
    </li>`;
  });
  html += '</ul>';
  document.getElementById('leaderboard-body').innerHTML = html;
  document.getElementById('leaderboard-modal').style.display = 'flex';
  playSound('click');
}

function closeLeaderboardModal() {
  document.getElementById('leaderboard-modal').style.display = 'none';
  playSound('click');
}

function updateHighScoreDisplay() {
  try {
    const modes = ['untimed', 'timed', 'kbds'];
    let maxScore = 0;

    // Find the highest score across all modes
    modes.forEach(m => {
      const val = parseInt(localStorage.getItem(`kbds_highscore_${m}`) || '0', 10);
      if (val > maxScore) maxScore = val;
    });

    const setupHighScoreEl = document.getElementById('setup-highscore-val');
    if (setupHighScoreEl) {
      setupHighScoreEl.innerText = `${maxScore.toLocaleString()} Points`;
    }
  } catch (e) {
    console.warn('localStorage getItem restricted:', e);
  }
}


// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================

function initKeyboardListeners() {
  document.addEventListener('keydown', (e) => {
    // Ignore shortcuts while typing in a form field
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    // Checks computed CSS visibility of a modal
    const isVisible = (id) => {
      const el = document.getElementById(id);
      return !!el && window.getComputedStyle(el).display !== 'none';
    };

    const isConfirmKey = e.key === 'Enter' || e.key === ' ';

    // Open modals capture the keyboard first
    if (isVisible('explanation-modal')) {
      if (isConfirmKey) {
        e.preventDefault();
        closeExplanationModal();
      }
      return;
    }

    if (isVisible('poll-modal')) {
      if (isConfirmKey) {
        e.preventDefault();
        closePoll();
      }
      return;
    }

    if (isVisible('quit-modal')) {
      if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        confirmQuit();
      } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        closeQuitModal();
      }
      return;
    }

    if (isVisible('setup-modal')) return;

    // Active gameplay
    if (!canSelect) return;

    if (e.key in OPTION_KEYS) {
      e.preventDefault();
      triggerOptionKey(OPTION_KEYS[e.key]);
    } else if (e.key === '5') {
      e.preventDefault();
      use5050();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      useFlip();
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      useAudience();
    } else if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      useQuit();
    }
  });
}

function triggerOptionKey(idx) {
  const btn = document.getElementById(`opt-btn-${idx}`);
  if (btn && btn.style.visibility !== 'hidden') {
    btn.click();
  }
}


// ==========================================
// PARAMS & METADATA LOADING
// ==========================================

function loadGameParams() {
  try {
    const p = window.gameParams;
    if (!p) return;
    if (p.thanksMessage) customThanksMessage = String(p.thanksMessage);
    if (p.instructionsTitle) customInstructionsTitle = String(p.instructionsTitle);
    if (p.instructionsBody) customInstructionsBody = String(p.instructionsBody);
  } catch (e) {
    console.warn("Could not read game parameters:", e);
  }
}

async function loadQuestionBankMeta() {
  const statusEl = document.getElementById("status-msg");
  const startBtn = document.getElementById("start-btn");

  try {
    statusEl.innerText = "Connecting to question bank...";
    statusEl.style.color = "#38bdf8";

    if (!gameSessionId) gameSessionId = crypto.randomUUID();

    // Debug mode (non-question) restricts to media questions only
    let qtypeFilter = null;
    if (isDebugMode() && !isDebugQuestionMode()) {
      qtypeFilter = ['A', 'V', 'P'];
    }

    const { data: meta, error } = await supabaseClient.rpc('get_question_bank_meta', {
      p_qtype_filter: qtypeFilter
    });

    if (error) throw error;
    if (!meta || !meta.levels || meta.levels.length === 0) {
      throw new Error("No valid questions found for current mode.");
    }

    distinctLevels = meta.levels;
    availableCount = meta.count;

    if (isDebugQuestionMode()) {
      maxGameQuestions = 1;
    } else if (isDebugMode()) {
      maxGameQuestions = Math.min(15, availableCount);
    } else {
      maxGameQuestions = 15;
    }

    statusEl.innerText = "Loaded questions successfully!";
    statusEl.style.color = "#22c55e";
    startBtn.disabled = false;
    startBtn.innerText = "Start Game";

  } catch (err) {
    statusEl.innerText = "Failed to load data: " + err.message;
    statusEl.style.color = "#ef4444";
    startBtn.disabled = true;
    startBtn.innerText = "Error Loading Data";
  }
}


// ==========================================
// URL & DEBUG HELPERS
// ==========================================

function getUrlParam(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function isDebugMode() {
  const currentFilename = window.location.pathname.split('/').pop().toLowerCase();
  return currentFilename !== 'index.html' && getUrlParam('debug') === 'true';
}

function isDebugQuestionMode() {
  return isDebugMode() && getUrlParam('question') !== null;
}


// ==========================================
// ANALYTICS HELPERS
// ==========================================

function currentLevelForAnalytics() {
  return currentQuestionData ? currentQuestionData.numericLevel : 'unknown';
}

function trackLifeline(name) {
  gtag('event', 'lifeline_used', {
    'game_mode': gameModeSetting,
    'lifeline_name': name,
    'question_level': currentLevelForAnalytics(),
    'question_index': currentIndex + 1
  });
}

function trackQuestionFailed(reason) {
  gtag('event', 'question_failed', {
    'game_mode': gameModeSetting,
    'question_level': currentLevelForAnalytics(),
    'question_index': currentIndex + 1,
    'fail_reason': reason
  });
}


// ==========================================
// MODALS & UI HELPERS
// ==========================================

function openInstructionsModal() {
  playSound('click');
  document.getElementById('instructions-title').innerText = customInstructionsTitle;
  document.getElementById('instructions-body').innerHTML = customInstructionsBody;
  document.getElementById('instructions-modal').style.display = 'flex';
}

function closeInstructionsModal() {
  playSound('click');
  document.getElementById('instructions-modal').style.display = 'none';
}

function openThanksModal() {
  playSound('click');
  document.getElementById('thanks-msg-body').innerHTML = customThanksMessage;
  document.getElementById('thanks-modal').style.display = 'flex';
}

function closeThanksModal() {
  playSound('click');
  document.getElementById('thanks-modal').style.display = 'none';
}

function openExplanationModal() {
  if (!currentExplanation) return;
  playSound('click');
  stopTimer();

  if (nextStepTimeout) {
    clearTimeout(nextStepTimeout);
    nextStepTimeout = null;
  }

  gtag('event', 'explanation_viewed', {
    'game_mode': gameModeSetting,
    'question_index': currentIndex + 1,
    'question_level': currentLevelForAnalytics()
  });

  document.getElementById('modal-explanation-en').innerHTML = currentExplanation.en || "";
  document.getElementById('modal-explanation-hi').innerHTML = currentExplanation.hi || "";
  document.getElementById('explanation-modal').style.display = 'flex';
}

function closeExplanationModal() {
  playSound('click');
  document.getElementById('explanation-modal').style.display = 'none';

  if (pendingNextStepCallback) {
    const callback = pendingNextStepCallback;
    pendingNextStepCallback = null;
    callback();
  } else if (canSelect && isTimedMode && timeRemaining > 0) {
    resumeTimer();
  }
}

function toggleTimerInput(show) {
  playSound('click');
  document.getElementById("timer-input-group").style.display = show ? "flex" : "none";
}

// Shows/hides the explanation bulb. When active, the question box becomes clickable.
function setupBulbState(makeActive = false, explanation = null) {
  const bulbBtn = document.getElementById('bulb-btn');
  const questionBox = document.querySelector('.question-box');

  const expEn = (explanation && explanation.en) ? explanation.en.trim() : "";
  const expHi = (explanation && explanation.hi) ? explanation.hi.trim() : "";
  const hasExplanation = (expEn !== "" || expHi !== "");

  currentExplanation = hasExplanation ? { en: expEn, hi: expHi } : null;

  const clickable = hasExplanation && makeActive;

  bulbBtn.style.display = hasExplanation ? 'flex' : 'none';
  bulbBtn.classList.toggle('active-bulb', clickable);

  if (questionBox) {
    questionBox.classList.toggle('clickable-explanation', clickable);
    questionBox.onclick = clickable ? openExplanationModal : null;
  }
}

// Schedules the next game step; it can also be fired early (e.g. by closing the explanation)
function scheduleNextStep(callback, delayMs) {
  pendingNextStepCallback = callback;
  nextStepTimeout = setTimeout(() => {
    if (pendingNextStepCallback) {
      const cb = pendingNextStepCallback;
      pendingNextStepCallback = null;
      cb();
    }
  }, delayMs);
}


// ==========================================
// GAMEFLOW & QUESTION MANAGEMENT
// ==========================================

async function startGame() {
  playSound('click');
  const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
  gameModeSetting = selectedMode;

  gtag('event', 'game_start', { 'game_mode': gameModeSetting });

  if (selectedMode === "timed" || selectedMode === "kbds") {
    const inputVal = parseInt(document.getElementById("seconds-input").value, 10);
    timeLimitPerQuestion = (isNaN(inputVal) || inputVal < 5) ? 30 : inputVal;
    document.getElementById("timer-container").style.display = "block";
  } else {
    document.getElementById("timer-container").style.display = "none";
  }

  document.getElementById("setup-modal").style.display = "none";
  currentIndex = 0;
  usedQuestionIDs.clear();
  clearSavedSession();
  await loadQuestion();
}

async function fetchNextQuestion() {
  if (distinctLevels.length === 0) return null;

  // Map the question position onto the available difficulty levels
  let levelIdx = Math.floor((currentIndex / prizeLadder.length) * distinctLevels.length);
  levelIdx = Math.min(levelIdx, distinctLevels.length - 1);
  const targetLevel = distinctLevels[levelIdx];

  let qtypeFilter = null;
  let specificId = null;

  if (isDebugQuestionMode()) {
    specificId = getUrlParam('question');
  } else if (isDebugMode()) {
    qtypeFilter = ['A', 'V', 'P'];
  }

  try {
    const { data, error } = await supabaseClient.rpc('get_next_question', {
      p_target_level: targetLevel,
      p_exclude_ids: Array.from(usedQuestionIDs),
      p_qtype_filter: qtypeFilter,
      p_specific_id: specificId,
      p_session_id: gameSessionId
    });

    if (error || !data) {
      console.error("Failed to fetch question:", error);
      return null;
    }

    usedQuestionIDs.add(data.qId);
    saveGameSession();
    return data;
  } catch (e) {
    console.error("Failed to fetch question:", e);
    return null;
  }
}

// Paints the current question (labels, text, options) and resets the explanation bulb
function renderQuestionUI() {
  setupBulbState(false, null);

  document.getElementById('lbl-level').innerText =
    `${currentQuestionData.qId}9${currentQuestionData.numericLevel * 10}`;

  const currentPrize = prizeLadder[Math.min(currentIndex, prizeLadder.length - 1)];
  document.getElementById('lbl-prize').innerText = `Question ${currentIndex + 1} • Points: ${currentPrize}`;

  document.getElementById('lbl-question-en').innerText = currentQuestionData.en.qText;
  document.getElementById('lbl-question-hi').innerText = currentQuestionData.hi.qText;

  currentOptions = currentQuestionData.options;
  renderOptions();
}

// Shared SVG for the media replay button (picture / audio / video symbol inside the oval)
function getMediaIconSvg(qType) {
  const frame = `
    <ellipse cx="80" cy="50" rx="75" ry="45" fill="#0284c7" stroke="#032b43" stroke-width="2"/>
    <ellipse cx="80" cy="50" rx="65" ry="36" fill="#032b43"/>
    <ellipse cx="80" cy="50" rx="65" ry="36" fill="none" stroke="#38bdf8" stroke-width="3"/>`;

  const symbols = {
    // Picture
    P: `<g fill="#38bdf8">
          <rect x="52" y="32" width="56" height="36" rx="4" fill="none" stroke="#38bdf8" stroke-width="3"/>
          <circle cx="64" cy="42" r="4"/>
          <polygon points="56,62 70,48 80,58 92,44 104,62"/>
        </g>`,
    // Audio
    A: `<g fill="#38bdf8">
          <ellipse cx="56" cy="62" rx="7" ry="5" transform="rotate(-20 56 62)"/>
          <ellipse cx="88" cy="56" rx="7" ry="5" transform="rotate(-20 88 56)"/>
          <path d="M 61 60 V 34 L 93 28 V 54 L 89 54 V 32 L 65 37 V 60 Z"/>
        </g>`,
    // Video
    V: `<g fill="#38bdf8">
          <rect x="52" y="34" width="38" height="32" rx="4"/>
          <polygon points="94,40 108,32 108,68 94,60"/>
        </g>`
  };

  return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">${frame}${symbols[qType]}</svg>`;
}

// Shows the replay button for media questions, hides it otherwise. Returns true if media.
function updateMediaButton(qType) {
  const mediaBtn = document.getElementById('life-media-replay');
  if (!mediaBtn) return false;

  if (['P', 'A', 'V'].includes(qType)) {
    mediaBtn.innerHTML = getMediaIconSvg(qType);
    mediaBtn.style.display = 'inline-flex';
    void mediaBtn.offsetWidth; // Force layout reflow so the icon appears instantly
    return true;
  }

  mediaBtn.style.display = 'none';
  return false;
}

async function loadQuestion() {
  canSelect = true;
  stopTimer();

  // Reset to full time limit for new questions
  timeRemaining = timeLimitPerQuestion;

  if (nextStepTimeout) { clearTimeout(nextStepTimeout); nextStepTimeout = null; }
  pendingNextStepCallback = null;

  if (currentIndex >= maxGameQuestions) {
    endGame(true);
    return;
  }

  // Timer visibility per mode (KBDS mode is timed for the first 10 questions only)
  if (gameModeSetting === "timed") {
    isTimedMode = true;
  } else if (gameModeSetting === "untimed") {
    isTimedMode = false;
  } else if (gameModeSetting === "kbds") {
    isTimedMode = currentIndex < 10;
  }
  document.getElementById("timer-container").style.display = isTimedMode ? "block" : "none";

  currentQuestionData = await fetchNextQuestion();

  if (!currentQuestionData) {
    endGame(true);
    return;
  }

  // Save immediately so the active question can be restored on resume
  saveGameSession();
  renderQuestionUI();

  if (updateMediaButton(currentQuestionData.qType)) {
    // Timer starts when the media modal is closed
    showMediaModal(currentQuestionData.qType, currentQuestionData.mediaUrl);
  } else {
    startTimer();
  }
}

function renderOptions() {
  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  const prefixes = ['A:', 'B:', 'C:', 'D:'];

  currentOptions.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.id = `opt-btn-${idx}`;
    btn.innerHTML = `
      <span class="opt-en"><span class="option-prefix">${prefixes[idx]}</span>${opt.en}</span>
      <span class="opt-hi">${opt.hi}</span>
    `;

    btn.onclick = () => {
      btn.blur(); // Remove focus ring so keyboard shortcuts keep working globally
      handleSelection(btn, idx);
    };
    grid.appendChild(btn);
  });
}

async function handleSelection(selectedBtn, selectedIndex) {
  if (!canSelect) return;
  canSelect = false;
  stopTimer();
  playSound('click');

  selectedBtn.classList.add('selected');

  // Answer is verified server-side
  let result;
  try {
    const { data, error } = await supabaseClient.rpc('submit_answer', {
      p_token: currentQuestionData.attemptToken,
      p_selected_index: selectedIndex
    });
    if (error || !data) throw error || new Error("No response from server");
    result = data;
  } catch (e) {
    console.error("Answer check failed:", e);
    alert("Could not verify your answer — please check your connection and try again.");
    canSelect = true;
    selectedBtn.classList.remove('selected');
    return;
  }

  // Short suspense delay before revealing the result
  setTimeout(() => {
    setupBulbState(true, { en: result.explanationEn, hi: result.explanationHi });
    selectedBtn.classList.remove('selected');

    if (result.isCorrect) {
      playSound('correct');
      selectedBtn.classList.add('correct');

      scheduleNextStep(async () => {
        currentIndex++;
        saveGameSession();
        if (currentIndex < maxGameQuestions) {
          await loadQuestion();
        } else {
          endGame(true);
        }
      }, 5000);

    } else {
      playSound('incorrect');
      selectedBtn.classList.add('incorrect');
      trackQuestionFailed('incorrect_selection');

      const correctBtn = document.getElementById(`opt-btn-${result.correctIndex}`);
      if (correctBtn) correctBtn.classList.add('correct');

      scheduleNextStep(() => endGame(false), 6000);
    }
  }, 1200);
}


// ==========================================
// MEDIA HANDLING
// ==========================================

function replayMedia() {
  if (!currentQuestionData || !['P', 'A', 'V'].includes(currentQuestionData.qType)) return;
  playSound('click');
  showMediaModal(currentQuestionData.qType, currentQuestionData.mediaUrl);
}

function showMediaModal(type, url) {
  stopTimer();
  const titleEl = document.getElementById('media-title');
  const instructionEl = document.getElementById('media-instruction');
  const containerEl = document.getElementById('media-content');
  containerEl.innerHTML = '';

  document.getElementById('media-modal').style.display = 'flex';

  if (type === 'P') {
    titleEl.innerText = '🖼️ Picture Question / चित्र प्रश्न';
    instructionEl.style.display = 'none';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Question Image';
    containerEl.appendChild(img);
  } else if (type === 'A') {
    titleEl.innerText = '🎵 Audio Question / ऑडियो प्रश्न';
    instructionEl.innerText = 'Please press the Play button to listen / सुनने के लिए प्ले बटन दबाएं';
    instructionEl.style.display = 'block';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    containerEl.appendChild(audio);
  } else if (type === 'V') {
    titleEl.innerText = '🎥 Video Question / वीडियो प्रश्न';
    instructionEl.innerText = 'Please press the Play button to watch / देखने के लिए प्ले बटन दबाएं';
    instructionEl.style.display = 'block';
    const video = document.createElement('video');
    video.controls = true;
    video.src = url;
    containerEl.appendChild(video);
  }
}

function closeMediaModal() {
  playSound('click');
  document.querySelectorAll('#media-content audio, #media-content video').forEach(el => el.pause());
  document.getElementById('media-modal').style.display = 'none';

  if (canSelect && isTimedMode) {
    // Resume if the clock is already running, otherwise start fresh
    if (timeRemaining > 0 && timeRemaining < timeLimitPerQuestion) {
      resumeTimer();
    } else {
      startTimer();
    }
  }
}


// ==========================================
// TIMER SYSTEM
// ==========================================

// Ticks once per second until time runs out
function runCountdown() {
  updateTimerUI();
  timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerUI();
    
    // Save active countdown so resuming picks up at the exact remaining second
    saveGameSession();
    
    if (timeRemaining <= 5 && timeRemaining > 0) playSound('tick');
    if (timeRemaining <= 0) {
      stopTimer();
      handleTimeout();
    }
  }, 1000);
}

// Starts the timer from the full time limit
function startTimer() {
  stopTimer();
  if (!isTimedMode) return;
  timeRemaining = timeLimitPerQuestion;
  runCountdown();
}

// Continues the timer from the remaining time
function resumeTimer() {
  stopTimer();
  if (!isTimedMode) return;
  runCountdown();
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerUI() {
  const display = document.getElementById("timer-display");
  const bar = document.getElementById("timer-bar-fill");
  display.innerText = `Time Remaining: ${timeRemaining}s`;

  const percentage = (timeRemaining / timeLimitPerQuestion) * 100;
  bar.style.width = `${percentage}%`;

  if (percentage > 50) bar.style.backgroundColor = "#22c55e";
  else if (percentage > 20) bar.style.backgroundColor = "#eab308";
  else bar.style.backgroundColor = "#ef4444";
}

async function handleTimeout() {
  canSelect = false;
  playSound('incorrect');
  trackQuestionFailed('timeout');

  // Submit "no answer" (-1) to reveal the correct option and explanation
  try {
    const { data, error } = await supabaseClient.rpc('submit_answer', {
      p_token: currentQuestionData.attemptToken,
      p_selected_index: -1
    });

    if (!error && data) {
      const correctBtn = document.getElementById(`opt-btn-${data.correctIndex}`);
      if (correctBtn) correctBtn.classList.add('correct');
      setupBulbState(true, { en: data.explanationEn, hi: data.explanationHi });
    }
  } catch (e) {
    console.error("Timeout scoring failed:", e);
  }

  scheduleNextStep(() => {
    alert("Time is up! / समय समाप्त!");
    endGame(false);
  }, 4000);
}


// ==========================================
// LIFELINES
// ==========================================

async function use5050() {
  if (lifeline5050Used || !canSelect) return;
  lifeline5050Used = true;
  document.getElementById('life-5050').classList.add('used');
  playSound('click');
  trackLifeline('50_50');

  try {
    const { data, error } = await supabaseClient.rpc('use_5050', {
      p_token: currentQuestionData.attemptToken
    });
    if (error || !data || !data.hideIndices) throw error || new Error("No response");

    data.hideIndices.forEach(idx => {
      const btn = document.getElementById(`opt-btn-${idx}`);
      if (btn) btn.style.visibility = 'hidden';
    });
    saveGameSession();
  } catch (e) {
    console.error("50-50 lifeline failed:", e);
  }
}

async function useAudience() {
  if (lifelineAudienceUsed || !canSelect) return;
  stopTimer();
  lifelineAudienceUsed = true;
  document.getElementById('life-audience').classList.add('used');
  playSound('click');
  trackLifeline('audience_poll');

  // Only options still visible (after 50:50) take part in the poll
  const activeIndices = [];
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`opt-btn-${i}`);
    if (btn && btn.style.visibility !== 'hidden') activeIndices.push(i);
  }

  try {
    const { data, error } = await supabaseClient.rpc('use_audience', {
      p_token: currentQuestionData.attemptToken,
      p_active_indices: activeIndices
    });
    if (error || !data || !data.percentages) throw error || new Error("No response");

    const percentages = data.percentages;

    for (let i = 0; i < 4; i++) {
      document.getElementById(`pval-${i}`).innerText = percentages[i] + "%";
      document.getElementById(`pbar-${i}`).style.height = "0%";
    }

    document.getElementById("poll-modal").style.display = "flex";

    // Double rAF so the bars animate from 0% after the modal is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (let i = 0; i < 4; i++) {
          document.getElementById(`pbar-${i}`).style.height = percentages[i] + "%";
        }
      });
    });
    saveGameSession();
  } catch (e) {
    console.error("Audience lifeline failed:", e);
  }
}

function closePoll() {
  playSound('click');
  document.getElementById("poll-modal").style.display = "none";
  if (canSelect && isTimedMode && timeRemaining > 0) {
    resumeTimer();
  }
}

async function useFlip() {
  if (lifelineFlipUsed || !canSelect) return;
  lifelineFlipUsed = true;
  document.getElementById('life-flip').classList.add('used');
  playSound('click');
  trackLifeline('flip_question');

  await loadQuestion();
}


// ==========================================
// QUIT & GAME OVER HANDLING
// ==========================================

function useQuit() {
  if (!canSelect) return;
  stopTimer();
  playSound('click');

  const safeVal = currentIndex > 0 ? prizeLadder[currentIndex - 1] : "0";
  document.getElementById('quit-modal-msg').innerText =
    `Are you sure you want to quit? You will leave with ${safeVal} Points. / क्या आप खेल छोड़ना चाहते हैं? आप ${safeVal} पॉइंट्स लेकर जाएंगे।`;
  document.getElementById('quit-modal').style.display = 'flex';
}

function closeQuitModal() {
  playSound('click');
  document.getElementById('quit-modal').style.display = 'none';
  if (canSelect && isTimedMode && timeRemaining > 0) {
    resumeTimer();
  }
}

function confirmQuit() {
  playSound('click');
  document.getElementById('quit-modal').style.display = 'none';
  endGame(false, true);
}

function endGame(isVictory, isQuit = false) {
  stopTimer();
  canSelect = false;
  clearSavedSession();

  const finalPoints = currentIndex > 0 ? prizeLadder[Math.min(currentIndex - 1, prizeLadder.length - 1)] : "0";
  const pointsWon = isVictory ? prizeLadder[Math.min(currentIndex, prizeLadder.length - 1)] : finalPoints;

  saveHighScore(pointsWon, gameModeSetting);

  let outcome = 'lost_wrong_answer';
  let title = "Game Over";
  if (isVictory) {
    outcome = 'victory';
    title = "Shubhkamnayein! Master of Dharm";
    playSound('correct');
  } else if (isQuit) {
    outcome = 'quit';
    title = "You Chose to Quit / आपने खेल छोड़ दिया";
  }

  gtag('event', 'game_end', {
    'game_mode': gameModeSetting,
    'outcome': outcome,
    'questions_answered': currentIndex
  });

  // Lock the board
  document.querySelectorAll('.option-btn, .lifeline-btn').forEach(btn => btn.style.pointerEvents = 'none');

  document.getElementById('game-ui').style.display = 'block';
  document.getElementById('end-ui').style.display = 'flex';
  document.getElementById('end-status-title').innerText = title;
  document.getElementById('final-prize-val').innerText = `${pointsWon} Points`;
}

function resetToSetup() {
  playSound('click');
  stopTimer();
  if (nextStepTimeout) { clearTimeout(nextStepTimeout); nextStepTimeout = null; }
  pendingNextStepCallback = null;

  lifeline5050Used = false;
  lifelineAudienceUsed = false;
  lifelineFlipUsed = false;

  ['life-5050', 'life-audience', 'life-flip'].forEach(id => {
    document.getElementById(id).classList.remove('used');
  });

  // Unlock the board
  document.querySelectorAll('.option-btn, .lifeline-btn').forEach(btn => btn.style.pointerEvents = 'auto');

  updateHighScoreDisplay();
  document.getElementById('game-ui').style.display = 'block';
  document.getElementById('end-ui').style.display = 'none';
  document.getElementById('setup-modal').style.display = 'flex';
}
