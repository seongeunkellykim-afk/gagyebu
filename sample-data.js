// 예시 데이터: 대한민국 1인 가구 평균에 맞춘 2024-01-01 ~ 오늘의 가상 수입·지출과 월별 예산
//
// 기준: 국가데이터처 「2025 통계로 보는 1인 가구」(2024년 기준)
//   - 연 소득 3,423만 원 → 월 약 285만 원
//   - 월평균 소비지출 168만 9천 원
//     주거·수도·광열 18.4%, 음식·숙박 18.2%, 식료품·비주류음료 13.6%, 교통·운송 10.6%
//   - 나머지 비목은 발표 자료에 없어 추정: 보건 약 8%(2023년 월 13만 2천 원), 오락·문화 7.5%,
//     통신 5%, 의류·신발 4.5%, 가정용품 4%, 교육·주류담배·기타 상품서비스 약 10%
//
// 앱 분류로 묶은 월평균 목표 (원)
//   식비 53만(식료품+외식) · 주거 31만 · 교통 17만 · 통신 8만 · 의료 13만 · 문화 9만 · 여행 3~4만
//   쇼핑 14만(의류+가정용품) · 기타 17만 → 합계 약 168만 / 수입 약 285만
//
// 같은 씨앗값으로 만들어서 열 때마다 똑같은 내역이 나온다 (끝 날짜만 오늘로 늘어난다).

const SAMPLE_START = '2024-01-01';

// 명절(설·추석) 당일. 며칠 전에 선물·용돈이 나가고 상여가 들어온다.
const HOLIDAYS = ['2024-02-10', '2024-09-17', '2025-01-29', '2025-10-06', '2026-02-17', '2026-09-25', '2027-02-06'];
const SALARY = { 2024: 2480000, 2025: 2560000, 2026: 2630000, 2027: 2700000 };

function makeSampleEntries() {
  // 씨앗값이 같으면 같은 수열을 내는 작은 난수 발생기 (mulberry32)
  let seed = 20241;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chance = p => rand() < p;
  // 한 달에 평균 n번 일어나는 일을 하루 확률로
  const monthly = n => chance(n / 30.4);
  const pick = list => list[Math.floor(rand() * list.length)];
  // base 근처에서 ±spread 비율만큼 흔들고 100원 단위로 맞춘다
  const around = (base, spread) => Math.max(100, Math.round((base * (1 + (rand() * 2 - 1) * spread)) / 100) * 100);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (str, days) => {
    const d = new Date(`${str}T00:00:00`);
    d.setDate(d.getDate() + days);
    return fmt(d);
  };

  const list = [];
  const add = (type, date, category, amount, memo) => list.push({ type, date, category, amount, memo });
  const out = (date, category, amount, memo) => add('expense', date, category, amount, memo);

  const giftDays = new Set(HOLIDAYS.map(h => shift(h, -3)));
  const bonusDays = new Set(HOLIDAYS.map(h => shift(h, -5)));
  const today = fmt(new Date());

  for (let d = new Date(`${SAMPLE_START}T00:00:00`); fmt(d) <= today; d.setDate(d.getDate() + 1)) {
    const date = fmt(d);
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const dow = d.getDay();
    const workday = dow >= 1 && dow <= 5;
    const weekend = !workday;

    // ── 매달 고정 ──
    if (day === 1) {
      out(date, '주거', 230000, '월세');
      out(date, '문화', 50000, '헬스장');
    }
    if (day === 5) {
      // 겨울 난방, 여름 냉방으로 공과금이 오른다
      const season = [11, 0, 1].includes(m) ? 40000 : [6, 7].includes(m) ? 20000 : 0;
      out(date, '주거', around(70000 + season, 0.1), '관리비·공과금');
    }
    if (day === 15) {
      out(date, '통신', 55000, '휴대폰 요금');
      out(date, '통신', 27500, '인터넷');
    }
    if (day === 17) out(date, '문화', 13500, 'OTT 구독');
    if (day === 20) out(date, '의료', around(35000, 0.15), '영양제');
    if (day === 25) add('income', date, '월급', SALARY[y] || SALARY[2027], '월급');

    // ── 식비: 식료품 약 23만 + 외식 약 30만 ──
    if (dow === 6 && chance(0.95)) out(date, '식비', around(45000, 0.4), '마트 장보기');
    if (monthly(4)) out(date, '식비', around(8000, 0.4), '편의점');
    if (workday && chance(0.7)) out(date, '식비', around(10000, 0.25), pick(['점심', '점심 김밥', '점심 국밥', '구내식당']));
    if (workday && chance(0.5)) out(date, '식비', around(4800, 0.2), '커피');
    if (monthly(6)) out(date, '식비', around(18000, 0.4), pick(['배달 치킨', '저녁 외식', '배달 떡볶이', '친구와 저녁', '혼밥 라멘']));

    // ── 교통 약 17만 ──
    if (workday) out(date, '교통', 3000, '출퇴근 지하철');
    if (weekend && chance(0.55)) out(date, '교통', around(3200, 0.3), '버스·지하철');
    if (monthly(4)) out(date, '교통', around(13000, 0.35), '택시');
    if (monthly(0.6)) out(date, '교통', around(50000, 0.3), pick(['KTX', '고속버스']));

    // ── 의료 약 13만 ──
    if (monthly(1.2)) out(date, '의료', around(15000, 0.4), pick(['내과', '피부과', '이비인후과']));
    if (monthly(1.5)) out(date, '의료', around(9000, 0.4), '약국');
    if (monthly(1)) out(date, '의료', around(20000, 0.3), pick(['한의원', '물리치료']));
    if (monthly(0.12)) out(date, '의료', around(250000, 0.4), pick(['치과 치료', '안과 검진']));
    if (monthly(0.08)) out(date, '의료', around(150000, 0.3), '안경·렌즈');

    // ── 쇼핑 약 14만: 봄·가을에 옷을 더 산다 ──
    if (monthly([2, 9].includes(m) ? 2.6 : 1.3)) out(date, '쇼핑', around(55000, 0.5), pick(['옷', '신발', '온라인 쇼핑']));
    if (monthly(2.2)) out(date, '쇼핑', around(22000, 0.5), pick(['생활용품', '세제·휴지', '다이소']));
    if (monthly(0.1)) out(date, '쇼핑', around(300000, 0.4), pick(['소형 가전', '가구']));

    // ── 문화 약 9만 (헬스장·OTT 포함) ──
    if (monthly(2)) out(date, '문화', around(15000, 0.4), pick(['영화', '책', '전시', '공연']));

    // ── 여행 약 3~4만: 여름휴가 한 번 + 가끔 주말 여행 ──
    if (date.endsWith('-07-27')) out(date, '여행', around(300000, 0.2), '여름휴가 숙소·교통');
    if (weekend && chance(0.012)) out(date, '여행', around(150000, 0.3), '주말 여행');

    // ── 기타 약 17만: 미용·경조사·술·교육·선물 등 ──
    if (chance(1 / 42)) out(date, '기타', around(25000, 0.2), '미용실');
    if (monthly(0.4)) out(date, '기타', pick([50000, 100000]), '경조사비');
    if (monthly(3)) out(date, '기타', around(7000, 0.4), '맥주');
    if (monthly(0.25)) out(date, '기타', around(100000, 0.4), '온라인 강의');
    if (monthly(0.4)) out(date, '기타', around(40000, 0.4), '선물');
    if (monthly(2)) out(date, '기타', around(6000, 0.3), '세탁소');
    if (giftDays.has(date)) {
      out(date, '기타', 100000, '명절 선물');
      out(date, '기타', 200000, '부모님 용돈');
    }

    // ── 월급 외 수입 ──
    if (bonusDays.has(date)) add('income', date, '월급', 300000, '명절 상여');
    if (monthly(0.45)) add('income', date, '부수입', around(300000, 0.4), pick(['중고거래', '프리랜서 작업', '부업']));
    if (date === `${y}-02-28`) add('income', date, '기타', around(350000, 0.3), '연말정산 환급');
    if (date.endsWith('-11-03')) add('income', date, '용돈', 100000, '생일 용돈');
  }
  return list;
}

// 예시 예산: 해마다 1월에 조금씩 올린다. 사이 달은 앱이 이전 달 예산을 이어서 쓴다.
const SAMPLE_BUDGET_PLAN = {
  '2024-01': { 식비: 500000, 교통: 170000, 주거: 320000, 통신: 85000, 쇼핑: 130000, 여행: 40000, 의료: 120000, 문화: 90000, 기타: 160000 },
  '2025-01': { 식비: 520000, 교통: 170000, 주거: 330000, 통신: 85000, 쇼핑: 130000, 여행: 40000, 의료: 120000, 문화: 90000, 기타: 170000 },
  '2026-01': { 식비: 540000, 교통: 180000, 주거: 340000, 통신: 85000, 쇼핑: 140000, 여행: 40000, 의료: 130000, 문화: 90000, 기타: 170000 },
};

const SAMPLE_ENTRIES = makeSampleEntries();
const SAMPLE_BUDGETS = Object.entries(SAMPLE_BUDGET_PLAN).flatMap(([month, items]) =>
  Object.entries(items).map(([category, amount]) => ({ month, category, amount })));
