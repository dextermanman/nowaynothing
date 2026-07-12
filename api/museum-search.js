// api/museum-search.js
// 공공데이터포털 "전국박물관미술관정보표준데이터" 프록시.
// 전국 모든 시군구의 박물관/미술관을 조회할 수 있어요 (시드 데이터에 없는 지역도 커버).
// 사용: /api/museum-search?sido=경기도&sigungu=화성시
// 필요 환경변수: DATA_GO_KR_KEY (hospital-search와 같은 키 하나로 사용)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sido, sigungu } = req.query;
  const key = process.env.DATA_GO_KR_KEY;

  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }
  if (!sido) {
    return res.status(400).json({ error: 'sido 파라미터가 필요합니다. 예: /api/museum-search?sido=경기도' });
  }

  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '20',
    type: 'json',
    CTPRVN_NM: sido,       // 시도명
  });
  if (sigungu) params.set('SIGNGU_NM', sigungu); // 시군구명

  try {
    const url = 'http://api.data.go.kr/openapi/tn_pubr_public_museum_artgr_info_api?' + params.toString();
    const r = await fetch(url);
    const text = await r.text();

    let data;
    try { data = JSON.parse(text); }
    catch {
      // 키 오류 등은 XML로 내려오는 경우가 있음
      const m = text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/);
      return res.status(502).json({ error: '공공데이터포털 응답 오류: ' + (m ? m[1] : text.slice(0, 200)) });
    }

    const rows = data?.response?.body?.items || [];
    const items = rows.map((it) => ({
      name: it.fcltyNm,
      kind: it.fcltyType || it.museumType || null,          // 박물관/미술관 구분
      address: it.rdnmadr || it.lnmadr,
      tel: it.phoneNumber || null,
      open: (it.operOpenHhmm && it.operColseHhmm) ? (it.operOpenHhmm + '~' + it.operColseHhmm) : null,
      closed: it.rstdeGuidCn || null,                        // 휴관일 안내
      fee: it.admfeeInfo || null,                            // 입장료 정보
    }));

    return res.status(200).json({
      sido, sigungu: sigungu || null,
      notice: '운영시간·휴관일은 지자체 등록 기준이라 최신과 다를 수 있어요. 방문 전 확인 추천!',
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
