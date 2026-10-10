// ==========================================
// CONFIGURATION & INITIALIZATION
// ==========================================

const SUPABASE_URL = "https://ndfdcobmnxsvtrdqpqti.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-CMSV99N3ovQggn-eJhLLA_z5WFtag4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let customThanksMessage = "Thank you for playing Kaun Banega Dharm Shiromani!";
let customInstructionsTitle = "Instructions / नियम एवं निर्देश";
let customInstructionsBody = "No specific instructions provided.";

const prizeLadder = [
  "1,000", "2,000", "3,000", "5,000", "10,000",
  "20,000", "40,000", "80,000", "1,60,000", "3,20,000",
  "6,40,000", "12,50,000", "25,00,000", "50,00,000", "7,00,00,000"
];

// Game State Variables
let gameSessionId = null;
let distinctLevels = [];
let availableCount = 0;
let usedQuestionIDs = new Set();
let currentQuestionData = null;
let currentExplanation = null;
let currentIndex = 0;
let maxGameQuestions = 15; // Standard 15-question game
let canSelect = true;
let gameModeSetting = "untimed";

// Lifelines State
let lifeline5050Used = false;
let lifelineAudienceUsed = false;
let lifelineFlipUsed = false;
let currentOptions = [];

// Timer State
let isTimedMode = false;
let timeLimitPerQuestion = 30;
let timeRemaining = 0;
let timerInterval = null;

// Flow Control State
let nextStepTimeout = null;
let pendingNextStepCallback = null;

window.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  loadGameParams();
  await loadQuestionBankMeta();
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

    gameSessionId = crypto.randomUUID();

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
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function isDebugMode() {
  const currentFilename = window.location.pathname.split('/').pop().toLowerCase();
  const isDebug = getUrlParam('debug') === 'true';
  return currentFilename !== 'index.html' && isDebug;
}

function isDebugQuestionMode() {
  return isDebugMode() && getUrlParam('question') !== null;
}


// ==========================================
// MODALS & UI HELPERS
// ==========================================

function openInstructionsModal() {
  document.getElementById('instructions-title').innerText = customInstructionsTitle;
  document.getElementById('instructions-body').innerHTML = customInstructionsBody;
  document.getElementById('instructions-modal').style.display = 'flex';
}

function closeInstructionsModal() {
  document.getElementById('instructions-modal').style.display = 'none';
}

function openThanksModal() {
  document.getElementById('thanks-msg-body').innerHTML = customThanksMessage;
  document.getElementById('thanks-modal').style.display = 'flex';
}

function closeThanksModal() {
  document.getElementById('thanks-modal').style.display = 'none';
}

function openExplanationModal() {
  if (!currentExplanation) return;

  stopTimer();

  if (nextStepTimeout) {
    clearTimeout(nextStepTimeout);
    nextStepTimeout = null;
  }

  // GA4 Tracking: Explanation Viewed
  gtag('event', 'explanation_viewed', {
    'game_mode': gameModeSetting,
    'question_index': currentIndex + 1,
    'question_level': currentQuestionData ? currentQuestionData.numericLevel : 'unknown'
  });

  document.getElementById('modal-explanation-en').innerHTML = currentExplanation.en || "";
  document.getElementById('modal-explanation-hi').innerHTML = currentExplanation.hi || "";
  document.getElementById('explanation-modal').style.display = 'flex';
}

function closeExplanationModal() {
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
  document.getElementById("timer-input-group").style.display = show ? "flex" : "none";
}

function setupBulbState(makeActive = false, explanation = null) {
  const bulbBtn = document.getElementById('bulb-btn');
  const questionBox = document.querySelector('.question-box');

  const expEn = (explanation && explanation.en) ? explanation.en.trim() : "";
  const expHi = (explanation && explanation.hi) ? explanation.hi.trim() : "";
  const hasExplanation = (expEn !== "" || expHi !== "");

  currentExplanation = hasExplanation ? { en: expEn, hi: expHi } : null;

  if (hasExplanation) {
    bulbBtn.style.display = 'flex';
    if (makeActive) {
      bulbBtn.classList.add('active-bulb');
      if (questionBox) {
        questionBox.classList.add('clickable-explanation');
        questionBox.onclick = openExplanationModal;
      }
    } else {
      bulbBtn.classList.remove('active-bulb');
      if (questionBox) {
        questionBox.classList.remove('clickable-explanation');
        questionBox.onclick = null;
      }
    }
  } else {
    bulbBtn.style.display = 'none';
    bulbBtn.classList.remove('active-bulb');
    if (questionBox) {
      questionBox.classList.remove('clickable-explanation');
      questionBox.onclick = null;
    }
  }
}


// ==========================================
// GAMEFLOW & QUESTION MANAGEMENT
// ==========================================

async function startGame() {
  const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
  gameModeSetting = selectedMode;

  gtag('event', 'game_start', {
    'game_mode': gameModeSetting
  });

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
  await loadQuestion();
}

async function fetchNextQuestion() {
  if (distinctLevels.length === 0) return null;

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
    return data;
  } catch (e) {
    console.error("Failed to fetch question:", e);
    return null;
