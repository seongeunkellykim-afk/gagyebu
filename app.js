// 예전에 브라우저 localStorage에 저장하던 키 (Supabase로 옮겨 올 때만 읽는다)
const STORAGE_KEY = 'gagyebu.entries';
const WEATHER_KEY = 'gagyebu.weather';
const IMPORTED_KEY = 'gagyebu.importedToSupabase';
const WEATHERS = [
  { value: 'sunny', icon: '☀️', label: '맑음' },
  { value: 'partly', icon: '⛅', label: '구름' },
  { value: 'cloudy', icon: '☁️', label: '흐림' },
  { value: 'rain', icon: '🌧️', label: '비' },
  { value: 'snow', icon: '❄️', label: '눈' },
];
const CATEGORIES = {
  expense: ['식비', '교통', '주거', '통신', '쇼핑', '여행', '의료', '문화', '기타'],
  income: ['월급', '용돈', '부수입', '기타'],
};

const form = document.getElementById('entryForm');
const categorySelect = form.elements.category;

const authForm = document.getElementById('authForm');
const authStatus = document.getElementById('authStatus');

let entries = [];
// 처음 세션을 받기 전에는 undefined라서, 로그아웃 상태(null)도 한 번은 화면에 반영된다
let userId;
let loading = false;
// 예전 버전에서 이 브라우저에 남겨 둔, 아직 옮기지 않은 데이터
let pendingLocal = null;
let current = thisMonth();
let chartMode = 'day';
let chart = null;

// 예전 localStorage 데이터에서 예시 데이터는 id가 1부터 매겨져 있고,
// 직접 추가한 내역은 id가 Date.now() 값이라 구분된다
function isSample(e) {
  return e.id < 1e12;
}

// Supabase로 아직 옮기지 않은, 이 브라우저에만 있는 내역과 날씨
function localData() {
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return null;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const own = saved.filter(e => !isSample(e));
    const weather = JSON.parse(localStorage.getItem(WEATHER_KEY)) || {};
    return own.length || Object.keys(weather).length ? { entries: own, weather } : null;
  } catch {
    return null;
  }
}

const withoutId = ({ id, ...rest }) => rest;
const errorText = err => err?.message || String(err);

const won = n => n.toLocaleString('ko-KR') + '원';
const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact' });
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function thisMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function todayStr() {
  const d = new Date();
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fillCategories() {
  const type = form.elements.type.value;
  categorySelect.replaceChildren(...CATEGORIES[type].map(c => new Option(c, c)));
}

function render() {
  const key = monthKey(current);
  document.getElementById('monthLabel').textContent =
    `${current.getFullYear()}년 ${current.getMonth() + 1}월`;

  const list = entries
    .filter(e => e.date.startsWith(key))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  // 요약
  let income = 0;
  let expense = 0;
  for (const e of list) {
    if (e.type === 'income') income += e.amount;
    else expense += e.amount;
  }
  document.getElementById('sumIncome').textContent = won(income);
  document.getElementById('sumExpense').textContent = won(expense);
  const balanceEl = document.getElementById('sumBalance');
  balanceEl.textContent = won(income - expense);
  balanceEl.className = income - expense < 0 ? 'expense' : '';

  // 분류별 지출
  const byCategory = {};
  for (const e of list) {
    if (e.type === 'expense') byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = categories.length ? categories[0][1] : 0;
  const categoryList = document.getElementById('categoryList');
  categoryList.replaceChildren();
  if (!categories.length) {
    categoryList.append(el('li', 'empty', '이번 달 지출이 없습니다.'));
  }
  for (const [name, total] of categories) {
    const li = el('li');
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${(total / max) * 100}%`;
    bar.append(fill);
    li.append(el('span', '', name), bar, el('span', 'value', won(total)));
    categoryList.append(li);
  }

  // 내역 목록
  const entryList = document.getElementById('entryList');
  entryList.replaceChildren();
  if (!list.length) {
    entryList.append(el('li', 'empty', '내역이 없습니다.'));
  }
  for (const e of list) {
    const li = el('li');
    const [, m, d] = e.date.split('-');
    const sign = e.type === 'income' ? '+' : '-';
    const del = el('button', 'del', '✕');
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.addEventListener('click', () => removeEntry(e.id));
    li.append(
      el('span', 'date', `${m}.${d}`),
      el('span', 'tag', e.category),
      el('span', 'memo', e.memo),
      el('span', `amount ${e.type}`, sign + won(e.amount)),
      del,
    );
    entryList.append(li);
  }

  if (loading) entryList.replaceChildren(el('li', 'empty', '불러오는 중…'));

  renderChart();
  renderTools();
}

// 데이터 관리: 비어 있을 때만 예시 데이터 버튼을, 옮길 게 있을 때만 가져오기 버튼을 보여준다
function renderTools() {
  document.getElementById('loadSample').hidden = loading || entries.length > 0;
  const importBtn = document.getElementById('importLocal');
  importBtn.hidden = loading || !pendingLocal;
  if (pendingLocal) importBtn.textContent = `이 브라우저 내역 ${pendingLocal.entries.length}건 가져오기`;
}

// 그래프에 쓸 기간별 합계. 일별은 지출만, 월별/연도별은 수입과 지출을 함께 보여준다.
// (일별에 수입을 넣으면 월급날 막대 하나 때문에 나머지 지출이 안 보인다.)
function chartData() {
  const y = current.getFullYear();
  const m = current.getMonth();

  if (chartMode === 'day') {
    const days = new Date(y, m + 1, 0).getDate();
    const expense = new Array(days).fill(0);
    const key = monthKey(current);
    for (const e of entries) {
      if (e.type === 'expense' && e.date.startsWith(key)) expense[Number(e.date.slice(8)) - 1] += e.amount;
    }
    return {
      title: `${y}년 ${m + 1}월 일별 지출`,
      labels: Array.from({ length: days }, (_, i) => `${i + 1}일`),
      series: [{ type: 'expense', data: expense }],
      hint: '위의 ‹ › 버튼으로 다른 달을 볼 수 있습니다.',
    };
  }

  if (chartMode === 'month') {
    const income = new Array(12).fill(0);
    const expense = new Array(12).fill(0);
    for (const e of entries) {
      if (!e.date.startsWith(`${y}-`)) continue;
      const i = Number(e.date.slice(5, 7)) - 1;
      (e.type === 'income' ? income : expense)[i] += e.amount;
    }
    return {
      title: `${y}년 월별 수입·지출`,
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      series: [{ type: 'income', data: income }, { type: 'expense', data: expense }],
      hint: '막대를 누르면 그 달의 일별 그래프로 이동합니다.',
      drill: i => {
        current = new Date(y, i, 1);
        setChartMode('day');
      },
    };
  }

  const years = entries.map(e => Number(e.date.slice(0, 4)));
  const first = Math.min(y, ...years);
  const last = Math.max(y, ...years);
  const yearList = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const income = yearList.map(() => 0);
  const expense = yearList.map(() => 0);
  for (const e of entries) {
    const i = Number(e.date.slice(0, 4)) - first;
    (e.type === 'income' ? income : expense)[i] += e.amount;
  }
  return {
    title: '연도별 수입·지출',
    labels: yearList.map(year => `${year}년`),
    series: [{ type: 'income', data: income }, { type: 'expense', data: expense }],
    hint: '막대를 누르면 그 해의 월별 그래프로 이동합니다.',
    drill: i => {
      current = new Date(yearList[i], current.getMonth(), 1);
      setChartMode('month');
    },
  };
}

const seriesLabel = type => (type === 'income' ? '수입' : '지출');

function renderChart() {
  const { title, labels, series, hint, drill } = chartData();
  document.getElementById('chartTitle').textContent = title;
  document.getElementById('chartHint').textContent = hint;
  renderChartTable(labels, series);

  const box = document.getElementById('chartBox');
  if (typeof Chart === 'undefined') {
    box.replaceChildren(el('div', 'chart-error', '그래프 라이브러리를 불러오지 못했습니다.\n인터넷 연결을 확인해 주세요.'));
    return;
  }

  // 다크 모드에서도 맞는 색을 쓰도록 CSS 변수에서 읽는다
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(name).trim();

  // 막대가 굵기 상한(24px)에 걸려도 수입·지출 막대가 2px 간격으로 붙어 있도록 묶음 폭을 맞춘다
  const slotWidth = box.clientWidth / labels.length;
  const categoryPercentage = Math.min(0.8, (series.length * 26) / slotWidth);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: series.map(s => ({
        label: seriesLabel(s.type),
        data: s.data,
        backgroundColor: color(s.type === 'income' ? '--income' : '--expense'),
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 24,
        barPercentage: 0.92,
        categoryPercentage,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1,
          align: 'end',
          labels: { color: color('--muted'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10 },
        },
        tooltip: {
          callbacks: { label: c => ` ${c.dataset.label} ${won(c.parsed.y)}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: color('--axis') },
          ticks: { color: color('--muted'), maxRotation: 0, autoSkipPadding: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: color('--grid') },
          border: { display: false },
          ticks: { color: color('--muted'), maxTicksLimit: 5, callback: n => compact.format(n) },
        },
      },
      onClick: (_, elements) => {
        if (drill && elements.length) drill(elements[0].index);
      },
      onHover: (evt, elements) => {
        if (evt.native) evt.native.target.style.cursor = drill && elements.length ? 'pointer' : 'default';
      },
    },
  });
}

// 그래프와 같은 값을 표로도 보여준다
function renderChartTable(labels, series) {
  const table = document.getElementById('chartTable');
  const head = el('tr');
  head.append(el('th', '', '기간'), ...series.map(s => el('th', '', seriesLabel(s.type))));
  const rows = labels.map((label, i) => {
    const tr = el('tr');
    tr.append(el('td', '', label), ...series.map(s => el('td', '', won(s.data[i]))));
    return tr;
  });
  table.replaceChildren(head, ...rows);
}

function setChartMode(mode) {
  chartMode = mode;
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  render();
}

async function removeEntry(id) {
  if (!confirm('이 내역을 삭제할까요?')) return;
  try {
    await deleteEntry(id);
  } catch (err) {
    alert('삭제하지 못했습니다.\n' + errorText(err));
    return;
  }
  entries = entries.filter(e => e.id !== id);
  render();
}

form.addEventListener('change', e => {
  if (e.target.name === 'type') fillCategories();
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const amount = Math.round(Number(form.elements.amount.value));
  if (!amount || amount <= 0) return;

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  let entry;
  try {
    [entry] = await insertEntries([{
      type: form.elements.type.value,
      date: form.elements.date.value,
      category: categorySelect.value,
      amount,
      memo: form.elements.memo.value.trim(),
    }]);
  } catch (err) {
    alert('저장하지 못했습니다.\n' + errorText(err));
    return;
  } finally {
    submit.disabled = false;
  }
  entries.push(entry);

  // 추가한 내역이 속한 달로 이동
  const [y, m] = entry.date.split('-').map(Number);
  current = new Date(y, m - 1, 1);

  form.elements.amount.value = '';
  form.elements.memo.value = '';
  form.elements.amount.focus();
  render();
});

document.getElementById('prevMonth').addEventListener('click', () => {
  current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  render();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  render();
});

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => setChartMode(tab.dataset.mode));
}

document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm('모든 내역을 삭제할까요? 되돌릴 수 없습니다.')) return;
  try {
    await deleteAllEntries();
  } catch (err) {
    alert('삭제하지 못했습니다.\n' + errorText(err));
    return;
  }
  entries = [];
  render();
});

// 버튼을 누른 동안 막아 두고, 끝나면 원래 글자로 되돌린다
async function busy(btn, text, task) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
  try {
    await task();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

document.getElementById('loadSample').addEventListener('click', e => {
  if (!confirm(`예시 데이터 ${SAMPLE_ENTRIES.length.toLocaleString('ko-KR')}건을 넣을까요?`)) return;
  busy(e.currentTarget, '넣는 중…', async () => {
    try {
      entries.push(...await insertEntries(SAMPLE_ENTRIES.map(withoutId)));
    } catch (err) {
      alert('예시 데이터를 넣지 못했습니다.\n' + errorText(err));
    }
    render();
  });
});

// 예전 버전에서 이 브라우저에 저장해 둔 내역과 날씨를 Supabase로 옮긴다
document.getElementById('importLocal').addEventListener('click', e => {
  const local = pendingLocal;
  if (!local || !confirm('이 브라우저에 저장된 내역과 날씨를 지금 계정으로 옮길까요?')) return;
  busy(e.currentTarget, '옮기는 중…', async () => {
    try {
      entries.push(...await insertEntries(local.entries.map(withoutId)));
      const days = Object.entries(local.weather).map(([day, w]) => ({ day, sky: w.sky || '', note: w.note || '' }));
      if (days.length) await saveWeatherDays(days);
      pendingLocal = null;
      localStorage.setItem(IMPORTED_KEY, new Date().toISOString());
      const today = local.weather[todayStr()];
      if (today) {
        weatherDay = { sky: today.sky || '', note: today.note || '' };
        showWeather();
      }
    } catch (err) {
      alert('옮기지 못했습니다.\n' + errorText(err));
    }
    render();
  });
});

// 오늘의 날씨: 날짜별로 { sky, note }를 저장한다
const weatherNote = document.getElementById('weatherNote');
let weatherDay = { sky: '', note: '' };
let weatherButtons = [];
let weatherTimer = null;

async function saveWeather() {
  clearTimeout(weatherTimer);
  weatherTimer = null;
  try {
    if (weatherDay.sky || weatherDay.note) await saveWeatherDays([{ day: todayStr(), ...weatherDay }]);
    else await deleteWeather(todayStr());
  } catch (err) {
    alert('날씨를 저장하지 못했습니다.\n' + errorText(err));
  }
}

function markSky() {
  weatherButtons.forEach((btn, i) => btn.setAttribute('aria-checked', String(WEATHERS[i].value === weatherDay.sky)));
}

function showWeather() {
  markSky();
  weatherNote.value = weatherDay.note;
}

function setupWeather() {
  const today = new Date();
  const weekday = today.toLocaleDateString('ko-KR', { weekday: 'short' });
  document.getElementById('weatherDate').textContent =
    `${today.getMonth() + 1}월 ${today.getDate()}일 (${weekday})`;

  weatherButtons = WEATHERS.map(w => {
    const btn = el('button', '', '');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.append(el('span', 'icon', w.icon), el('span', '', w.label));
    btn.addEventListener('click', () => {
      // 같은 날씨를 다시 누르면 선택을 해제한다
      weatherDay.sky = weatherDay.sky === w.value ? '' : w.value;
      markSky();
      saveWeather();
    });
    return btn;
  });
  document.getElementById('weatherPicks').replaceChildren(...weatherButtons);

  // 글자를 칠 때마다 저장하지 않고, 입력이 멈추면 저장한다
  weatherNote.addEventListener('input', () => {
    weatherDay.note = weatherNote.value.trim();
    clearTimeout(weatherTimer);
    weatherTimer = setTimeout(saveWeather, 600);
  });
}

// 로그인
const AUTH_ERRORS = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요.',
  email_not_confirmed: '메일함에서 인증 링크를 먼저 눌러 주세요.',
  user_already_exists: '이미 가입된 이메일이에요. 로그인해 주세요.',
  weak_password: '비밀번호를 6자 이상으로 더 길게 정해 주세요.',
  over_email_send_rate_limit: '메일을 너무 자주 보냈어요. 잠시 뒤에 다시 해 주세요.',
};

function setAuthStatus(text, isError = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle('error', isError);
}

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const signup = e.submitter?.value === 'signup';
  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  const buttons = authForm.querySelectorAll('button');
  buttons.forEach(b => (b.disabled = true));
  setAuthStatus(signup ? '가입하는 중…' : '로그인하는 중…');
  const { data, error } = signup
    ? await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
    : await db.auth.signInWithPassword({ email, password });
  buttons.forEach(b => (b.disabled = false));
  if (error) return setAuthStatus(AUTH_ERRORS[error.code] || errorText(error), true);
  // 로그인되면 아래 onAuthStateChange에서 화면이 바뀐다
  if (signup && !data.session) setAuthStatus('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인해 주세요.');
});

document.getElementById('signOut').addEventListener('click', async () => {
  // 입력 중이던 날씨 메모는 로그아웃 전에 저장한다
  if (weatherTimer) await saveWeather();
  await db.auth.signOut();
});

async function onSession(session) {
  const id = session?.user.id ?? null;
  if (id === userId) return;
  userId = id;
  document.getElementById('authPanel').hidden = Boolean(id);
  document.getElementById('appBody').hidden = !id;
  document.querySelector('.month-nav').hidden = !id;
  entries = [];
  weatherDay = { sky: '', note: '' };
  if (!id) {
    authForm.reset();
    setAuthStatus('같은 계정으로 로그인하면 어느 기기에서든 같은 가계부를 볼 수 있어요.');
    return;
  }

  document.getElementById('userEmail').textContent = session.user.email;
  loading = true;
  render();
  showWeather();
  try {
    const [list, day] = await Promise.all([fetchEntries(), fetchWeather(todayStr())]);
    if (userId !== id) return; // 불러오는 사이 로그아웃했다면 버린다
    entries = list;
    if (day) weatherDay = day;
    pendingLocal = localData();
  } catch (err) {
    alert('데이터를 불러오지 못했습니다.\n' + errorText(err));
  }
  loading = false;
  render();
  showWeather();
}

// 시스템 다크 모드가 바뀌면 그래프 색도 다시 칠한다
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChart);

form.elements.date.value = todayStr();
fillCategories();
setupWeather();

if (db) {
  // 콜백 안에서 바로 Supabase를 다시 부르면 멈출 수 있어서 다음 차례로 미룬다
  db.auth.onAuthStateChange((_event, session) => setTimeout(() => onSession(session), 0));
} else {
  document.getElementById('authPanel').hidden = false;
  authForm.querySelectorAll('button').forEach(b => (b.disabled = true));
  setAuthStatus('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', true);
}
