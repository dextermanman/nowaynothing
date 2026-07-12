// api/naver-search.js
// 브라우저가 이 주소(/api/naver-search?query=...)로 요청하면,
// 여기서 대신 네이버 지역검색 API를 호출해서 결과만 돌려줍니다.
// 네이버 Client ID/Secret은 절대 브라우저 코드에 넣지 않고,
// Vercel 프로젝트의 "환경변수"로만 저장합니다 (아래 README 참고).

export default async function handler(req, res) {
  // 다른 도메인에서 이 API를 함부로 가져다 쓰지 못하게 최소한의 보호
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { query } = req.query;
  if (!query || query.trim().length === 0) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다. 예: /api/naver-search?query=동탄 맛집' });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables에서 등록해주세요.'
    });
  }

  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=10&sort=comment`;
    const naverRes = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!naverRes.ok) {
      const errText = await naverRes.text();
      return res.status(naverRes.status).json({ error: '네이버 API 오류', detail: errText });
    }

    const data = await naverRes.json();

    // 네이버가 <b> 태그로 강조 표시를 넣어주는데, 프론트에서 쓰기 편하게 제거
    const clean = (str) => (str || '').replace(/<[^>]+>/g, '');

    const items = (data.items || []).map((item) => ({
      name: clean(item.title),
      category: item.category,
      address: item.roadAddress || item.address,
      description: clean(item.description),
      link: item.link,
    }));

    return res.status(200).json({ query, items });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
