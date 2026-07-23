// api/tour-search.js
// 한국관광공사 TourAPI(국문 관광정보 서비스) 프록시.
// 전국 26만 건의 관광지·문화시설·축제·레포츠·숙박·쇼핑·음식점을 시도별로 조회합니다.
// 사진(firstimage)까지 같이 와서 카드에 썸네일을 넣을 수 있어요.
//
// 사용 예:
//   /api/tour-search?areaCode=31&contentTypeId=12          (경기도 관광지)
//   /api/tour-search?areaCode=31&contentTypeId=39&keyword=칼국수 (경기도 음식점 중 칼국수)
//
// 필요 환경변수: DATA_GO_KR_KEY (병원/박물관 API와 동일한 키 하나로 사용)

const MOBILE_APP = 'SpotRadar';

// TourAPI가 KorService2(신규) / KorService1(구버전) 두 갈래라, 순서대로 시도합니다.
const BASES = [
  { base: 'https://apis.data.go.kr/B551011/KorService2', suffix: '2' },
  { base: 'http://apis.data.go.kr/B551011/KorService1', suffix: '1' },
];

async function callTour(pathName, params, suffix) {
  const url = `${pathName}?${params.toString()}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, raw: text };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const { areaCode, contentTypeId, keyword, page } = req.query;
  if (!areaCode && !keyword) {
    return res.status(400).json({ error: 'areaCode 또는 keyword 중 하나는 필요합니다.' });
  }

  let lastRaw = null;

  for (const { base, suffix } of BASES) {
    const isKeywordSearch = !!(keyword && keyword.trim());
    const op = isKeywordSearch ? `searchKeyword${suffix}` : `areaBasedList${suffix}`;

    const params = new URLSearchParams({
      serviceKey: key,
      MobileOS: 'ETC',
      MobileApp: MOBILE_APP,
      _type: 'json',
      numOfRows: '20',
      pageNo: page || '1',
      arrange: 'O', // 대표이미지가 있는 항목 우선(제목순)
    });
    if (areaCode) params.set('areaCode', areaCode);
    if (contentTypeId) params.set('contentTypeId', contentTypeId);
    if (isKeywordSearch) params.set('keyword', keyword.trim());

    try {
      const result = await callTour(`${base}/${op}`, params, suffix);

      if (!result.ok) {
        lastRaw = result.raw;
        continue; // XML 에러면 다음 버전으로 재시도
      }

      const body = result.data?.response?.body;
      const header = result.data?.response?.header;

      // 인증키 미승인/오류 등
      if (header && header.resultCode && header.resultCode !== '0000') {
        lastRaw = `${header.resultCode} ${header.resultMsg || ''}`;
        continue;
      }

      let raw = body?.items?.item ?? [];
      if (!Array.isArray(raw)) raw = raw ? [raw] : [];

      const items = raw.map((it) => ({
        contentId: it.contentid,
        contentTypeId: it.contenttypeid,
        name: it.title,
        address: [it.addr1, it.addr2].filter(Boolean).join(' ').trim() || null,
        tel: it.tel || null,
        image: it.firstimage || it.firstimage2 || null,
        lat: it.mapy ? Number(it.mapy) : null,
        lng: it.mapx ? Number(it.mapx) : null,
      }));

      return res.status(200).json({
        source: `TourAPI(${suffix === '2' ? 'KorService2' : 'KorService1'})`,
        total: body?.totalCount ?? items.length,
        page: Number(page || 1),
        items,
      });
    } catch (err) {
      lastRaw = String(err);
    }
  }

  return res.status(502).json({
    error: 'TourAPI 호출에 실패했습니다. 공공데이터포털에서 "한국관광공사_국문 관광정보 서비스_GW" 활용신청이 승인됐는지 확인해주세요.',
    detail: typeof lastRaw === 'string' ? lastRaw.slice(0, 300) : null,
  });
}
