// Supabase 연결과 데이터 읽기/쓰기
// 로그인 없이 쓰므로 이 공개(publishable) 키만 있으면 누구나 가계부를 읽고 쓸 수 있다
// (코드를 공개 저장소에 올리면 데이터도 공개되는 셈이다)
const SUPABASE_URL = 'https://hgucebmdpmwsftxbvhmp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bUkrsD5IprcH-cblqswRoA_AWVqiFEw';
const ENTRY_COLUMNS = 'id, type, date, category, amount, memo';
// Supabase는 한 번에 최대 1000행까지 돌려줘서 나눠서 읽는다
const PAGE_SIZE = 1000;
const INSERT_BATCH = 500;

const db = window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function fetchEntries() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from('entries')
      .select(ENTRY_COLUMNS)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE_SIZE) return all;
  }
}

// 저장된 행(서버가 매긴 id 포함)을 돌려준다
async function insertEntries(rows) {
  const saved = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { data, error } = await db.from('entries')
      .insert(rows.slice(i, i + INSERT_BATCH))
      .select(ENTRY_COLUMNS);
    if (error) throw error;
    saved.push(...data);
  }
  return saved;
}

async function deleteEntry(id) {
  const { error } = await db.from('entries').delete().eq('id', id);
  if (error) throw error;
}

async function deleteAllEntries() {
  // delete에는 조건이 꼭 있어야 해서 모든 행에 맞는 조건을 준다
  const { error } = await db.from('entries').delete().gt('id', 0);
  if (error) throw error;
}

async function fetchWeather(day) {
  const { data, error } = await db.from('weather').select('sky, note').eq('day', day).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveWeatherDays(days) {
  const { error } = await db.from('weather').upsert(days, { onConflict: 'day' });
  if (error) throw error;
}

async function deleteWeather(day) {
  const { error } = await db.from('weather').delete().eq('day', day);
  if (error) throw error;
}
