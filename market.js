// 세계 증시·환율 시세
// TradingView 공개 시세 API는 키 없이 브라우저에서 바로 부를 수 있어서 이걸 쓴다 (비공식이라 바뀔 수 있음)
const QUOTE_URL = 'https://scanner.tradingview.com/global/scan';
const REFRESH_MS = 30000;

const MARKET_GROUPS = [
  { name: '한국', items: [
    { s: 'KRX:KOSPI', name: '코스피' },
    { s: 'KRX:KOSDAQ', name: '코스닥' },
  ] },
  { name: '미국', items: [
    { s: 'NASDAQ:IXIC', name: '나스닥' },
    { s: 'SP:SPX', name: 'S&P 500' },
    { s: 'DJ:DJI', name: '다우존스' },
  ] },
  { name: '일본', items: [
    { s: 'TVC:NI225', name: '닛케이 225' },
    { s: 'TSE:TOPIX', name: '토픽스' },
  ] },
  { name: '유럽', items: [
    { s: 'XETR:DAX', name: '독일 DAX' },
    { s: 'TVC:UKX', name: '영국 FTSE 100' },
    { s: 'EURONEXT:PX1', name: '프랑스 CAC 40' },
    { s: 'TVC:SX5E', name: '유로스톡스 50' },
  ] },
  { name: '중화권·아시아', items: [
    { s: 'SSE:000001', name: '상해종합' },
    { s: 'TVC:HSI', name: '홍콩 항셍' },
    { s: 'TWSE:IX0001', name: '대만 가권' },
    { s: 'NSE:NIFTY', name: '인도 니프티 50' },
  ] },
  { name: '기타', items: [
    { s: 'TSX:TSX', name: '캐나다 TSX' },
    { s: 'BMFBOVESPA:IBOV', name: '브라질 보베스파' },
  ] },
];

// 원화 기준 환율. 엔화는 보통 100엔 단위로 본다.
const FX_ITEMS = [
  { s: 'FX_IDC:USDKRW', name: '미국 달러', unit: 'USD' },
  { s: 'FX_IDC:EURKRW', name: '유로', unit: 'EUR' },
  { s: 'FX_IDC:JPYKRW', name: '일본 엔', unit: '100 JPY', scale: 100 },
  { s: 'FX_IDC:CNYKRW', name: '중국 위안', unit: 'CNY' },
  { s: 'FX_IDC:GBPKRW', name: '영국 파운드', unit: 'GBP' },
  { s: 'FX_IDC:HKDKRW', name: '홍콩 달러', unit: 'HKD' },
  { s: 'FX_IDC:AUDKRW', name: '호주 달러', unit: 'AUD' },
  { s: 'FX_IDC:CADKRW', name: '캐나다 달러', unit: 'CAD' },
  { s: 'FX_IDC:CHFKRW', name: '스위스 프랑', unit: 'CHF' },
  { s: 'FX_IDC:SGDKRW', name: '싱가포르 달러', unit: 'SGD' },
];

const CROSS_ITEMS = [
  { s: 'FX:EURUSD', name: '유로/달러' },
  { s: 'FX:USDJPY', name: '달러/엔' },
  { s: 'TVC:DXY', name: '달러 인덱스' },
];

const ALL_QUOTES = [...MARKET_GROUPS.flatMap(g => g.items), ...FX_ITEMS, ...CROSS_ITEMS];
const tiles = new Map();
let quoteTimer = null;

// 한 줄: 이름(지연 여부) | 가격 | 등락률. 등락 폭은 마우스를 올리면 보인다.
function quoteTile(q) {
  const li = el('li', 'quote');
  const name = el('span', 'q-name', q.unit ? `${q.name} ${q.unit}` : q.name);
  const mode = el('small', 'q-mode');
  name.append(mode);
  const price = el('strong', 'q-price', '—');
  const change = el('span', 'q-change', '');
  li.append(name, price, change);
  tiles.set(q.s, { q, li, price, change, mode });
  return li;
}

function setupMarkets() {
  const groups = document.getElementById('marketGroups');
  groups.replaceChildren(...MARKET_GROUPS.map(g => {
    const box = el('div', 'q-group');
    const list = el('ul', 'quotes');
    list.append(...g.items.map(quoteTile));
    box.append(el('h3', '', g.name), list);
    return box;
  }));
  document.getElementById('fxList').replaceChildren(...FX_ITEMS.map(quoteTile));
  document.getElementById('crossList').replaceChildren(...CROSS_ITEMS.map(quoteTile));

  const tabs = document.querySelectorAll('#marketTabs button');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
      document.getElementById('stocksView').hidden = tab.dataset.view !== 'stocks';
      document.getElementById('fxView').hidden = tab.dataset.view !== 'fx';
    });
  }

  document.getElementById('quoteRefresh').addEventListener('click', refreshQuotes);
  // 탭을 안 보고 있을 땐 쉬고, 다시 보면 바로 갱신한다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshQuotes();
  });
  refreshQuotes();
}

// 'delayed_streaming_900' 같은 값을 '15분 지연'으로
function modeLabel(mode) {
  if (mode === 'streaming') return '실시간';
  const delayed = /^delayed_streaming_(\d+)$/.exec(mode || '');
  if (delayed) return `${Math.round(delayed[1] / 60)}분 지연`;
  return mode === 'endofday' ? '종가' : '';
}

// 유로/달러처럼 값이 작은 건 소수 넷째 자리까지
const decimals = n => (Math.abs(n) >= 10 ? 2 : 4);
const fmt = (n, digits) => n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function setQuoteStatus(text, isError) {
  for (const node of document.querySelectorAll('.quote-status')) {
    node.textContent = text;
    node.classList.toggle('error', Boolean(isError));
  }
}

async function refreshQuotes() {
  clearTimeout(quoteTimer);
  try {
    // Content-Type을 따로 붙이지 않아야 사전 요청(preflight) 없이 바로 보낼 수 있다
    const res = await fetch(QUOTE_URL, {
      method: 'POST',
      body: JSON.stringify({
        symbols: { tickers: ALL_QUOTES.map(q => q.s) },
        columns: ['close', 'change', 'change_abs', 'update_mode'],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data = [] } = await res.json();
    for (const { s, d: [close, pct, abs, mode] } of data) {
      const tile = tiles.get(s);
      if (!tile || close == null) continue;
      const scale = tile.q.scale || 1;
      const digits = decimals(close * scale);
      tile.price.textContent = fmt(close * scale, digits);
      const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
      const arrow = { up: '▲', down: '▼', flat: '–' }[dir];
      tile.change.textContent = `${arrow} ${fmt(Math.abs(pct), 2)}%`;
      tile.change.className = `q-change ${dir}`;
      tile.li.title = `전일 대비 ${arrow} ${fmt(Math.abs(abs * scale), digits)}`;
      tile.mode.textContent = modeLabel(mode);
    }
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setQuoteStatus(`${time} 업데이트 · 30초마다 자동 갱신`);
  } catch {
    // 이전 값은 그대로 두고 다음 차례에 다시 시도한다
    setQuoteStatus('시세를 불러오지 못했어요. 30초 뒤 다시 시도해요.', true);
  }
  quoteTimer = setTimeout(() => {
    if (!document.hidden) refreshQuotes();
  }, REFRESH_MS);
}

setupMarkets();
