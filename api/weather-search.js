// api/weather-search.js
// 기상청 단기예보(동네예보) 조회서비스 프록시.
// 시도 단위 대표 지점(도청/시청 소재지)의 오늘/내일 날씨 요약만 제공합니다.
//
// 사용: /api/weather-search?region=r1
// 필요 환경변수: DATA_GO_KR_KEY (data.go.kr에서 "기상청_단기예보 조회서비스" 활용신청 필요. serviceKey로 apis.data.go.kr에 직접 호출)

function normalizeKey(k) {
  if (!k) return k;
  return k.includes('%') ? decodeURIComponent(k) : k;
}

// 프론트(REGIONS)의 지역 id와 매칭되는 대표 지점(도청/시청 소재지) 위경도
const REGION_COORDS = {
  r1: { name: '서울', lat: 37.5665, lon: 126.978 },
  r2: { name: '인천', lat: 37.4563, lon: 126.7052 },
  r31: { name: '경기', lat: 37.2636, lon: 127.0286 },
  r32: { name: '강원', lat: 37.8228, lon: 127.21 },
  r34: { name: '충남', lat: 36.6588, lon: 126.6733 },
  r3: { name: '대전', lat: 36.3504, lon: 127.3845 },
  r8: { name: '세종', lat: 36.4801, lon: 127.289 },
  r33: { name: '충북', lat: 36.6357, lon: 127.4913 },
  r37: { name: '전북', lat: 35.8242, lon: 127.148 },
  r35: { name: '경북', lat: 36.576, lon: 128.5056 },
  r4: { name: '대구', lat: 35.8714, lon: 128.6014 },
  r7: { name: '울산', lat: 35.5384, lon: 129.3114 },
  r5: { name: '광주', lat: 35.1595, lon: 126.8526 },
  r38: { name: '전남', lat: 34.8161, lon: 126.4629 },
  r36: { name: '경남', lat: 35.228, lon: 128.6811 },
  r6: { name: '부산', lat: 35.1796, lon: 129.0756 },
  r39: { name: '제주', lat: 33.4996, lon: 126.5312 },
};

// 기상청 격자좌표 변환 (Lambert Conformal Conic, 기상청 공개 알고리즘)
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// KST(UTC+9) 기준 날짜/시각 필드를 서버 타임존과 무관하게 뽑아낸다.
function kstParts(date) {
  const t = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

function ymd({ y, m, d }) {
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

// 단기예보 발표시각(02,05,08,...,23시)은 약 10분 뒤 반영되므로,
// 가장 최근에 반영됐을 발표시각부터 과거로 후보를 만들어 순서대로 시도한다.
function candidateBases(now, count) {
  const times = [2300, 2000, 1700, 1400, 1100, 800, 500, 200];
  const results = [];
  for (let dayOffset = 0; dayOffset >= -1 && results.length < count; dayOffset--) {
    const parts = kstParts(new Date(now.getTime() + dayOffset * 86400000));
    const hhmm = parts.hh * 100 + parts.mm;
    for (const t of times) {
      if (dayOffset === 0 && hhmm < t + 10) continue;
      results.push({ base_date: ymd(parts), base_time: String(t).padStart(4, '0') });
      if (results.length >= count) break;
    }
  }
  return results;
}

const SKY_TEXT = { 1: '맑음', 3: '구름많음', 4: '흐림' };
const PTY_TEXT = { 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' };

function summarizeDay(items, date) {
  const dayItems = items.filter((it) => it.fcstDate === date);
  if (!dayItems.length) return null;

  const byCategory = (cat) => dayItems.filter((it) => it.category === cat);
  const pickDaytime = (arr) => arr.find((it) => it.fcstTime >= '0900' && it.fcstTime <= '1800') || arr[0] || null;

  const tmnItem = byCategory('TMN')[0];
  const tmxItem = byCategory('TMX')[0];
  const popItems = byCategory('POP');
  const skyItem = pickDaytime(byCategory('SKY'));
  const ptyItem = pickDaytime(byCategory('PTY'));

  const ptyCode = ptyItem ? Number(ptyItem.fcstValue) : 0;
  const label = ptyCode > 0 ? PTY_TEXT[ptyCode] || null : (skyItem ? SKY_TEXT[skyItem.fcstValue] || null : null);

  return {
    date,
    label,
    tmn: tmnItem ? Math.round(Number(tmnItem.fcstValue)) : null,
    tmx: tmxItem ? Math.round(Number(tmxItem.fcstValue)) : null,
    pop: popItems.length ? Math.max(...popItems.map((it) => Number(it.fcstValue))) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const key = normalizeKey(process.env.DATA_GO_KR_KEY);
  if (!key) {
    return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 없습니다.' });
  }

  const { region } = req.query;
  const coord = REGION_COORDS[region];
  if (!coord) {
    return res.status(400).json({ error: `region 파라미터가 올바르지 않습니다. 예: /api/weather-search?region=r1 (가능한 값: ${Object.keys(REGION_COORDS).join(', ')})` });
  }

  const { nx, ny } = toGrid(coord.lat, coord.lon);
  const now = new Date();
  const today = ymd(kstParts(now));
  const tomorrow = ymd(kstParts(new Date(now.getTime() + 86400000)));

  let lastRaw = null;

  for (const { base_date, base_time } of candidateBases(now, 4)) {
    const params = new URLSearchParams({
      serviceKey: key,
      numOfRows: '1000',
      pageNo: '1',
      dataType: 'JSON',
      base_date,
      base_time,
      nx: String(nx),
      ny: String(ny),
    });

    try {
      const r = await fetch(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${params.toString()}`);
      const text = await r.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const authMsg = text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/);
        lastRaw = authMsg ? authMsg[1] : text.slice(0, 200);
        continue;
      }

      const header = data?.response?.header;
      if (!header || header.resultCode !== '00') {
        lastRaw = `${header?.resultCode} ${header?.resultMsg || ''}`;
        continue;
      }

      let items = data?.response?.body?.items?.item ?? [];
      if (!Array.isArray(items)) items = items ? [items] : [];
      if (!items.length) {
        lastRaw = 'empty items';
        continue;
      }

      const days = [summarizeDay(items, today), summarizeDay(items, tomorrow)].filter(Boolean);
      if (!days.length) {
        lastRaw = 'no matching dates in forecast';
        continue;
      }

      return res.status(200).json({
        region: coord.name,
        nx,
        ny,
        baseDate: base_date,
        baseTime: base_time,
        days,
      });
    } catch (err) {
      lastRaw = String(err);
    }
  }

  return res.status(502).json({
    error: '기상청 단기예보 호출 실패',
    hint: 'data.go.kr에서 "기상청_단기예보 조회서비스" 활용신청 승인 여부와, Vercel의 DATA_GO_KR_KEY 값을 확인해주세요.',
    detail: typeof lastRaw === 'string' ? lastRaw.slice(0, 400) : null,
  });
}
