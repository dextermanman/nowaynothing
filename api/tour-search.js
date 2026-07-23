// api/tour-search.js
// 한국관광공사 TourAPI(국문 관광정보 서비스) 프록시.
// 시도코드 + 시군구명만 주면 알아서 시군구코드를 찾아서 조회합니다.
//
// 사용 예:
//   /api/tour-search?areaCode=31&sigunguName=화성시
//   /api/tour-search?areaCode=31&contentTypeId=39&keyword=칼국수
//
// 필요 환경변수: DATA_GO_KR_KEY

const MOBILE_APP = 'SpotRadar';

const BASES = [
  { base: 'https://apis.data.go.kr/B551011/KorService2', suffix: '2' },
  { base: 'http://apis.data.go.kr/B551011/KorService1', suffix: '1' },
];

// data.go.kr은 Encoding키/Decoding키 두 종류를 줍니다.
// Encoding키(%2B 같은 문자 포함)를 그대로 쓰면 이중 인코딩돼 인증 실패하므로 먼저 디코드.
function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

function baseParams(key, extra = {}) {
  return new URLSearchParams({
    serviceKey: key,
    MobileOS: 'ETC',
    MobileApp: MOBILE_APP,
    _type: 'json',
    ...extra,
  });
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, raw: text };
  }
}

function listItems(json) {
  let raw = json?.response?.body?.items?.item ?? [];
  if (!Array.isArray(raw)) raw = raw ? [raw] : [];
  return raw;
}

// 시군구명(예: "화성시") → 시군구코드 찾기
async function resolveSigunguCode(base, suffix, key, areaCode, sigunguName) {
  const params = baseParams(key, { numOfRows: '100', pageNo: '1', areaCode });
  const res = await getJson(`${base}/areaCode${suffix}?${params.toString()}`);
  if (!res.ok) return null;

  const items = listItems(res.data);
  const target = String(sigunguName).replace(/\s/g, '');

  const hit =
    items.find((i) => i.name && i.name.replace(/\s/g, '') === target) ||
    items.find((i) => i.name && target.startsWith(i.name.replace(/\s/g, ''))) ||
    items.find((i) => i.name && i.name.replace(/\s/g, '').startsWith(target));

  return hit ? String(hit.code) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 관광 데이터는 자주 안 바뀌므로 캐시해서 응답 속도를 높입니다.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const { areaCode, sigunguName, contentTypeId, keyword, page, rows } = req.query;
  if (!areaCode && !keyword) {
    return res.status(400).json({ error: 'areaCode 또는 keyword 중 하나는 필요합니다.' });
  }

  let lastRaw = null;

  for (const { base, suffix } of BASES) {
    try {
      const isKeywordSearch = !!(keyword && keyword.trim());
      const op = isKeywordSearch ? `searchKeyword${suffix}` : `areaBasedList${suffix}`;

      const params = baseParams(key, {
        numOfRows: rows || '18',
        pageNo: page || '1',
        arrange: 'O',
      });
      if (areaCode) params.set('areaCode', areaCode);
      if (contentTypeId) params.set('contentTypeId', contentTypeId);
      if (isKeywordSearch) params.set('keyword', keyword.trim());

      // 시군구명이 있으면 코드로 변환해서 그 지역만 조회
      let resolvedSigungu = null;
      if (areaCode && sigunguName) {
        resolvedSigungu = await resolveSigunguCode(base, suffix, key, areaCode, sigunguName);
        if (resolvedSigungu) params.set('sigunguCode', resolvedSigungu);
      }

      const result = await getJson(`${base}/${op}?${params.toString()}`);
      if (!result.ok) {
        lastRaw = result.raw;
        continue;
      }

      const header = result.data?.response?.header;
      if (header && header.resultCode && header.resultCode !== '0000') {
        lastRaw = `${header.resultCode} ${header.resultMsg || ''}`;
        continue;
      }

      const items = listItems(result.data).map((it) => ({
        contentId: it.contentid,
        contentTypeId: String(it.contenttypeid || ''),
        name: it.title,
        address: [it.addr1, it.addr2].filter(Boolean).join(' ').trim() || null,
        tel: it.tel || null,
        image: it.firstimage || it.firstimage2 || null,
        lat: it.mapy ? Number(it.mapy) : null,
        lng: it.mapx ? Number(it.mapx) : null,
      }));

      return res.status(200).json({
        source: `TourAPI(KorService${suffix})`,
        areaCode: areaCode || null,
        sigunguName: sigunguName || null,
        sigunguCode: resolvedSigungu,
        total: result.data?.response?.body?.totalCount ?? items.length,
        items,
      });
    } catch (err) {
      lastRaw = String(err);
    }
  }

  return res.status(502).json({
    error: 'TourAPI 호출 실패',
    hint: 'data.go.kr에서 "한국관광공사_국문 관광정보 서비스_GW" 활용신청 승인 여부와, Vercel의 DATA_GO_KR_KEY가 Decoding키인지 확인해주세요.',
    detail: typeof lastRaw === 'string' ? lastRaw.slice(0, 400) : null,
  });
}
