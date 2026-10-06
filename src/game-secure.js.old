    const SUPABASE_URL = "https://ndfdcobmnxsvtrdqpqti.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_-CMSV99N3ovQggn-eJhLLA_z5WFtag4";
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // URL Parameter Helpers (unchanged)
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

    let customThanksMessage = "Thank you for playing Kaun Banega Dharm Shiromani!";
    let customInstructionsTitle = "Instructions / नियम एवं निर्देश";
    let customInstructionsBody = "No specific instructions provided.";

    const prizeLadder = [
      "1,000", "2,000", "3,000", "5,000", "10,000",
      "20,000", "40,000", "80,000", "1,60,000", "3,20,000",
      "6,40,000", "12,50,000", "25,00,000", "50,00,000", "7,00,00,000"
    ];

    // ------------------------------------------------------------
    // The client never holds the question bank anymore. It only
    // ever holds:
    //   - distinctLevels / availableCount: shape metadata (no
    //     question text or answers) used to reproduce the same
    //     level-targeting math the old code used.
    //   - currentQuestionData: the ONE question being shown right
    //     now, with options that carry no "isCorrect" flag at all.
    //   - currentExplanation: only populated AFTER the server has
    //     scored an answer (so it can't be used to peek ahead).
    // ------------------------------------------------------------
    let gameSessionId = null;
    let distinctLevels = [];
    let availableCount = 0;
    let usedQuestionIDs = new Set();
    let currentQuestionData = null;
    let currentExplanation = null;
    let currentIndex = 0;
    let maxGameQuestions = 15; // Standard 15-question game
    let canSelect = true;

    let lifeline5050Used = false;
    let lifelineAudienceUsed = false;
    let lifelineFlipUsed = false;
    let currentOptions = [];

    let isTimedMode = false;
    let timeLimitPerQuestion = 30;
    let timeRemaining = 0;
    let timerInterval = null;

    let nextStepTimeout = null;
    let pendingNextStepCallback = null;

    window.addEventListener('DOMContentLoaded', initApp);

    async function initApp() {
      loadGameParams();
      await loadQuestionBankMeta();
    }

    // Reads editable settings from window.gameParams, which comes
    // from params.js (loaded via a normal <script src="params.js">
    // tag in the HTML, before this file). That's a plain script
    // load, not a fetch() call, so — unlike the old Excel-reading
    // approach — this works fine even when the page is opened
    // directly from disk (file://), no local web server required.
    //
    // To add a new setting later: add a key to the object in
    // params.js, then read it here the same way as the ones below.
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

    // Replaces loadAndDecryptQuestions(). Instead of fetching and
    // decrypting the whole bank, this asks the server for shape
    // metadata only: which levels exist, and how many questions
    // are available for the current mode. No question content
    // and no answers ever travel over this call.
    async function loadQuestionBankMeta() {
      const statusEl = document.getElementById("status-msg");
      const startBtn = document.getElementById("start-btn");

      try {
        statusEl.innerText = "Connecting to question bank...";
        statusEl.style.color = "#38bdf8";

        gameSessionId = crypto.randomUUID();

        let qtypeFilter = null;
        if (isDebugMode() && !isDebugQuestionMode()) {
          // debug=true without question param defaults to Media-Only mode
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
          maxGameQuestions = 1; // Only 1 question to test; end immediately after
        } else if (isDebugMode()) {
          maxGameQuestions = Math.min(15, availableCount);
        } else {
          maxGameQuestions = 15;
        }

        statusEl.innerText = `Loaded questions successfully!`;
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

    // Now reads from currentExplanation, which is only filled in
    // after the server has scored the current question — so
    // there is nothing to leak by opening this early.
    function openExplanationModal() {
      if (!currentExplanation) return;

      stopTimer();

      if (nextStepTimeout) {
        clearTimeout(nextStepTimeout);
        nextStepTimeout = null;
      }

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

    // Replaces getNextQuestion(). Instead of picking from a local
    // in-memory bank, this asks the server for exactly one
    // question, using the same level-targeting math the old code
    // used client-side. The server does the neighbouring-level
    // fallback search now, since only it can see the full bank.
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
      }
    }

/*
    function setupBulbState(makeActive = false, explanation = null) {
      const bulbBtn = document.getElementById('bulb-btn');

      // Explanation text isn't known client-side until AFTER the
      // server scores an answer (it can give away the answer),
      // so with no explanation passed in, the bulb stays hidden.
      const expEn = (explanation && explanation.en) ? explanation.en.trim() : "";
      const expHi = (explanation && explanation.hi) ? explanation.hi.trim() : "";
      const hasExplanation = (expEn !== "" || expHi !== "");

      currentExplanation = hasExplanation ? { en: expEn, hi: expHi } : null;

      if (hasExplanation) {
        bulbBtn.style.display = 'flex';
        if (makeActive) {
          bulbBtn.classList.add('active-bulb');
        } else {
          bulbBtn.classList.remove('active-bulb');
        }
      } else {
        bulbBtn.style.display = 'none';
        bulbBtn.classList.remove('active-bulb');
      }
    }
*/

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
        questionBox.onclick = openExplanationModal; // Makes the whole box trigger the modal
      }
    } else {
      bulbBtn.classList.remove('active-bulb');
      if (questionBox) {
        questionBox.classList.remove('clickable-explanation');
        questionBox.onclick = null; // Removes click behavior when inactive
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
    async function startGame() {
      const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
      isTimedMode = (selectedMode === "timed");

      if (isTimedMode) {
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

    async function loadQuestion() {
      canSelect = true;
      stopTimer();
      timeRemaining = timeLimitPerQuestion; // Reset remaining time for the new question
      if (nextStepTimeout) { clearTimeout(nextStepTimeout); nextStepTimeout = null; }
      pendingNextStepCallback = null;

      if (currentIndex >= maxGameQuestions) {
        endGame(true);
        return;
      }

      currentQuestionData = await fetchNextQuestion();

      if (!currentQuestionData) {
        endGame(true);
        return;
      }

      setupBulbState(false, null);

      document.getElementById('lbl-level').innerText = `${currentQuestionData.qId}9${currentQuestionData.numericLevel * 10}`;

      const currentPrize = prizeLadder[Math.min(currentIndex, prizeLadder.length - 1)];
      document.getElementById('lbl-prize').innerText = `Question ${currentIndex + 1} • Points: ${currentPrize}`;

      document.getElementById('lbl-question-en').innerText = currentQuestionData.en.qText;
      document.getElementById('lbl-question-hi').innerText = currentQuestionData.hi.qText;

      // Options arrive already shuffled by the server, with the
      // correct one's position tracked only server-side against
      // this question's attemptToken — do NOT reshuffle here.
      currentOptions = currentQuestionData.options;

      renderOptions();

      const mediaBtn = document.getElementById('life-media-replay');
      if (['P', 'A', 'V'].includes(currentQuestionData.qType)) {
        let mediaIconSvg = '';
        if (currentQuestionData.qType === 'P') {
          mediaIconSvg = `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="50" rx="75" ry="45" fill="#0284c7" stroke="#032b43" stroke-width="2"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="#032b43"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="none" stroke="#38bdf8" stroke-width="3"/>
            <g fill="#38bdf8">
              <rect x="52" y="32" width="56" height="36" rx="4" fill="none" stroke="#38bdf8" stroke-width="3"/>
              <circle cx="64" cy="42" r="4"/>
              <polygon points="56,62 70,48 80,58 92,44 104,62"/>
            </g>
          </svg>`;
        } else if (currentQuestionData.qType === 'A') {
          mediaIconSvg = `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="50" rx="75" ry="45" fill="#0284c7" stroke="#032b43" stroke-width="2"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="#032b43"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="none" stroke="#38bdf8" stroke-width="3"/>
            <g fill="#38bdf8">
              <ellipse cx="56" cy="62" rx="7" ry="5" transform="rotate(-20 56 62)"/>
              <ellipse cx="88" cy="56" rx="7" ry="5" transform="rotate(-20 88 56)"/>
              <path d="M 61 60 V 34 L 93 28 V 54 L 89 54 V 32 L 65 37 V 60 Z"/>
            </g>
          </svg>`;
        } else if (currentQuestionData.qType === 'V') {
          mediaIconSvg = `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="50" rx="75" ry="45" fill="#0284c7" stroke="#032b43" stroke-width="2"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="#032b43"/>
            <ellipse cx="80" cy="50" rx="65" ry="36" fill="none" stroke="#38bdf8" stroke-width="3"/>
            <g fill="#38bdf8">
              <rect x="52" y="34" width="38" height="32" rx="4"/>
              <polygon points="94,40 108,32 108,68 94,60"/>
            </g>
          </svg>`;
        }
        mediaBtn.innerHTML = mediaIconSvg;
        mediaBtn.style.display = 'inline-flex';
        showMediaModal(currentQuestionData.qType, currentQuestionData.mediaUrl);
      } else {
        mediaBtn.style.display = 'none';
        startTimer();
      }
    }

    function replayMedia() {
      if (!currentQuestionData || !['P', 'A', 'V'].includes(currentQuestionData.qType)) return;
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
      const containerEl = document.getElementById('media-content');
      const mediaElements = containerEl.querySelectorAll('audio, video');
      mediaElements.forEach(el => el.pause());

      document.getElementById('media-modal').style.display = 'none';

      if (canSelect && isTimedMode) {
        if (timeRemaining > 0 && timeRemaining < timeLimitPerQuestion) {
          resumeTimer();
        } else {
          startTimer();
        }
      }
    }

    // Renders by index now (no isCorrect flag exists client-side
    // to attach to each option).
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

        btn.onclick = () => handleSelection(btn, idx);
        grid.appendChild(btn);
      });
    }

    // Replaces the old client-side opt.isCorrect check with a
    // call to submit_answer(), which is the only place that knows
    // the right answer for this attemptToken.
    async function handleSelection(selectedBtn, selectedIndex) {
      if (!canSelect) return;
      canSelect = false;
      stopTimer();

      selectedBtn.classList.add('selected');

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

      setTimeout(() => {
        setupBulbState(true, { en: result.explanationEn, hi: result.explanationHi });

        if (result.isCorrect) {
          selectedBtn.classList.remove('selected');
          selectedBtn.classList.add('correct');

          pendingNextStepCallback = async () => {
            currentIndex++;
            if (currentIndex < maxGameQuestions) {
              await loadQuestion();
            } else {
              endGame(true);
            }
          };

          nextStepTimeout = setTimeout(() => {
            if (pendingNextStepCallback) {
              const cb = pendingNextStepCallback;
              pendingNextStepCallback = null;
              cb();
            }
          }, 5000);

        } else {
          selectedBtn.classList.remove('selected');
          selectedBtn.classList.add('incorrect');

          const correctBtn = document.getElementById(`opt-btn-${result.correctIndex}`);
          if (correctBtn) correctBtn.classList.add('correct');

          pendingNextStepCallback = () => {
            endGame(false);
          };

          nextStepTimeout = setTimeout(() => {
            if (pendingNextStepCallback) {
              const cb = pendingNextStepCallback;
              pendingNextStepCallback = null;
              cb();
            }
          }, 6000);
        }
      }, 1200);
    }

    function startTimer() {
      stopTimer();
      if (!isTimedMode) return;

      timeRemaining = timeLimitPerQuestion;
      updateTimerUI();

      timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerUI();
        if (timeRemaining <= 0) {
          stopTimer();
          handleTimeout();
        }
      }, 1000);
    }

    function resumeTimer() {
      stopTimer();
      if (!isTimedMode) return;

      updateTimerUI();
      timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerUI();
        if (timeRemaining <= 0) {
          stopTimer();
          handleTimeout();
        }
      }, 1000);
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

    // Timeout now also asks the server for the correct answer
    // (via the same submit_answer RPC, with selectedIndex -1),
    // since the client has no way to know it on its own.
    async function handleTimeout() {
      canSelect = false;

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

      pendingNextStepCallback = () => {
        alert("Time is up! / समय समाप्त!");
        endGame(false);
      };

      nextStepTimeout = setTimeout(() => {
        if (pendingNextStepCallback) {
          const cb = pendingNextStepCallback;
          pendingNextStepCallback = null;
          cb();
        }
      }, 4000);
    }

    // Now asks the server which two indices are safe to hide,
    // instead of checking a client-side isCorrect flag.
    async function use5050() {
      if (lifeline5050Used || !canSelect) return;
      lifeline5050Used = true;
      document.getElementById('life-5050').classList.add('used');

      try {
        const { data, error } = await supabaseClient.rpc('use_5050', {
          p_token: currentQuestionData.attemptToken
        });
        if (error || !data || !data.hideIndices) throw error || new Error("No response");

        data.hideIndices.forEach(idx => {
          const btn = document.getElementById(`opt-btn-${idx}`);
          if (btn) btn.style.visibility = 'hidden';
        });
      } catch (e) {
        console.error("50-50 lifeline failed:", e);
      }
    }

    // Now asks the server for the percentages, instead of
    // computing them from a client-side correct index.
    async function useAudience() {
      if (lifelineAudienceUsed || !canSelect) return;
      stopTimer();
      lifelineAudienceUsed = true;
      document.getElementById('life-audience').classList.add('used');

      const activeIndices = [];
      for (let i = 0; i < 4; i++) {
        const btn = document.getElementById(`opt-btn-${i}`);
        if (btn && btn.style.visibility !== 'hidden') {
          activeIndices.push(i);
        }
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

        const pollModal = document.getElementById("poll-modal");
        pollModal.style.display = "flex";

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (let i = 0; i < 4; i++) {
              document.getElementById(`pbar-${i}`).style.height = percentages[i] + "%";
            }
          });
        });
      } catch (e) {
        console.error("Audience lifeline failed:", e);
      }
    }

    function closePoll() {
      document.getElementById("poll-modal").style.display = "none";
      if (canSelect && isTimedMode && timeRemaining > 0) {
        resumeTimer();
      }
    }

    async function useFlip() {
      if (lifelineFlipUsed || !canSelect) return;
      lifelineFlipUsed = true;
      document.getElementById('life-flip').classList.add('used');

      await loadQuestion();
    }

    function useQuit() {
      if (!canSelect) return;
      stopTimer();

      const safeVal = currentIndex > 0 ? prizeLadder[currentIndex - 1] : "0";
      document.getElementById('quit-modal-msg').innerText = `Are you sure you want to quit? You will leave with ${safeVal} Points. / क्या आप खेल छोड़ना चाहते हैं? आप ${safeVal} पॉइंट्स लेकर जाएंगे।`;
      document.getElementById('quit-modal').style.display = 'flex';
    }

    function closeQuitModal() {
      document.getElementById('quit-modal').style.display = 'none';
      if (canSelect && isTimedMode && timeRemaining > 0) {
        resumeTimer();
      }
    }

    function confirmQuit() {
      document.getElementById('quit-modal').style.display = 'none';
      endGame(false, true);
    }

    function endGame(isVictory, isQuit = false) {
      stopTimer();
      canSelect = false;

      const optionButtons = document.querySelectorAll('.option-btn');
      optionButtons.forEach(btn => btn.style.pointerEvents = 'none');

      const lifelineButtons = document.querySelectorAll('.lifeline-btn');
      lifelineButtons.forEach(btn => btn.style.pointerEvents = 'none');

      document.getElementById('game-ui').style.display = 'block';
      document.getElementById('end-ui').style.display = 'flex';

      const finalVal = currentIndex > 0 ? prizeLadder[Math.min(currentIndex - 1, prizeLadder.length - 1)] : "0";

      if (isVictory) {
        document.getElementById('end-status-title').innerText = "Shubhkamnayein! Master of Dharm";
        document.getElementById('final-prize-val').innerText = `${prizeLadder[Math.min(currentIndex, prizeLadder.length - 1)]} Points`;
      } else if (isQuit) {
        document.getElementById('end-status-title').innerText = "You Chose to Quit / आपने खेल छोड़ दिया";
        document.getElementById('final-prize-val').innerText = `${finalVal} Points`;
      } else {
        document.getElementById('end-status-title').innerText = "Game Over";
        document.getElementById('final-prize-val').innerText = `${finalVal} Points`;
      }
    }

    function resetToSetup() {
      stopTimer();
      if (nextStepTimeout) { clearTimeout(nextStepTimeout); nextStepTimeout = null; }
      pendingNextStepCallback = null;

      lifeline5050Used = false;
      lifelineAudienceUsed = false;
      lifelineFlipUsed = false;

      document.getElementById('life-5050').classList.remove('used');
      document.getElementById('life-audience').classList.remove('used');
      document.getElementById('life-flip').classList.remove('used');

      const optionButtons = document.querySelectorAll('.option-btn');
      optionButtons.forEach(btn => btn.style.pointerEvents = 'auto');

      const lifelineButtons = document.querySelectorAll('.lifeline-btn');
      lifelineButtons.forEach(btn => btn.style.pointerEvents = 'auto');

      document.getElementById('game-ui').style.display = 'block';
      document.getElementById('end-ui').style.display = 'none';
      document.getElementById('setup-modal').style.display = 'flex';
    }

