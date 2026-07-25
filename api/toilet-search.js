// api/toilet-search.js
// Supabase에 미리 적재해둔 전국 공중화장실 데이터(scripts/import-toilets.js) 조회.
// 원본 주소 표기가 들쭉날쭉해서(강원도/강원특별자치도, 경북/경상북도, 대전/대전광역시 등)
// 시도별 변형표를 두고 매칭합니다.
//
// 사용: /api/toilet-search?sido=경기도&sigungu=화성
// 필요 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY

const SIDO_VARIANTS = {
  서울특별시: ['서울특별시', '서울'],
  부산광역시: ['부산광역시', '부산'],
  대구광역시: ['대구광역시', '대구'],
  인천광역시: ['인천광역시', '인천'],
  광주광역시: ['광주광역시', '광주'],
  대전광역시: ['대전광역시', '대전'],
  울산광역시: ['울산광역시', '울산'],
  세종특별자치시: ['세종특별자치시', '세종'],
  경기도: ['경기도', '경기'],
  강원특별자치도: ['강원특별자치도', '강원도', '강원'],
  충청북도: ['충청북도', '충북'],
  충청남도: ['충청남도', '충남'],
  전북특별자치도: ['전북특별자치도', '전라북도', '전북'],
  전라남도: ['전라남도', '전남'],
  경상북도: ['경상북도', '경북'],
  경상남도: ['경상남도', '경남'],
  제주특별자치도: ['제주특별자치도', '제주도', '제주'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.' });
  }

  const { sido, sigungu } = req.query;
  const limit = Number(req.query.limit || 30);
  const variants = SIDO_VARIANTS[sido];
  if (!sido || !variants) {
    return res.status(400).json({ error: `sido 파라미터가 올바르지 않습니다. 예: /api/toilet-search?sido=경기도 (가능한 값: ${Object.keys(SIDO_VARIANTS).join(', ')})` });
  }

  const params = new URLSearchParams({
    select: 'name,address,sigungu,phone,open_time,unisex',
    sido: `in.(${variants.join(',')})`,
    limit: String(limit),
  });
  if (sigungu && sigungu.trim()) {
    params.set('sigungu', `ilike.*${sigungu.trim()}*`);
  }

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/toilets?${params.toString()}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: 'Supabase 조회 오류', detail: text.slice(0, 300) });
    }
    const items = await r.json();
    return res.status(200).json({ sido, sigungu: sigungu || null, matched: items.length, items });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
