// scripts/import-toilets.js
// 행정안전부 전국공중화장실표준데이터(tn_pubr_public_toilet_api)를 통째로 받아서
// Supabase toilets 테이블에 적재합니다. 페이지당 응답이 느려서(수십 초) 시간이 꽤 걸립니다.
//
// 실행 전 준비:
//   - supabase-schema.sql의 toilets 테이블 + toilets_insert_temp 정책이 이미 적용되어 있어야 함
//   - 환경변수 DATA_GO_KR_KEY, SUPABASE_URL, SUPABASE_ANON_KEY 필요
//
// 실행: DATA_GO_KR_KEY=... SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/import-toilets.js

const API_URL = 'https://api.data.go.kr/openapi/tn_pubr_public_toilet_api';
const PAGE_SIZE = 1000;

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

function parseSidoSigungu(addr) {
  const tokens = String(addr || '').trim().split(/\s+/);
  return { sido: tokens[0] || null, sigungu: tokens[1] || null };
}

async function fetchPage(key, pageNo) {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    type: 'json',
  });
  const r = await fetch(`${API_URL}?${params.toString()}`);
  const text = await r.text();
  return JSON.parse(text);
}

async function insertBatch(supabaseUrl, anonKey, rows) {
  const r = await fetch(`${supabaseUrl}/rest/v1/toilets`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Supabase insert 실패 (${r.status}): ${text.slice(0, 300)}`);
  }
}

async function main() {
  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!key || !supabaseUrl || !anonKey) {
    console.error('DATA_GO_KR_KEY, SUPABASE_URL, SUPABASE_ANON_KEY 환경변수가 모두 필요합니다.');
    process.exit(1);
  }

  const first = await fetchPage(key, 1);
  if (first?.response?.header?.resultCode !== '00') {
    console.error('API 오류:', JSON.stringify(first?.response?.header));
    process.exit(1);
  }
  const totalCount = first.response.body.totalCount;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  console.log(`총 ${totalCount}건, ${totalPages}페이지 예정`);

  let inserted = 0;

  const processPage = async (pageData) => {
    let items = pageData?.response?.body?.items || [];
    if (!Array.isArray(items)) items = items ? [items] : [];

    const rows = items.map((it) => {
      const { sido, sigungu } = parseSidoSigungu(it.rdnmadr || it.lnmadr);
      return {
        name: it.toiletNm || null,
        address: it.rdnmadr || it.lnmadr || null,
        sido,
        sigungu,
        lat: it.latitude ? Number(it.latitude) : null,
        lng: it.longitude ? Number(it.longitude) : null,
        phone: it.phoneNumber || null,
        open_time: it.openTime || null,
        unisex: it.unisexToiletYn === 'Y' ? true : it.unisexToiletYn === 'N' ? false : null,
        install_year: it.installationYear || null,
      };
    });

    for (let i = 0; i < rows.length; i += 500) {
      await insertBatch(supabaseUrl, anonKey, rows.slice(i, i + 500));
    }
    inserted += rows.length;
  };

  await processPage(first);
  console.log(`페이지 1/${totalPages} 완료 (누적 ${inserted}건)`);

  for (let p = 2; p <= totalPages; p++) {
    const data = await fetchPage(key, p);
    if (data?.response?.header?.resultCode !== '00') {
      console.error(`페이지 ${p} 오류:`, JSON.stringify(data?.response?.header), '- 건너뛰고 계속 진행');
      continue;
    }
    await processPage(data);
    console.log(`페이지 ${p}/${totalPages} 완료 (누적 ${inserted}건)`);
  }

  console.log(`임포트 완료: 총 ${inserted}건 적재`);
}

main().catch((err) => {
  console.error('임포트 실패:', err);
  process.exit(1);
});
