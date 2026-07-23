// api/parking-search.js
// 공공데이터포털 "전국주차장정보표준데이터" 프록시.
//
// 전국 주차장이 3만 건이 넘어서 전체를 받아오면 너무 느립니다.
// 그래서 (1) 관리기관명으로 먼저 걸러보고, (2) 안 되면 주소 기준으로
// 제한된 페이지만 훑는 방식으로 처리하고, 결과는 하루 캐시합니다.
//
// 사용: /api/parking-search?sido=경기&sigungu=화성
// 필요 환경변수: DATA_GO_KR_KEY

const ENDPOINT = 'https://api.data.go.kr/openapi/tn_pubr_public_prkplce_info_api';
const MAX_PAGES = 6;      // 훑어볼 최대 페이지 수
const ROWS = 1000;        // 페이지당 건수

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

const strip = (v) => String(v || '').replace(/\s/g, '');

function coreName(v) {
  return strip(v).replace(/(특별자치도|특별자치시|광역시|특별시|자치도|도|시|군|구)$/g, '');
}

async function callApi(key, extra = {}) {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: String(ROWS),
    type: 'json',
    ...extra,
  });

  const r = await fetch(`${ENDPOINT}?${params.toString()}`);
  const text = await r.text();

  try {
    const json = JSON.parse(text);
    let rows = json?.response?.body?.items || [];
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    return { ok: true, rows, total: json?.response?.body?.totalCount || 0 };
  } catch {
    const m = text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/);
    return { ok: false, raw: m ? m[1] : text.slice(0, 200) };
  }
}

function matches(item, sidoCore, sggCore) {
  const addr = strip(item.rdnmadr || item.lnmadr);
  const inst = strip(item.institutionNm);
  const okSido = !sidoCore || addr.includes(sidoCore) || inst.includes(sidoCore);
  const okSgg = !sggCore || addr.includes(sggCore) || inst.includes(sggCore);
  return okSido && okSgg;
}

function shape(it) {
  return {
    name: it.prkplceNm,
    type: it.prkplceSe || null,          // 공영 / 민영
    kind: it.prkplceType || null,        // 노상 / 노외 / 부설
    address: it.rdnmadr || it.lnmadr || null,
    spaces: it.prkcmprt || null,         // 주차구획수
    charge: it.parkingchrgeInfo || null, // 유료 / 무료
    basicTime: it.basicTime || null,
    basicCharge: it.basicCharge || null,
    weekdayOpen: it.weekdayOperOpenHhmm || null,
    weekdayClose: it.weekdayOperColseHhmm || null,
    tel: it.phoneNumber || null,
    lat: it.latitude ? Number(it.latitude) : null,
    lng: it.longitude ? Number(it.longitude) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const { sido, sigungu } = req.query;
  const limit = Number(req.query.limit || 12);
  if (!sido && !sigungu) {
    return res.status(400).json({ error: 'sido 또는 sigungu가 필요합니다.' });
  }

  const sidoCore = coreName(sido);
  const sggCore = coreName(sigungu);

  try {
    // 1차: 관리기관명으로 좁혀보기 (지자체가 운영하는 주차장이 대부분)
    if (sggCore) {
      const first = await callApi(key, { institutionNm: sigungu });
      if (!first.ok) {
        return res.status(502).json({
          error: '공공데이터포털 응답 오류',
          hint: '"전국주차장정보표준데이터" 활용신청 승인 여부를 확인해주세요.',
          detail: first.raw,
        });
      }
      const hits = first.rows.filter((it) => matches(it, sidoCore, sggCore));
      if (hits.length) {
        return res.status(200).json({
          sido: sido || null,
          sigungu: sigungu || null,
          strategy: 'institution',
          matched: hits.length,
          items: hits.slice(0, limit).map(shape),
        });
      }
    }

    // 2차: 페이지를 나눠 훑으며 주소로 매칭 (충분히 모이면 조기 종료)
    const found = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await callApi(key, { pageNo: String(page) });
      if (!r.ok) break;
      if (!r.rows.length) break;

      found.push(...r.rows.filter((it) => matches(it, sidoCore, sggCore)));
      if (found.length >= limit) break;
      if (r.rows.length < ROWS) break;
    }

    return res.status(200).json({
      sido: sido || null,
      sigungu: sigungu || null,
      strategy: 'scan',
      matched: found.length,
      notice: found.length === 0 ? '이 지역 주차장 정보를 찾지 못했어요.' : null,
      items: found.slice(0, limit).map(shape),
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
