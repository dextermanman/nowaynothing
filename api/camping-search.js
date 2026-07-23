// api/camping-search.js
// 한국관광공사 "고캠핑" API 프록시 — 전국 야영장·글램핑·카라반·자동차야영장.
//
// 고캠핑 basedList는 지역 필터 파라미터가 없어서, 전체를 받아온 뒤
// 도(doNm)·시군구(sigunguNm)로 걸러냅니다. 대신 캐시를 길게 잡아
// 두 번째 요청부터는 즉시 응답합니다.
//
// 사용 예: /api/camping-search?do=경기&sigungu=가평
// 필요 환경변수: DATA_GO_KR_KEY

const MOBILE_APP = 'SpotRadar';
const BASE = 'https://apis.data.go.kr/B551011/GoCamping';

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

const strip = (v) => String(v || '').replace(/\s/g, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 캠핑장 정보는 자주 안 바뀌므로 하루 캐시
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const doNm = req.query.do || '';
  const sigungu = req.query.sigungu || '';
  const limit = Number(req.query.limit || 12);

  const params = new URLSearchParams({
    serviceKey: key,
    MobileOS: 'ETC',
    MobileApp: MOBILE_APP,
    _type: 'json',
    numOfRows: '3000',
    pageNo: '1',
  });

  try {
    const r = await fetch(`${BASE}/basedList?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const text = await r.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: '고캠핑 API 호출 실패',
        hint: 'data.go.kr에서 "한국관광공사_고캠핑 정보" 활용신청 승인 여부를 확인해주세요.',
        detail: text.slice(0, 300),
      });
    }

    const header = json?.response?.header;
    if (header && header.resultCode && header.resultCode !== '0000') {
      return res.status(502).json({
        error: '고캠핑 API 오류',
        detail: `${header.resultCode} ${header.resultMsg || ''}`,
      });
    }

    let raw = json?.response?.body?.items?.item ?? [];
    if (!Array.isArray(raw)) raw = raw ? [raw] : [];

    const doKey = strip(doNm);
    const sggKey = strip(sigungu);

    const filtered = raw.filter((it) => {
      const d = strip(it.doNm);
      const g = strip(it.sigunguNm);
      const addr = strip(it.addr1);
      const okDo = !doKey || d.includes(doKey) || doKey.includes(d) || addr.includes(doKey);
      const okSgg = !sggKey || g.includes(sggKey) || sggKey.includes(g) || addr.includes(sggKey);
      return okDo && okSgg;
    });

    const items = filtered.slice(0, limit).map((it) => ({
      contentId: it.contentId,
      name: it.facltNm,
      induty: it.induty || null, // 일반야영장 / 자동차야영장 / 글램핑 / 카라반
      intro: it.lineIntro || null,
      address: [it.addr1, it.addr2].filter(Boolean).join(' ').trim() || null,
      tel: it.tel || null,
      image: it.firstImageUrl || null,
      homepage: it.homepage || null,
      lat: it.mapY ? Number(it.mapY) : null,
      lng: it.mapX ? Number(it.mapX) : null,
    }));

    return res.status(200).json({
      source: 'GoCamping',
      do: doNm || null,
      sigungu: sigungu || null,
      matched: filtered.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
