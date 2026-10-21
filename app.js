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

let entries = [];
// { 'YYYY-MM': { 식비: 500000, ... } }
let budgets = {};
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

// 그 달 예산이 없으면 가장 가까운 이전 달 예산을 이어서 쓴다
function budgetFor(key) {
  const month = Object.keys(budgets).filter(m => m <= key).sort().pop();
  return month ? { month, items: budgets[month] } : null;
}

const budgetTotal = b => (b ? Object.values(b.items).reduce((sum, n) => sum + n, 0) : 0);
const percent = (part, whole) => Math.round((part / whole) * 100);

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
  const budget = budgetFor(key);
  const budgetSum = budgetTotal(budget);

  // 배너의 네즈코 말풍선: 예산이 있으면 예산 사용률, 없으면 잔액
  let bubble;
  if (budgetSum && expense > budgetSum) bubble = `음…! 예산을 ${won(expense - budgetSum)} 넘었어요`;
  else if (budgetSum) bubble = `음! 이번 달 예산 ${percent(expense, budgetSum)}% 썼어요`;
  else if (income - expense >= 0) bubble = `음! 이번 달 ${won(income - expense)} 남았어요`;
  else bubble = `음…! 이번 달 ${won(expense - income)} 더 썼어요`;
  document.getElementById('heroBubble').textContent = bubble;

  // 분류별 지출과 예산
  const byCategory = {};
  for (const e of list) {
    if (e.type === 'expense') byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  renderBudgetTotal(expense, budget, key);
  // 지출이 없어도 예산을 정한 분류는 보여준다
  const names = new Set([...Object.keys(byCategory), ...Object.keys(budget?.items || {}).filter(c => budget.items[c] > 0)]);
  const categories = [...names].map(name => [name, byCategory[name] || 0]).sort((a, b) => b[1] - a[1]);
  const max = categories.length ? categories[0][1] : 0;
  const categoryList = document.getElementById('categoryList');
  categoryList.replaceChildren();
  if (!categories.length) {
    categoryList.append(el('li', 'empty', '이번 달 지출이 없습니다.'));
  }
  for (const [name, total] of categories) {
    const limit = budget?.items[name] || 0;
    const li = el('li');
    const bar = el('div', 'bar');
    const fill = el('i');
    if (limit) {
      // 예산이 있으면 예산 대비 사용률, 넘으면 빨갛게
      fill.style.width = `${Math.min(total / limit, 1) * 100}%`;
      if (total > limit) li.className = 'over';
      li.title = `예산의 ${percent(total, limit)}%`;
    } else {
      fill.style.width = `${max ? (total / max) * 100 : 0}%`;
      li.className = 'no-budget';
    }
    bar.append(fill);
    const value = el('span', 'value', won(total));
    if (limit) value.append(el('small', '', ` / ${won(limit)}`));
    li.append(el('span', '', name), bar, value);
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

// 분류별 패널 맨 위의 이번 달 예산 합계
function renderBudgetTotal(expense, budget, key) {
  const box = document.getElementById('budgetTotal');
  const total = budgetTotal(budget);
  if (!total) {
    box.replaceChildren(el('p', 'hint', '아직 예산이 없어요. 「예산 설정」을 눌러 이번 달 예산을 정해 보세요.'));
    return;
  }
  const left = total - expense;
  const head = el('div', 'budget-head');
  head.append(
    el('span', '', `예산 ${won(total)} 중 ${percent(expense, total)}% 사용`),
    el('strong', left < 0 ? 'expense' : 'income', left < 0 ? `${won(-left)} 초과` : `${won(left)} 남음`),
  );
  const bar = el('div', `bar big${left < 0 ? ' over' : ''}`);
  const fill = el('i');
  fill.style.width = `${Math.min(expense / total, 1) * 100}%`;
  bar.append(fill);
  box.replaceChildren(head, bar);
  if (budget.month !== key) {
    const [, m] = budget.month.split('-');
    box.append(el('p', 'hint', `${budget.month.slice(0, 4)}년 ${Number(m)}월 예산을 이어서 쓰고 있어요.`));
  }
}

// 예산 설정 폼: 지출 분류마다 금액 칸을 만들고 지금 적용 중인 예산으로 채운다
const budgetForm = document.getElementById('budgetForm');

function openBudgetForm() {
  const items = budgetFor(monthKey(current))?.items || {};
  document.getElementById('budgetFields').replaceChildren(...CATEGORIES.expense.map(c => {
    const label = el('label', '', c);
    const input = el('input');
    Object.assign(input, { type: 'number', name: c, min: 0, step: 1000, inputMode: 'numeric', placeholder: '0' });
    if (items[c]) input.value = items[c];
    label.append(input);
    return label;
  }));
  document.getElementById('budgetFormTitle').textContent =
    `${current.getFullYear()}년 ${current.getMonth() + 1}월 예산`;
  budgetForm.hidden = false;
  document.getElementById('editBudget').hidden = true;
}

function closeBudgetForm() {
  budgetForm.hidden = true;
  document.getElementById('editBudget').hidden = false;
}

// 데이터 관리: 옮길 게 있을 때만 가져오기 버튼을 보여준다
function renderTools() {
  document.getElementById('loadSample').hidden = loading;
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

  if (chartMode === 'budget') {
    const key = monthKey(current);
    const items = budgetFor(key)?.items || {};
    const spent = CATEGORIES.expense.map(c =>
      entries.reduce((sum, e) => (e.type === 'expense' && e.category === c && e.date.startsWith(key) ? sum + e.amount : sum), 0));
    return {
      title: `${y}년 ${m + 1}월 분류별 예산 대비 지출`,
      labels: CATEGORIES.expense,
      series: [{ type: 'budget', data: CATEGORIES.expense.map(c => items[c] || 0) }, { type: 'expense', data: spent }],
      hint: Object.keys(items).length ? '보라 막대보다 빨간 막대가 높으면 예산을 넘은 분류예요.' : '이 달에 적용할 예산이 없어요. 「예산 설정」에서 정할 수 있어요.',
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
    const budgetLine = Array.from({ length: 12 }, (_, i) => budgetTotal(budgetFor(`${y}-${String(i + 1).padStart(2, '0')}`)));
    const series = [{ type: 'income', data: income }, { type: 'expense', data: expense }];
    if (budgetLine.some(Boolean)) series.push({ type: 'budget', data: budgetLine, line: true });
    return {
      title: `${y}년 월별 수입·지출`,
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      series,
      hint: '점선은 그 달 지출 예산이에요. 막대를 누르면 그 달의 일별 그래프로 이동합니다.',
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

const SERIES = {
  income: { label: '수입', color: '--income' },
  expense: { label: '지출', color: '--expense' },
  budget: { label: '예산', color: '--budget' },
};
const seriesLabel = type => SERIES[type].label;

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
  const bars = series.filter(s => !s.line).length;
  const slotWidth = box.clientWidth / labels.length;
  const categoryPercentage = Math.min(0.8, (bars * 26) / slotWidth);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'bar',
    data: {
      labels,
      // 선(예산)은 막대 위에 그려지도록 order를 낮춘다
      datasets: series.map(s => (s.line ? {
        type: 'line',
        label: seriesLabel(s.type),
        data: s.data,
        borderColor: color(SERIES[s.type].color),
        backgroundColor: color(SERIES[s.type].color),
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 2.5,
        order: 0,
      } : {
        label: seriesLabel(s.type),
        data: s.data,
        backgroundColor: color(SERIES[s.type].color),
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 24,
        barPercentage: 0.92,
        categoryPercentage,
        order: 1,
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
  for (const tab of document.querySelectorAll('#chartTabs button')) {
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
  closeBudgetForm();
  render();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  closeBudgetForm();
  render();
});

document.getElementById('editBudget').addEventListener('click', openBudgetForm);
document.getElementById('cancelBudget').addEventListener('click', closeBudgetForm);

// 보고 있는 달의 예산으로 저장한다 (0원은 그 분류에 예산을 두지 않는다는 뜻)
budgetForm.addEventListener('submit', async e => {
  e.preventDefault();
  const key = monthKey(current);
  const items = {};
  for (const c of CATEGORIES.expense) items[c] = Math.max(0, Math.round(Number(budgetForm.elements[c].value) || 0));
  const submit = budgetForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await saveBudgetRows(CATEGORIES.expense.map(category => ({ month: key, category, amount: items[category] })));
  } catch (err) {
    alert('예산을 저장하지 못했습니다.\n' + errorText(err));
    return;
  } finally {
    submit.disabled = false;
  }
  budgets[key] = items;
  closeBudgetForm();
  render();
});

for (const tab of document.querySelectorAll('#chartTabs button')) {
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
  const count = SAMPLE_ENTRIES.length.toLocaleString('ko-KR');
  const message = entries.length
    ? `지금 내역 ${entries.length.toLocaleString('ko-KR')}건은 그대로 두고, 예시 내역 ${count}건과 예시 예산을 더할까요?\n(이미 넣었다면 내역이 두 번 들어가요)`
    : `예시 내역 ${count}건과 예시 예산을 넣을까요?`;
  if (!confirm(message)) return;
  busy(e.currentTarget, '넣는 중…', async () => {
    try {
      entries.push(...await insertEntries(SAMPLE_ENTRIES));
      await saveBudgetRows(SAMPLE_BUDGETS);
      for (const { month, category, amount } of SAMPLE_BUDGETS) (budgets[month] ||= {})[category] = amount;
    } catch (err) {
      alert('예시 데이터를 넣지 못했습니다.\n' + errorText(err));
    }
    render();
  });
});

// 예전 버전에서 이 브라우저에 저장해 둔 내역과 날씨를 Supabase로 옮긴다
document.getElementById('importLocal').addEventListener('click', e => {
  const local = pendingLocal;
  if (!local || !confirm('이 브라우저에 저장된 내역과 날씨를 Supabase로 옮길까요?')) return;
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

// 처음 열 때 Supabase에서 내역과 오늘의 날씨를 불러온다
async function loadAll() {
  if (!db) {
    alert('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return;
  }
  loading = true;
  render();
  try {
    const [list, day, budgetRows] = await Promise.all([fetchEntries(), fetchWeather(todayStr()), fetchBudgets()]);
    entries = list;
    budgets = {};
    for (const { month, category, amount } of budgetRows) (budgets[month] ||= {})[category] = amount;
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
loadAll();
