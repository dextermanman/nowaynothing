// api/parking-search.js
// 주차장 조회 — 2단계로 시도합니다.
//   1) 공공데이터 "전국주차장정보표준데이터" (요금·면수까지 상세)
//   2) 실패하거나 결과가 없으면 네이버 지역검색으로 자동 대체 (이름·주소 위주)
//
// 덕분에 공공데이터 활용신청이 아직 승인 전이어도 주차장이 뜹니다.
//
// 사용: /api/parking-search?sido=경기&sigungu=화성시
// 환경변수: DATA_GO_KR_KEY (선택), NAVER_CLIENT_ID / NAVER_CLIENT_SECRET

const ENDPOINT = 'https://api.data.go.kr/openapi/tn_pubr_public_prkplce_info_api';
const ROWS = 1000;
const MAX_PAGES = 3;

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

const strip = (v) => String(v || '').replace(/\s/g, '');
const coreName = (v) =>
  strip(v).replace(/(특별자치도|특별자치시|광역시|특별시|자치도|도|시|군|구)$/g, '');

function matches(item, sidoCore, sggCore) {
  const addr = strip(item.rdnmadr || item.lnmadr);
  const inst = strip(item.institutionNm);
  const okSido = !sidoCore || addr.includes(sidoCore) || inst.includes(sidoCore);
  const okSgg = !sggCore || addr.includes(sggCore) || inst.includes(sggCore);
  return okSido && okSgg;
}

function shapePublic(it) {
  return {
    name: it.prkplceNm,
    type: it.prkplceSe || null,
    kind: it.prkplceType || null,
    address: it.rdnmadr || it.lnmadr || null,
    spaces: it.prkcmprt || null,
    charge: it.parkingchrgeInfo || null,
    basicTime: it.basicTime || null,
    basicCharge: it.basicCharge || null,
    weekdayOpen: it.weekdayOperOpenHhmm || null,
    weekdayClose: it.weekdayOperColseHhmm || null,
    tel: it.phoneNumber || null,
  };
}

async function callPublic(key, extra = {}) {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: String(ROWS),
    type: 'json',
    ...extra,
  });
  const r = await fetch(`${ENDPOINT}?${params.toString()}`);
  const text = await r.text();
  try {
    const json = JSON.parse(text);
    let rows = json?.response?.body?.items || [];
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    return { ok: true, rows };
  } catch {
    return { ok: false, raw: text.slice(0, 200) };
  }
}

// 네이버 지역검색으로 대체 조회
async function callNaver(query) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];

  const url =
    'https://openapi.naver.com/v1/search/local.json?display=5&sort=comment&query=' +
    encodeURIComponent(query);

  try {
    const r = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!r.ok) return [];
    const json = await r.json();
    const clean = (s) => (s || '').replace(/<[^>]+>/g, '');
    return (json.items || []).map((it) => ({
      name: clean(it.title),
      type: null,
      kind: clean(it.category) || null,
      address: it.roadAddress || it.address || null,
      spaces: null,
      charge: null,
      basicTime: null,
      basicCharge: null,
      weekdayOpen: null,
      weekdayClose: null,
      tel: null,
    }));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const { sido, sigungu } = req.query;
  const limit = Number(req.query.limit || 12);
  if (!sido && !sigungu) {
    return res.status(400).json({ error: 'sido 또는 sigungu가 필요합니다.' });
  }

  const sidoCore = coreName(sido);
  const sggCore = coreName(sigungu);
  const key = normalizeKey(process.env.DATA_GO_KR_KEY);

  // ── 1단계: 공공데이터 ──
  if (key) {
    try {
      if (sigungu) {
        const first = await callPublic(key, { institutionNm: sigungu });
        if (first.ok) {
          const hits = first.rows.filter((it) => matches(it, sidoCore, sggCore));
          if (hits.length) {
            return res.status(200).json({
              source: 'public',
              matched: hits.length,
              items: hits.slice(0, limit).map(shapePublic),
            });
          }
        }
      }

      const found = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await callPublic(key, { pageNo: String(page) });
        if (!r.ok || !r.rows.length) break;
        found.push(...r.rows.filter((it) => matches(it, sidoCore, sggCore)));
        if (found.length >= limit) break;
        if (r.rows.length < ROWS) break;
      }
      if (found.length) {
        return res.status(200).json({
          source: 'public',
          matched: found.length,
          items: found.slice(0, limit).map(shapePublic),
        });
      }
    } catch {
      // 공공데이터 실패 시 조용히 네이버로 넘어감
    }
  }

  // ── 2단계: 네이버 지역검색 대체 ──
  // 네이버 지역검색은 한 번에 5건까지만 주므로, 검색어를 나눠 호출한 뒤 합칩니다.
  const region = sigungu || sido;
  const queries = [
    `${region} 공영주차장`,
    `${region} 주차장`,
    `${region} 공공주차장`,
    `${region} 주차타워`,
  ];

  const results = await Promise.all(queries.map((q) => callNaver(q)));

  const seen = new Set();
  const items = [];
  for (const list of results) {
    for (const it of list) {
      const key = (it.name || '') + '|' + (it.address || '');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }

  return res.status(200).json({
    source: 'naver',
    note: '주차장 표준데이터는 오픈API가 아니라 지자체별 파일로 제공돼서, 네이버 지역검색 결과로 대체했어요. (요금·주차면수 정보는 없습니다)',
    matched: items.length,
    items: items.slice(0, limit),
  });
}
