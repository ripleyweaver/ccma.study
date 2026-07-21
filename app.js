// ============================================================
// CCMA Study — app.js v1.3.0
// Quiz engine, domain weighting, randomization, localStorage
// ============================================================

const APP_VERSION  = '1.2.0';

// ============================================================
// UNLOAD PROTECTION
// ============================================================
let unloadProtectionActive = false;
function setUnloadProtection(active) { unloadProtectionActive = active; }
window.addEventListener('beforeunload', e => {
  if (unloadProtectionActive) { e.preventDefault(); e.returnValue = ''; }
});

// ============================================================
// DOMAIN METADATA
// Full NHA names preserved for alignment/validation/reference.
// D3 is split into 6 subdomains matching the test plan exactly.
// ============================================================
const DOMAINS = {
  domain01:  { name: 'Foundational Knowledge and Basic Science',             weight: 15 },
  domain02:  { name: 'Anatomy and Physiology',                               weight: 8  },
  domain03a: { name: 'Clinical Patient Care – Patient Intake and Vitals',    weight: 14 },
  domain03b: { name: 'Clinical Patient Care – General Patient Care',         weight: 28 },
  domain03c: { name: 'Clinical Patient Care – Infection Control and Safety', weight: 15 },
  domain03d: { name: 'Clinical Patient Care – Point of Care Testing and Lab',weight: 9  },
  domain03e: { name: 'Clinical Patient Care – Phlebotomy',                   weight: 12 },
  domain03f: { name: 'Clinical Patient Care – EKG and Cardiovascular Testing',weight: 6 },
  domain04:  { name: 'Patient Care Coordination and Education',              weight: 12 },
  domain05:  { name: 'Administrative Assisting',                             weight: 12 },
  domain06:  { name: 'Communication and Customer Service',                   weight: 12 },
  domain07:  { name: 'Medical Law and Ethics',                               weight: 7  }
};

// Short UI labels — consistent across Performance, Results, Domain Picker, quiz pill.
const DOMAIN_SHORT_LABELS = {
  domain01:    'D1: Foundational Science',
  domain02:    'D2: Anatomy & Physiology',
  domain03a:   'D3A: Patient Intake & Vitals',
  domain03b:   'D3B: General Patient Care',
  domain03c:   'D3C: Infection Control & Safety',
  domain03d:   'D3D: Point-of-Care & Lab',
  domain03e:   'D3E: Phlebotomy',
  domain03f:   'D3F: EKG & Cardiovascular',
  domain04:    'D4: Care Coordination & Education',
  domain05:    'D5: Administrative Assisting',
  domain06:    'D6: Communication & Service',
  domain07:    'D7: Medical Law & Ethics',
  terminology: 'Medical Terminology'
};

// Fixed numeric display order: D1, D2, D3A–F, D4–D7
const DOMAIN_DISPLAY_ORDER = [
  'domain01', 'domain02',
  'domain03a', 'domain03b', 'domain03c', 'domain03d', 'domain03e', 'domain03f',
  'domain04', 'domain05', 'domain06', 'domain07'
];

// Weighted question counts per quiz length.
// 35  = Quick Quiz  (proportional to 150-item exam, sums to 35)
// 180 = Mock Exam   (proportional to 150-item exam × 1.2, sums to 180)
const WEIGHTED_COUNTS = {
  35: {
    domain01: 3, domain02: 2,
    domain03a: 3, domain03b: 7, domain03c: 3, domain03d: 2, domain03e: 3, domain03f: 1,
    domain04: 3, domain05: 3, domain06: 3, domain07: 2
  },
  180: {
    domain01: 18, domain02: 10,
    domain03a: 17, domain03b: 34, domain03c: 18, domain03d: 11, domain03e: 14, domain03f: 7,
    domain04: 14, domain05: 14, domain06: 14, domain07: 9
  }
};

let QUESTIONS    = {};
let currentQuiz  = null;

// ============================================================
// STORAGE
// Theme key is intentionally excluded from clearHistory() —
// it is a preference, not study data.
// ============================================================
const THEME_STORAGE_KEY = 'ccma_theme';

const STORAGE_KEYS = {
  missedPool:        'ccma_missed_pool',
  missedRecovery:    'ccma_missed_recovery',
  answeredCorrectly: 'ccma_answered_correctly'
};

function getStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function setStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error('Storage write error:', key, e); }
}

// ============================================================
// INITIALIZATION
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  setAppState('loading');
  loadQuestions();
  applyInitialTheme();
  registerServiceWorker();
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.error('Service worker registration failed:', err));
  });
}

// ============================================================
// QUESTION VALIDATION + LOADING
// ============================================================
const KNOWN_DOMAIN_KEYS = new Set([
  'domain01', 'domain02',
  'domain03a', 'domain03b', 'domain03c', 'domain03d', 'domain03e', 'domain03f',
  'domain04', 'domain05', 'domain06', 'domain07', 'terminology'
]);

function validateQuestions(data) {
  const errors  = [];
  const seenIds = new Set();

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('questions.json must be a JSON object with domain keys at the top level');
    return errors;
  }

  Object.keys(data).forEach(domKey => {
    if (!KNOWN_DOMAIN_KEYS.has(domKey)) {
      errors.push(`Unknown domain key: "${domKey}"`);
    }
    const questions = data[domKey];
    if (!Array.isArray(questions)) {
      errors.push(`Domain "${domKey}" must be an array`);
      return;
    }
    questions.forEach((q, i) => {
      const ref = `${domKey}[${i}]`;

      // Required fields
      ['id', 'question', 'choices', 'correctIndex', 'explanation'].forEach(field => {
        if (q[field] === undefined || q[field] === null)
          errors.push(`${ref}: missing required field "${field}"`);
      });

      // id
      if (typeof q.id !== 'string' || q.id.trim() === '') {
        errors.push(`${ref}: "id" must be a non-empty string`);
      } else if (seenIds.has(q.id)) {
        errors.push(`${ref}: duplicate id "${q.id}"`);
      } else {
        seenIds.add(q.id);
      }

      // question
      if (typeof q.question !== 'string' || q.question.trim() === '')
        errors.push(`${ref}: "question" must be a non-empty string`);

      // choices — array, min 2, each non-empty string, no duplicates
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        errors.push(`${ref}: "choices" must be an array with at least 2 items`);
      } else {
        if (q.choices.length < 4)
          console.warn(`${ref}: only ${q.choices.length} choices (prefer 4)`);
        q.choices.forEach((c, ci) => {
          if (typeof c !== 'string' || c.trim() === '')
            errors.push(`${ref}: choice ${ci} must be a non-empty string`);
        });
        const normalized = q.choices.map(c => (typeof c === 'string' ? c.trim().toLowerCase() : c));
        if (new Set(normalized).size !== normalized.length)
          errors.push(`${ref}: contains duplicate answer choices`);
      }

      // correctIndex — must be a valid integer index
      if (!Number.isInteger(q.correctIndex) ||
          q.correctIndex < 0 ||
          (Array.isArray(q.choices) && q.correctIndex >= q.choices.length)) {
        errors.push(`${ref}: "correctIndex" must be a valid integer index`);
      }

      // explanation
      if (typeof q.explanation !== 'string' || q.explanation.trim() === '')
        errors.push(`${ref}: "explanation" must be a non-empty string`);
    });
  });

  return errors;
}

function loadQuestions(attempt = 1) {
  fetch('./questions.json', { cache: 'no-store' })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      const errors = validateQuestions(data);
      if (errors.length > 0) {
        errors.forEach(e => console.error('Validation:', e));
        setAppState('error');
        return;
      }
      QUESTIONS = data;
      setAppState('ready');
    })
    .catch(err => {
      console.error(`Failed to load questions.json (attempt ${attempt}):`, err);
      if (attempt < 3) setTimeout(() => loadQuestions(attempt + 1), attempt * 800);
      else setAppState('error');
    });
}

// ============================================================
// APP STATE
// ============================================================
function setAppState(state) {
  const errorBanner = document.getElementById('load-error-banner');
  if (errorBanner) errorBanner.hidden = (state !== 'error');

  if (state !== 'ready') {
    ['quick-btn', 'mock-btn', 'term-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    return;
  }

  const hasPractice    = DOMAIN_DISPLAY_ORDER.some(k => (QUESTIONS[k] || []).length > 0);
  const hasTerminology = (QUESTIONS.terminology || []).length > 0;

  const quickBtn = document.getElementById('quick-btn');
  const mockBtn  = document.getElementById('mock-btn');
  const termBtn  = document.getElementById('term-btn');
  if (quickBtn) quickBtn.disabled = !hasPractice;
  if (mockBtn)  mockBtn.disabled  = !hasPractice;
  if (termBtn)  termBtn.disabled  = !hasTerminology;

  updateMissedButtonState();
}

function retryLoadQuestions() { setAppState('loading'); loadQuestions(); }

// ============================================================
// THEME
// ============================================================
function applyInitialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    applyThemeMode(saved);
  } else {
    const prefersLight = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    applyThemeMode(prefersLight ? 'light' : 'dark');
  }
}

function cycleThemeMode() {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyThemeMode(next);
}

function applyThemeMode(mode) {
  setBodyTheme(mode);
  updateThemeSwitcherUI(mode);
}

const THEME_COLORS       = { light: '#F7F4EF', dark: '#1A1A1A' };
const THEME_ICONS        = { light: '☀️', dark: '🌙' };
const THEME_DISPLAY_NAMES = { light: 'Light', dark: 'Dark' };

function setBodyTheme(mode) {
  document.body.classList.toggle('light', mode === 'light');
  document.body.classList.toggle('dark',  mode === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[mode] || THEME_COLORS.dark);
}

function updateThemeSwitcherUI(mode) {
  const btn  = document.getElementById('theme-switcher');
  const icon = document.getElementById('theme-switcher-icon');
  const name = THEME_DISPLAY_NAMES[mode] || 'Dark';
  if (icon) icon.textContent = THEME_ICONS[mode] || THEME_ICONS.dark;
  if (btn) {
    btn.setAttribute('aria-label', `Theme: ${name}`);
    btn.setAttribute('title',      `Theme: ${name}`);
  }
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
const SCREEN_HEADING_IDS = {
  'domain-picker': 'domain-picker-title',
  'quiz':          'quiz-screen-heading'
};

function scrollScreenToTop(screenEl) {
  if (screenEl) screenEl.scrollTop = 0;
}

function showScreen(name) {
  const screenEl = document.getElementById(`screen-${name}`);
  if (!screenEl) {
    console.error(`Unknown screen: ${name}`);
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screenEl.classList.add('active');
  scrollScreenToTop(screenEl);

  if (name === 'progress')      renderProgressScreen();
  if (name === 'domain-picker') renderDomainPicker();

  const headingId = SCREEN_HEADING_IDS[name];
  const heading   = headingId
    ? document.getElementById(headingId)
    : screenEl.querySelector('h1, h2');
  if (heading) heading.focus({ preventScroll: true });
}

// ============================================================
// MISSED QUESTIONS STATE
// ============================================================
function getAllQuestionIds() {
  const ids = new Set();
  Object.values(QUESTIONS).forEach(arr => arr.forEach(q => ids.add(q.id)));
  return ids;
}

function updateMissedButtonState() {
  const existingIds = getAllQuestionIds();
  const liveMissed  = getStorage(STORAGE_KEYS.missedPool, [])
    .filter(id => existingIds.has(id));
  const count = liveMissed.length;
  const btn = document.getElementById('missed-btn');
  const sub = document.getElementById('missed-sub');
  if (!btn || !sub) return;
  if (count === 0) {
    btn.classList.add('locked');
    btn.disabled    = true;
    sub.textContent = 'No missed questions right now';
  } else {
    btn.classList.remove('locked');
    btn.disabled    = false;
    sub.textContent = `${count} missed \u00b7 35 question max`;
  }
}

// ============================================================
// DOMAIN PICKER
// Uses <button> elements for correct semantics and iOS touch behavior.
// ============================================================
function renderDomainPicker() {
  const list = document.getElementById('domain-pick-list');
  list.innerHTML = '';

  DOMAIN_DISPLAY_ORDER.forEach(key => {
    const count = (QUESTIONS[key] || []).length;
    const btn   = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'domain-pick' + (count === 0 ? ' empty-domain' : '');
    btn.textContent = getDomainDisplayName(key);
    btn.disabled  = count === 0;
    if (count > 0) btn.onclick = () => buildQuiz('domain', 35, key);
    list.appendChild(btn);
  });
}

let lastQuizParams = null; // { type, length, domainKey } — used by retryQuiz()

function retryQuiz() {
  if (!lastQuizParams) { showScreen('home'); return; }
  buildQuiz(lastQuizParams.type, lastQuizParams.length, lastQuizParams.domainKey);
}

function toggleResultsBreakdown() {
  const toggle      = document.getElementById('results-breakdown-toggle');
  const breakdown   = document.getElementById('results-domain-breakdown');
  const isExpanded  = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!isExpanded));
  breakdown.hidden  = isExpanded;
}
function startQuickQuiz()       { buildQuiz('practice',    35,  null); }
function startMockExam()        { buildQuiz('practice',    180, null); }
function startTerminologyQuiz() { buildQuiz('terminology', 35,  null); }

function startMissedQuiz() {
  const existingIds = getAllQuestionIds();
  const liveMissed  = getStorage(STORAGE_KEYS.missedPool, [])
    .filter(id => existingIds.has(id));
  if (liveMissed.length === 0) return;
  buildQuiz('missed', Math.min(liveMissed.length, 35), null);
}

// ============================================================
// QUIZ BUILDING
// ============================================================
function buildQuiz(type, length, domainKey) {
  let pool = [];
  const existingIds = getAllQuestionIds();

  if (type === 'domain') {
    const src = domainKey === 'terminology'
      ? (QUESTIONS.terminology || [])
      : (QUESTIONS[domainKey] || []);
    if (src.length === 0) { alert('No questions available for this domain yet.'); return; }
    pool = shuffle([...src]).slice(0, length).map(q => ({ ...q, sourceDomain: domainKey }));

  } else if (type === 'terminology') {
    const src = QUESTIONS.terminology || [];
    if (src.length === 0) { alert('No terminology questions available yet.'); return; }
    pool = shuffle([...src]).slice(0, length).map(q => ({ ...q, sourceDomain: 'terminology' }));

  } else if (type === 'practice') {
    pool = buildWeightedPool(length);
    if (pool.length === 0) { alert('No questions available yet.'); return; }

  } else if (type === 'missed') {
    const liveMissedIds = getStorage(STORAGE_KEYS.missedPool, [])
      .filter(id => existingIds.has(id));
    if (liveMissedIds.length === 0) return;
    const missedSet = new Set(liveMissedIds);
    const missedQuestions = [];
    // Use DOMAIN_DISPLAY_ORDER to avoid pulling from terminology
    DOMAIN_DISPLAY_ORDER.forEach(dk => {
      (QUESTIONS[dk] || []).forEach(q => {
        if (missedSet.has(q.id)) missedQuestions.push({ ...q, sourceDomain: dk });
      });
    });
    // Also check terminology missed questions
    (QUESTIONS.terminology || []).forEach(q => {
      if (missedSet.has(q.id)) missedQuestions.push({ ...q, sourceDomain: 'terminology' });
    });
    pool = shuffle(missedQuestions).slice(0, length);
  }

  if (pool.length === 0) return;
  pool = pool.map(q => shuffleChoices(q));

  currentQuiz = {
    type, length: pool.length, domainKey,
    questions: pool, currentIndex: 0, answers: [], answeredCurrent: false
  };

  setUnloadProtection(true);
  showScreen('quiz');
  renderQuizQuestion();
}

function buildWeightedPool(length) {
  const counts            = WEIGHTED_COUNTS[length] || WEIGHTED_COUNTS[35];
  const answeredCorrectly = new Set(getStorage(STORAGE_KEYS.answeredCorrectly, []));
  const pool    = [];
  const usedIds = new Set();

  Object.keys(counts).forEach(domKey => {
    const need      = counts[domKey];
    const available = shuffle([...(QUESTIONS[domKey] || [])]);
    let taken = 0;
    for (const q of available) {
      if (taken >= need) break;
      if (!usedIds.has(q.id)) {
        pool.push({ ...q, sourceDomain: domKey });
        usedIds.add(q.id);
        taken++;
      }
    }
    // Backfill from unanswered domain questions only (never terminology)
    if (taken < need) {
      const unanswered = [];
      DOMAIN_DISPLAY_ORDER.forEach(dk => {
        (QUESTIONS[dk] || []).forEach(q => {
          if (!usedIds.has(q.id) && !answeredCorrectly.has(q.id))
            unanswered.push({ ...q, sourceDomain: dk });
        });
      });
      shuffle(unanswered).slice(0, need - taken).forEach(q => {
        pool.push(q); usedIds.add(q.id);
      });
    }
  });

  // Final backfill from any remaining domain questions (never terminology)
  if (pool.length < length) {
    const remaining = [];
    DOMAIN_DISPLAY_ORDER.forEach(dk => {
      (QUESTIONS[dk] || []).forEach(q => {
        if (!usedIds.has(q.id)) remaining.push({ ...q, sourceDomain: dk });
      });
    });
    shuffle(remaining).slice(0, length - pool.length).forEach(q => {
      pool.push(q); usedIds.add(q.id);
    });
  }

  return shuffle(pool).slice(0, length);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleChoices(question) {
  const paired = question.choices.map((text, i) => ({
    text, wasCorrect: i === question.correctIndex
  }));
  const shuffledPairs = shuffle(paired);
  return {
    ...question,
    choices:      shuffledPairs.map(p => p.text),
    correctIndex: shuffledPairs.findIndex(p => p.wasCorrect)
  };
}

// ============================================================
// QUIZ RENDERING
// Uses .choice-wrapper > button.choice + div.choice-explanation-host
// to avoid nested interactive elements (invalid HTML, causes phantom taps on iOS).
// ============================================================
function renderQuizQuestion() {
  scrollScreenToTop(document.getElementById('screen-quiz'));

  const q     = currentQuiz.questions[currentQuiz.currentIndex];
  const total = currentQuiz.questions.length;
  const idx   = currentQuiz.currentIndex + 1;

  document.getElementById('quiz-progress-text').textContent =
    `${String(idx).padStart(2, '0')} / ${total}`;
  document.getElementById('quiz-progress-fill').style.transform =
    `scaleX(${idx / total})`;
  document.getElementById('quiz-domain-label').textContent =
    getDomainDisplayName(q.sourceDomain);
  document.getElementById('quiz-question-text').textContent = q.question;

  // Focus question text so VoiceOver/keyboard users know the question changed
  const questionTextEl = document.getElementById('quiz-question-text');
  questionTextEl.setAttribute('tabindex', '-1');
  questionTextEl.focus({ preventScroll: true });

  const choicesContainer = document.getElementById('quiz-choices');
  choicesContainer.innerHTML = '';

  q.choices.forEach((choiceText, i) => {
    // Wrapper holds the choice button + explanation host as siblings — never nested
    const wrapper = document.createElement('div');
    wrapper.className = 'choice-wrapper';

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'choice';
    btn.setAttribute('aria-label', `Answer ${i + 1} of ${q.choices.length}: ${choiceText}`);
    btn.innerHTML = `
      <span class="choice-row">
        <span class="choice-content">
          <span class="choice-txt">${escapeHtml(choiceText)}</span>
        </span>
        <span class="choice-icon" aria-hidden="true"></span>
      </span>`;
    btn.onclick = () => selectAnswer(i);

    const explanationHost = document.createElement('div');
    explanationHost.className = 'choice-explanation-host';

    wrapper.append(btn, explanationHost);
    choicesContainer.appendChild(wrapper);
  });

  // Screen-reader live region for answer results
  const statusEl = document.getElementById('quiz-answer-status');
  if (statusEl) statusEl.textContent = '';

  document.getElementById('quiz-next-btn').hidden = true;
  currentQuiz.answeredCurrent = false;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getDomainDisplayName(key) {
  return DOMAIN_SHORT_LABELS[key] || (DOMAINS[key] ? DOMAINS[key].name : key);
}

function selectAnswer(choiceIndex) {
  if (currentQuiz.answeredCurrent) return;
  currentQuiz.answeredCurrent = true;

  const q         = currentQuiz.questions[currentQuiz.currentIndex];
  const isCorrect = choiceIndex === q.correctIndex;

  // Announce result to screen readers
  const statusEl = document.getElementById('quiz-answer-status');
  if (statusEl) {
    statusEl.textContent = isCorrect
      ? 'Correct.'
      : `Incorrect. The correct answer is ${q.choices[q.correctIndex]}.`;
  }

  const wrappers = document.querySelectorAll('#quiz-choices .choice-wrapper');
  wrappers.forEach((wrapper, i) => {
    const btn    = wrapper.querySelector('.choice');
    const iconEl = btn.querySelector('.choice-icon');
    btn.disabled = true;

    if (i === q.correctIndex) {
      btn.classList.add('correct');
      wrapper.classList.add('choice-wrapper--answered');
      if (iconEl) iconEl.textContent = 'CORRECT';

      // Inject explanation into sibling host — never inside the button
      const host = wrapper.querySelector('.choice-explanation-host');
      const toggleBtn = document.createElement('button');
      toggleBtn.type      = 'button';
      toggleBtn.className = 'explanation-toggle';
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.innerHTML =
        '<span>Show Explanation</span><span class="chevron" aria-hidden="true">⌄</span>';

      const explanationEl = document.createElement('div');
      explanationEl.className = 'explanation-box';
      explanationEl.hidden    = true;
      explanationEl.textContent = q.explanation;

      toggleBtn.onclick = () => {
        const opening = explanationEl.hidden;
        explanationEl.hidden = !opening;
        toggleBtn.setAttribute('aria-expanded', String(opening));
        toggleBtn.querySelector('span:first-child').textContent =
          opening ? 'Hide Explanation' : 'Show Explanation';
        toggleBtn.querySelector('.chevron').textContent = opening ? '⌃' : '⌄';
      };

      host.append(toggleBtn, explanationEl);

    } else if (i === choiceIndex && !isCorrect) {
      btn.classList.add('incorrect');
      if (iconEl) iconEl.textContent = 'YOUR PICK';
    }
  });

  currentQuiz.answers.push({
    questionId:   q.id,
    correct:      isCorrect,
    sourceDomain: q.sourceDomain
  });

  document.getElementById('quiz-next-btn').hidden = false;
}

function nextQuestion() {
  currentQuiz.currentIndex++;
  if (currentQuiz.currentIndex >= currentQuiz.questions.length) finishQuiz();
  else renderQuizQuestion();
}

function quitQuiz() {
  if (!confirm('Quit this quiz? Your progress on this attempt will not be saved.')) return;
  currentQuiz = null;
  setUnloadProtection(false);
  showScreen('home');
}

// ============================================================
// QUIZ COMPLETION + RESULTS
// ============================================================
function finishQuiz() {
  setUnloadProtection(false);

  // Store params so retryQuiz() can relaunch the same type/length/domain
  lastQuizParams = {
    type:      currentQuiz.type,
    length:    currentQuiz.length,
    domainKey: currentQuiz.domainKey
  };

  const total   = currentQuiz.answers.length;
  const correct = currentQuiz.answers.filter(a => a.correct).length;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;

  currentQuiz.answers.forEach(a => {
    updateMissedPool(a.questionId, a.correct);
    updateAnsweredCorrectly(a.questionId, a.correct);
  });

  const breakdown = {};
  currentQuiz.answers.forEach(a => {
    if (!breakdown[a.sourceDomain])
      breakdown[a.sourceDomain] = { correct: 0, total: 0 };
    breakdown[a.sourceDomain].total++;
    if (a.correct) breakdown[a.sourceDomain].correct++;
  });

  renderResultsScreen({ type: currentQuiz.type, domainKey: currentQuiz.domainKey,
    length: currentQuiz.length, correct, total, percent, breakdown });
  updateMissedButtonState();
  showScreen('results');
}

function renderResultsScreen(record) {
  document.getElementById('results-percent').textContent  = `${record.percent}%`;
  document.getElementById('results-fraction').textContent = `${record.correct} of ${record.total} correct`;
  document.getElementById('results-quiz-type').textContent =
    `${quizTypeLabel(record)} \u00b7 ${record.length} questions`;

  // Reset breakdown toggle to collapsed
  const toggle    = document.getElementById('results-breakdown-toggle');
  const breakdown = document.getElementById('results-domain-breakdown');
  toggle.setAttribute('aria-expanded', 'false');
  breakdown.hidden = true;

  const container = document.getElementById('results-domain-breakdown');
  container.innerHTML = '';

  const orderedKeys = [
    ...DOMAIN_DISPLAY_ORDER.filter(k => record.breakdown[k]),
    ...(record.breakdown.terminology ? ['terminology'] : [])
  ];

  orderedKeys.forEach(key => {
    const stat = record.breakdown[key];
    const pct  = Math.round((stat.correct / stat.total) * 100);
    const row  = document.createElement('div');
    row.className = 'domain-row';
    row.innerHTML = `
      <span class="domain-name">${getDomainDisplayName(key)}</span>
      <span class="domain-score">${pct}%</span>`;
    container.appendChild(row);
  });
}

function quizTypeLabel(record) {
  if (record.type === 'practice' && record.length === 35)  return 'Quick Quiz';
  if (record.type === 'practice' && record.length === 180) return 'Mock Exam';
  if (record.type === 'terminology') return 'Medical Terminology';
  if (record.type === 'missed')      return 'Missed Questions';
  if (record.type === 'domain')      return getDomainDisplayName(record.domainKey);
  return 'Quiz';
}

// ============================================================
// PERFORMANCE SCREEN
// ============================================================
function renderProgressScreen() {
  const existingIds       = getAllQuestionIds();
  const answeredCorrectly = new Set(
    getStorage(STORAGE_KEYS.answeredCorrectly, []).filter(id => existingIds.has(id))
  );
  const listEl = document.getElementById('domain-score-list');
  listEl.innerHTML = '';

  function makeRow(key) {
    const total    = (QUESTIONS[key] || []).length;
    const mastered = (QUESTIONS[key] || []).filter(q => answeredCorrectly.has(q.id)).length;
    const row = document.createElement('div');
    row.className = 'domain-row';
    const score = total > 0
      ? `<span class="domain-score">${Math.round((mastered / total) * 100)}%</span>`
      : `<span class="domain-score empty">—</span>`;
    row.innerHTML = `<span class="domain-name">${getDomainDisplayName(key)}</span>${score}`;
    return row;
  }

  DOMAIN_DISPLAY_ORDER.forEach(key => listEl.appendChild(makeRow(key)));
  listEl.appendChild(makeRow('terminology'));
}

// ============================================================
// MISSED POOL + RECOVERY
// Requires MISSED_RECOVERY_REQUIRED correct answers to graduate.
// Wrong answer while in pool resets the count to 0.
// ============================================================
const MISSED_RECOVERY_REQUIRED = 3;

function updateMissedPool(questionId, isCorrect) {
  let missed   = getStorage(STORAGE_KEYS.missedPool,     []);
  let recovery = getStorage(STORAGE_KEYS.missedRecovery, {});
  const inMissed = missed.includes(questionId);

  if (!isCorrect) {
    if (!inMissed) missed.push(questionId);
    recovery[questionId] = 0;
  } else if (inMissed) {
    recovery[questionId] = (recovery[questionId] || 0) + 1;
    if (recovery[questionId] >= MISSED_RECOVERY_REQUIRED) {
      missed = missed.filter(id => id !== questionId);
      delete recovery[questionId];
    }
  }

  setStorage(STORAGE_KEYS.missedPool,     missed);
  setStorage(STORAGE_KEYS.missedRecovery, recovery);
}

function updateAnsweredCorrectly(questionId, isCorrect) {
  if (!isCorrect) return;
  const set = new Set(getStorage(STORAGE_KEYS.answeredCorrectly, []));
  set.add(questionId);
  setStorage(STORAGE_KEYS.answeredCorrectly, [...set]);
}

// ============================================================
// CLEAR HISTORY
// Clears study data only. THEME_STORAGE_KEY is intentionally preserved.
// ============================================================
function clearHistory() {
  if (!confirm(
    'This will permanently erase all domain scores and missed questions. ' +
    'This cannot be undone. Continue?'
  )) return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  updateMissedButtonState();
  renderProgressScreen();
}
