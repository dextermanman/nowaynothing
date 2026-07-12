// api/hospital-search.js
// 국가 의료시스템(국립중앙의료원, 공공데이터포털 B552657) 전국 병·의원 찾기 서비스 프록시.
// 소아청소년과(D002) 병원을 시도/시군구별로 조회하고, 요일별 진료시간까지 돌려줍니다.
// 사용: /api/hospital-search?sido=경기도&sigungu=화성시
// 필요 환경변수: DATA_GO_KR_KEY (공공데이터포털 "일반 인증키(Decoding)" 값)

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일', '공휴일'];

function fmt(t) {
  // "0900" -> "09:00"
  if (!t || t.length < 4) return null;
  return t.slice(0, 2) + ':' + t.slice(2, 4);
}

function pick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return m ? m[1].trim() : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sido, sigungu, subject } = req.query;
  const key = process.env.DATA_GO_KR_KEY;

  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다. Vercel Settings > Environment Variables에 등록해주세요.' });
  }
  if (!sido) {
    return res.status(400).json({ error: 'sido 파라미터가 필요합니다. 예: /api/hospital-search?sido=경기도&sigungu=화성시' });
  }

  const params = new URLSearchParams({
    serviceKey: key,          // Decoding 키 기준 (URLSearchParams가 알아서 인코딩)
    Q0: sido,                 // 시도명 (예: 경기도)
    QD: subject || 'D002',    // 진료과목: D002 = 소아청소년과
    numOfRows: '20',
    pageNo: '1',
  });
  if (sigungu) params.set('Q1', sigungu); // 시군구명 (예: 화성시)

  try {
    const url = 'http://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire?' + params.toString();
    const r = await fetch(url);
    const xml = await r.text();

    // 공공데이터포털 에러 응답 처리
    const errMsg = pick(xml, 'returnAuthMsg') || pick(xml, 'errMsg');
    if (errMsg && !xml.includes('<item>')) {
      return res.status(502).json({ error: '공공데이터포털 응답 오류: ' + errMsg + ' (API 활용신청/키 등록 상태를 확인해주세요)' });
    }

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const b = m[1];
      const hours = [];
      for (let i = 1; i <= 8; i++) {
        const s = fmt(pick(b, 'dutyTime' + i + 's'));
        const c = fmt(pick(b, 'dutyTime' + i + 'c'));
        if (s && c) hours.push(DAY_LABELS[i - 1] + ' ' + s + '~' + c);
      }
      return {
        name: pick(b, 'dutyName'),
        address: pick(b, 'dutyAddr'),
        tel: pick(b, 'dutyTel1'),
        hours, // 예: ["월 09:00~18:00", "토 09:00~13:00", ...]
      };
    });

    return res.status(200).json({
      sido, sigungu: sigungu || null,
      subject: subject || 'D002(소아청소년과)',
      notice: '진료시간은 기관 신고 기준이라 실제와 다를 수 있어요. 방문 전 꼭 전화 확인하세요.',
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
