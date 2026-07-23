// api/tour-flags.js
// 관광공사 "반려동물 동반여행 정보"와 "무장애 여행 정보"에서
// 해당되는 장소들의 contentId 목록을 받아옵니다.
//
// 이 목록을 갖고 있으면, 기존 관광지 카드에 🐶 / ♿ 배지를 붙일 수 있어요.
// (별도 테마를 만드는 대신 기존 카드에 표시하는 방식)
//
// 사용: /api/tour-flags
// 필요 환경변수: DATA_GO_KR_KEY

const MOBILE_APP = 'SpotRadar';

const BASES = [
  { base: 'https://apis.data.go.kr/B551011/KorService2', suffix: '2' },
  { base: 'http://apis.data.go.kr/B551011/KorService1', suffix: '1' },
];

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

async function fetchIds(base, suffix, key, op) {
  const params = new URLSearchParams({
    serviceKey: key,
    MobileOS: 'ETC',
    MobileApp: MOBILE_APP,
    _type: 'json',
    numOfRows: '3000',
    pageNo: '1',
  });

  try {
    const r = await fetch(`${base}/${op}${suffix}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const text = await r.text();
    const json = JSON.parse(text);

    let raw = json?.response?.body?.items?.item ?? [];
    if (!Array.isArray(raw)) raw = raw ? [raw] : [];

    return raw.map((it) => String(it.contentid || it.contentId || '')).filter(Boolean);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 잘 안 바뀌는 정보라 하루 캐시
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  for (const { base, suffix } of BASES) {
    const [pet, barrierFree] = await Promise.all([
      fetchIds(base, suffix, key, 'detailPetTour'),
      fetchIds(base, suffix, key, 'detailWithTour'),
    ]);

    if (pet.length || barrierFree.length) {
      return res.status(200).json({
        source: `KorService${suffix}`,
        pet,
        barrierFree,
      });
    }
  }

  // 실패해도 화면이 깨지지 않도록 빈 배열로 응답
  return res.status(200).json({ pet: [], barrierFree: [], note: '정보를 불러오지 못했습니다.' });
}
