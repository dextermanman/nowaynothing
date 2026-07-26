// api/youtube-search.js
// YouTube Data API v3 검색 프록시.
//
// 사용: /api/youtube-search?query=화성 맛집
// 필요 환경변수: YOUTUBE_API_KEY (Google Cloud Console에서 발급, "YouTube Data API v3" 활성화 필요)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY 환경변수가 없습니다.' });
  }

  const { query } = req.query;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다. 예: /api/youtube-search?query=화성 맛집' });
  }

  const params = new URLSearchParams({
    key,
    q: query.trim(),
    part: 'snippet',
    type: 'video',
    maxResults: '12',
    relevanceLanguage: 'ko',
    safeSearch: 'moderate',
  });

  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    const data = await r.json();

    if (data.error) {
      return res.status(502).json({
        error: '유튜브 API 응답 오류',
        hint: 'Google Cloud Console에서 "YouTube Data API v3"가 활성화되어 있는지, YOUTUBE_API_KEY 값이 정확한지 확인해주세요.',
        detail: data.error.message || JSON.stringify(data.error).slice(0, 200),
      });
    }

    const items = (data.items || []).map((it) => ({
      videoId: it.id?.videoId,
      title: it.snippet?.title,
      channel: it.snippet?.channelTitle,
      thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || null,
      publishedAt: it.snippet?.publishedAt,
    })).filter((it) => it.videoId);

    return res.status(200).json({ query, matched: items.length, items });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류', detail: String(err) });
  }
}
