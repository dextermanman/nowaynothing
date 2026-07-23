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


// data.go.kr은 Encoding키/Decoding키 두 종류를 줍니다.
// Encoding키(%2B 같은 문자 포함)를 그대로 쓰면 이중 인코딩돼서 인증에 실패하므로,
// %가 포함돼 있으면 먼저 디코드해서 항상 Decoding키 형태로 맞춥니다.
function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sido, sigungu, subject } = req.query;
  const key = normalizeKey(process.env.DATA_GO_KR_KEY);

  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다. Vercel Settings > Environment Variables에 등록해주세요.' });
  }
  if (!sido) {
    return res.status(400).json({ error: 'sido 파라미터가 필요합니다. 예: /api/hospital-search?sido=경기도&sigungu=화성시' });
  }

  // 시도명 표기 흔들림 대비 (강원도 ↔ 강원특별자치도 등)
  const SIDO_ALT = {
    '강원특별자치도': ['강원도'], '강원도': ['강원특별자치도'],
    '전북특별자치도': ['전라북도'], '전라북도': ['전북특별자치도'],
    '제주특별자치도': ['제주도'], '제주도': ['제주특별자치도'],
    '세종특별자치시': ['세종시'], '세종시': ['세종특별자치시'],
  };
  const candidates = [sido, ...(SIDO_ALT[sido] || [])];

  async function query(sidoName) {
    const params = new URLSearchParams({
      serviceKey: key,
      Q0: sidoName,
      QD: subject || 'D002',   // D002 = 소아청소년과
      numOfRows: '20',
      pageNo: '1',
    });
    if (sigungu) params.set('Q1', sigungu);

    const url =
      'http://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire?' +
      params.toString();
    const r = await fetch(url);
    const xml = await r.text();

    const errMsg = pick(xml, 'returnAuthMsg') || pick(xml, 'errMsg');
    if (errMsg && !xml.includes('<item>')) {
      return { error: errMsg };
    }

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const b = m[1];
      const hours = [];
      for (let i = 1; i <= 8; i++) {
        const st = fmt(pick(b, 'dutyTime' + i + 's'));
        const cl = fmt(pick(b, 'dutyTime' + i + 'c'));
        if (st && cl) hours.push(DAY_LABELS[i - 1] + ' ' + st + '~' + cl);
      }
      return {
        name: pick(b, 'dutyName'),
        address: pick(b, 'dutyAddr'),
        tel: pick(b, 'dutyTel1'),
        hours,
      };
    });

    return { items };
  }

  try {
    let lastError = null;

    for (const name of candidates) {
      const r = await query(name);
      if (r.error) { lastError = r.error; continue; }
      if (r.items && r.items.length) {
        return res.status(200).json({
          sido: name,
          sigungu: sigungu || null,
          subject: subject || 'D002(소아청소년과)',
          notice: '진료시간은 기관 신고 기준이라 실제와 다를 수 있어요. 방문 전 꼭 전화로 확인하세요.',
          items: r.items,
        });
      }
    }

    if (lastError) {
      return res.status(502).json({
        error: '공공데이터포털 응답 오류: ' + lastError,
        hint: '"국립중앙의료원_전국 병·의원 찾기 서비스" 활용신청 승인 여부를 확인해주세요.',
      });
    }

    return res.status(200).json({
      sido, sigungu: sigungu || null,
      notice: '진료시간은 기관 신고 기준이라 실제와 다를 수 있어요. 방문 전 꼭 전화로 확인하세요.',
      items: [],
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
