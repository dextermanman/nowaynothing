// api/place-search.js
// 네이버 지역검색 API로 업체 정보를 조회해서, 그 업체가 등록해둔 실제 웹사이트/예약 링크가
// 있으면 그대로 돌려줍니다 (없으면 null). 캐치테이블·네이버예약 등은 업체마다 쓰는 플랫폼이
// 달라서 통일된 예약 API가 없기 때문에, 업체 정보에 등록된 링크를 최대한 활용합니다.
//
// 사용: /api/place-search?query=금돼지식당 서울
// 필요 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({ error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다.' });
  }

  const { query } = req.query;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });
  }

  const url =
    'https://openapi.naver.com/v1/search/local.json?display=5&start=1&sort=random&query=' +
    encodeURIComponent(query.trim());

  try {
    const r = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(502).json({ error: '네이버 API 오류', status: r.status, detail: text.slice(0, 300) });
    }
    const json = JSON.parse(text);
    const clean = (v) => (v || '').replace(/<[^>]+>/g, '');
    const items = (json.items || []).map((it) => ({
      name: clean(it.title),
      category: clean(it.category) || null,
      address: it.roadAddress || it.address || null,
      link: it.link || null,
      telephone: it.telephone || null,
      mapx: it.mapx || null,
      mapy: it.mapy || null,
    }));
    return res.status(200).json({ query, total: json.total ?? null, items });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류', detail: String(e) });
  }
}
