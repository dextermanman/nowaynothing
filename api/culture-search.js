// api/culture-search.js
// 공연예술통합전산망(KOPIS) 공연 목록 프록시.
//
// 사용: /api/culture-search?sido=경기도&keyword=뮤지컬
// 필요 환경변수: KOPIS_API_KEY (kopis.or.kr에서 이메일로 발급받는 인증키. data.go.kr의 DATA_GO_KR_KEY와는 별개!)

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

// KOPIS 공연지역(signgucode) 코드 — 시도 단위 앞 2자리 (프론트 SIDO_LIST와 매칭)
const SIDO_SIGNGU = {
  서울특별시: '11',
  부산광역시: '26',
  대구광역시: '27',
  인천광역시: '28',
  광주광역시: '29',
  대전광역시: '30',
  울산광역시: '31',
  세종특별자치시: '36',
  경기도: '41',
  강원특별자치도: '42',
  충청북도: '43',
  충청남도: '44',
  전북특별자치도: '45',
  전라남도: '46',
  경상북도: '47',
  경상남도: '48',
  제주특별자치도: '50',
};

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function parseListXml(xml) {
  const dbs = [...xml.matchAll(/<db>([\s\S]*?)<\/db>/g)].map((m) => m[1]);
  const field = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };
  return dbs.map((block) => ({
    id: field(block, 'mt20id'),
    name: field(block, 'prfnm'),
    start: field(block, 'prfpdfrom'),
    end: field(block, 'prfpdto'),
    venue: field(block, 'fcltynm'),
    poster: field(block, 'poster'),
    genre: field(block, 'genrenm'),
    state: field(block, 'prfstate'),
    area: field(block, 'area'),
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const key = normalizeKey(process.env.KOPIS_API_KEY);
  if (!key) {
    return res.status(500).json({ error: 'KOPIS_API_KEY 환경변수가 없습니다.' });
  }

  const { sido, keyword } = req.query;
  const rows = Number(req.query.rows || 20);
  const signgucode = sido ? SIDO_SIGNGU[sido] : null;
  if (sido && !signgucode) {
    return res.status(400).json({ error: `sido 파라미터가 올바르지 않습니다. 예: /api/culture-search?sido=경기도 (가능한 값: ${Object.keys(SIDO_SIGNGU).join(', ')})` });
  }

  const today = new Date();
  const inThreeMonths = new Date(today.getTime() + 90 * 86400000);

  const params = new URLSearchParams({
    service: key,
    stdate: ymd(today),
    eddate: ymd(inThreeMonths),
    cpage: '1',
    rows: String(rows),
  });
  if (signgucode) params.set('signgucode', signgucode);
  if (keyword && keyword.trim()) params.set('shprfnm', keyword.trim());

  try {
    const r = await fetch(`https://www.kopis.or.kr/openApi/restful/pblprfr?${params.toString()}`);
    const xml = await r.text();

    const errMsg = xml.match(/<errmsg>([\s\S]*?)<\/errmsg>/);
    if (errMsg) {
      return res.status(502).json({
        error: 'KOPIS 응답 오류',
        hint: 'kopis.or.kr에서 발급받은 KOPIS_API_KEY 값이 정확한지 확인해주세요.',
        detail: errMsg[1],
      });
    }

    const items = parseListXml(xml);

    return res.status(200).json({
      sido: sido || null,
      keyword: keyword || null,
      matched: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
