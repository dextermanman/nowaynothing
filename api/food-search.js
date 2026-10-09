// api/food-search.js
// 지역 맛집 리스트 — 네이버 지역검색 API를 음식 키워드 여러 개로 동시에 조회해서 합칩니다.
// 네이버 지역검색은 한 번에 최대 5건만 주기 때문에, "수원시 국밥", "수원시 고기 맛집" 처럼
// 키워드를 나눠 부르고 리뷰 많은 순(sort=comment)으로 받아 중복을 제거합니다.
//
// 사용: /api/food-search?area=경기 수원시&kind=all
// kind: all | korean | meat | soup | seafood | noodle | chinese | japanese | western | snack | cafe | bakery | pub
// 필요 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET

const KINDS = {
  all:      ['맛집', '한식 맛집', '고기 맛집', '국밥', '해산물 맛집', '중식 맛집', '일식 맛집', '양식 맛집', '분식 맛집', '노포 맛집'],
  korean:   ['한식 맛집', '한정식', '백반 맛집', '보쌈 족발', '찜 맛집', '비빔밥'],
  meat:     ['고기 맛집', '삼겹살', '갈비 맛집', '소고기 맛집', '곱창 막창', '닭갈비'],
  soup:     ['국밥', '해장국', '설렁탕 곰탕', '감자탕', '칼국수', '순대국'],
  seafood:  ['해산물 맛집', '횟집', '조개구이', '장어 맛집', '아구찜', '대게 맛집'],
  noodle:   ['냉면 맛집', '칼국수', '국수 맛집', '막국수', '라멘', '쌀국수'],
  chinese:  ['중식 맛집', '짜장면 맛집', '짬뽕 맛집', '탕수육', '딤섬', '마라탕'],
  japanese: ['일식 맛집', '초밥 맛집', '오마카세', '돈카츠', '라멘 맛집', '우동'],
  western:  ['양식 맛집', '파스타 맛집', '스테이크', '피자 맛집', '수제버거', '브런치'],
  snack:    ['분식 맛집', '떡볶이 맛집', '김밥 맛집', '만두 맛집', '순대 맛집', '튀김'],
  cafe:     ['카페', '디저트 카페', '뷰 카페', '대형 카페', '애견 카페', '빙수'],
  bakery:   ['빵집', '베이커리 카페', '소금빵', '도넛', '케이크 맛집', '베이글'],
  pub:      ['술집', '이자카야', '포차', '와인바', '막걸리', '호프'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 맛집 순위는 하루 단위로만 갱신해도 충분 — 네이버 API 호출량도 아낍니다.
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({ error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다.' });
  }

  const area = String(req.query.area || '').trim();
  const kind = KINDS[req.query.kind] ? req.query.kind : 'all';
  if (!area) return res.status(400).json({ error: 'area 파라미터가 필요합니다 (예: 경기 수원시).' });

  const clean = (v) => (v || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

  const queryOne = async (keyword) => {
    const url =
      'https://openapi.naver.com/v1/search/local.json?display=5&start=1&sort=comment&query=' +
      encodeURIComponent(`${area} ${keyword}`);
    try {
      const r = await fetch(url, {
        headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
      });
      if (!r.ok) return [];
      const json = await r.json();
      return (json.items || []).map((it) => ({
        name: clean(it.title),
        category: clean(it.category) || null,
        address: it.roadAddress || it.address || null,
        link: it.link || null,
        tel: it.telephone || null,
        keyword,
      }));
    } catch (e) {
      return [];
    }
  };

  const results = await Promise.all(KINDS[kind].map(queryOne));

  // 키워드 여러 개에 동시에 걸린 집일수록 위로 — 그 동네에서 두루 유명하다는 뜻이라서요.
  const byKey = new Map();
  results.forEach((list, qi) => {
    list.forEach((it, rank) => {
      if (!it.name) return;
      const key = it.name.replace(/\s/g, '') + '|' + (it.address || '').split(' ').slice(0, 3).join('');
      const score = (5 - rank) + (KINDS[kind].length - qi) * 0.1;
      const prev = byKey.get(key);
      if (prev) {
        prev.hits += 1;
        prev.score += score + 5;
      } else {
        byKey.set(key, { ...it, hits: 1, score });
      }
    });
  });

  // 지역 이름의 마지막 단어(예: 수원시)가 주소에 없는 결과는 다른 동네 가게라서 뺍니다.
  const areaTail = area.split(/\s+/).pop().replace(/(특별시|광역시|특별자치시|특별자치도|도|전체)$/, '');
  const items = [...byKey.values()]
    .filter((it) => !areaTail || !it.address || it.address.includes(areaTail))
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...rest }) => rest);

  return res.status(200).json({ area, kind, source: '네이버 지역검색 (리뷰 많은 순)', total: items.length, items });
}
