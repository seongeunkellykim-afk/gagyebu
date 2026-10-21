const STORAGE_KEY = 'gagyebu.entries';
const SAMPLE_KEY = 'gagyebu.sampleVersion';
const WEATHER_KEY = 'gagyebu.weather';
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

let entries = load();
let current = thisMonth();
let chartMode = 'day';
let chart = null;

// 브라우저 localStorage에 저장/불러오기
// 예시 데이터는 id가 1부터 매겨져 있고, 직접 추가한 내역은 id가 Date.now() 값이라 구분된다
function isSample(e) {
  return e.id < 1e12;
}

function load() {
  let saved = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) saved = JSON.parse(raw);
    // 이 버전의 예시 데이터를 이미 넣었다면 저장된 그대로 쓴다
    if (localStorage.getItem(SAMPLE_KEY) === String(SAMPLE_VERSION)) return saved;
  } catch {
    // 저장소를 쓸 수 없는 환경에서도 예시 데이터는 보여준다
    return SAMPLE_ENTRIES.slice();
  }
  // 직접 추가한 내역은 남기고, 예전 예시 데이터는 새 예시 데이터로 바꾼다
  const merged = [...SAMPLE_ENTRIES, ...saved.filter(e => !isSample(e))];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    localStorage.setItem(SAMPLE_KEY, String(SAMPLE_VERSION));
  } catch {}
  return merged;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    alert('브라우저 저장소에 저장하지 못했습니다.');
  }
}

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

  renderChart();
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

function removeEntry(id) {
  if (!confirm('이 내역을 삭제할까요?')) return;
  entries = entries.filter(e => e.id !== id);
  save();
  render();
}

form.addEventListener('change', e => {
  if (e.target.name === 'type') fillCategories();
});

form.addEventListener('submit', e => {
  e.preventDefault();
  const amount = Math.round(Number(form.elements.amount.value));
  if (!amount || amount <= 0) return;

  const entry = {
    // 같은 밀리초에 추가돼도 겹치지 않도록 기존 id보다 크게
    id: entries.reduce((max, x) => Math.max(max, x.id + 1), Date.now()),
    type: form.elements.type.value,
    date: form.elements.date.value,
    category: categorySelect.value,
    amount,
    memo: form.elements.memo.value.trim(),
  };
  entries.push(entry);
  save();

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

document.getElementById('clearAll').addEventListener('click', () => {
  if (!confirm('모든 내역을 삭제할까요? 되돌릴 수 없습니다.')) return;
  entries = [];
  save();
  render();
});

// 오늘의 날씨: 날짜별로 { sky, note }를 저장한다
function loadWeather() {
  try {
    return JSON.parse(localStorage.getItem(WEATHER_KEY)) || {};
  } catch {
    return {};
  }
}

function saveWeather(day) {
  const all = loadWeather();
  if (day.sky || day.note) all[todayStr()] = day;
  else delete all[todayStr()];
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify(all));
  } catch {
    alert('브라우저 저장소에 저장하지 못했습니다.');
  }
}

function setupWeather() {
  const today = new Date();
  const weekday = today.toLocaleDateString('ko-KR', { weekday: 'short' });
  document.getElementById('weatherDate').textContent =
    `${today.getMonth() + 1}월 ${today.getDate()}일 (${weekday})`;

  const day = loadWeather()[todayStr()] || { sky: '', note: '' };
  const picks = document.getElementById('weatherPicks');
  const note = document.getElementById('weatherNote');
  note.value = day.note || '';

  const buttons = WEATHERS.map(w => {
    const btn = el('button', '', '');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.append(el('span', 'icon', w.icon), el('span', '', w.label));
    btn.addEventListener('click', () => {
      // 같은 날씨를 다시 누르면 선택을 해제한다
      day.sky = day.sky === w.value ? '' : w.value;
      saveWeather(day);
      update();
    });
    return btn;
  });
  picks.replaceChildren(...buttons);

  function update() {
    buttons.forEach((btn, i) => btn.setAttribute('aria-checked', String(WEATHERS[i].value === day.sky)));
  }

  note.addEventListener('input', () => {
    day.note = note.value.trim();
    saveWeather(day);
  });

  update();
}

// 시스템 다크 모드가 바뀌면 그래프 색도 다시 칠한다
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChart);

form.elements.date.value = todayStr();
fillCategories();
setupWeather();
render();
