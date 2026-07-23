// api/museum-search.js
// 공공데이터포털 "전국박물관미술관정보표준데이터" 프록시.
//
// 시도/시군구 이름 표기가 데이터마다 조금씩 달라서(경기도/경기, 강원특별자치도/강원 등),
// 전체를 받아온 뒤 느슨하게 이름을 비교해서 걸러냅니다.
//
// 사용: /api/museum-search?sido=경기&sigungu=화성
// 필요 환경변수: DATA_GO_KR_KEY

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

const strip = (v) => String(v || '').replace(/\s/g, '');

// "경기도" ↔ "경기" 처럼 접미사를 떼고 비교하기 위한 정리
function coreName(v) {
  return strip(v)
    .replace(/(특별자치도|특별자치시|광역시|특별시|자치도|도|시)$/g, '')
    .trim();
}

function looseMatch(dataValue, query) {
  if (!query) return true;
  const a = coreName(dataValue);
  const b = coreName(query);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const { sido, sigungu } = req.query;
  const limit = Number(req.query.limit || 20);

  if (!sido) {
    return res.status(400).json({ error: 'sido 파라미터가 필요합니다. 예: /api/museum-search?sido=경기' });
  }

  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '2000',
    type: 'json',
  });

  try {
    const r = await fetch('https://api.data.go.kr/openapi/tn_pubr_public_museum_artgr_info_api?' + params.toString());
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const m = text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/);
      return res.status(502).json({
        error: '공공데이터포털 응답 오류',
        hint: '"전국박물관미술관정보표준데이터" 활용신청 승인 여부를 확인해주세요.',
        detail: m ? m[1] : text.slice(0, 200),
      });
    }

    let rows = data?.response?.body?.items || [];
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];

    const filtered = rows.filter((it) => {
      const addr = strip(it.rdnmadr || it.lnmadr);
      const okSido = looseMatch(it.ctprvnNm, sido) || addr.includes(coreName(sido));
      const okSgg = !sigungu || looseMatch(it.signguNm, sigungu) || addr.includes(coreName(sigungu));
      return okSido && okSgg;
    });

    const items = filtered.slice(0, limit).map((it) => ({
      name: it.fcltyNm,
      kind: it.fcltyType || it.museumType || null,
      address: it.rdnmadr || it.lnmadr || null,
      tel: it.phoneNumber || null,
      open: it.operOpenHhmm && it.operColseHhmm ? `${it.operOpenHhmm}~${it.operColseHhmm}` : null,
      closed: it.rstdeGuidCn || null,
      fee: it.admfeeInfo || null,
      lat: it.latitude ? Number(it.latitude) : null,
      lng: it.longitude ? Number(it.longitude) : null,
    }));

    return res.status(200).json({
      sido,
      sigungu: sigungu || null,
      matched: filtered.length,
      notice: '운영시간·휴관일은 지자체 등록 기준이라 최신과 다를 수 있어요. 방문 전 확인 추천!',
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
