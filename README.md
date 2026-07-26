# 지역 나들이 레이더 — 배포 가이드

지인들과 같이 쓰는 웹사이트로 만들기 위한 5단계입니다.
순서대로만 따라오시면 됩니다 (총 1시간~1시간 30분 예상).

---

## 0. 준비물
- Naver 개발자센터 계정 (네이버 아이디만 있으면 됨)
- 공공데이터포털(data.go.kr) 계정
- 이메일 주소 (KOPIS 공연정보 API 키 수신용, 회원가입 불필요)
- Supabase 계정 (구글/깃허브로 바로 가입 가능)
- GitHub 계정
- Vercel 계정 (GitHub으로 바로 가입 가능)

---

## 1단계. 네이버 지역검색 API 키 발급

1. https://developers.naver.com/main/ 접속 → 로그인
2. 상단 메뉴 **Application > 애플리케이션 등록**
3. 애플리케이션 이름: 아무거나 (예: "지역명소대시보드")
4. 사용 API: **검색** 체크
5. 서비스 환경: **WEB 설정** 선택 → 웹 서비스 URL에 일단 `http://localhost:3000` 입력 (나중에 실제 배포 주소로 하나 더 추가하면 됨)
6. 등록 완료 후 발급되는 **Client ID / Client Secret** 복사해두기 (나중에 Vercel에 입력)

---

## 2단계. 공공데이터 API 키 발급

관광정보·박물관·소아과·캠핑장·공연정보 검색 기능에 필요합니다.

1. https://www.data.go.kr 접속 → 회원가입/로그인
2. 아래 데이터셋 각각에서 **활용신청** (보통 자동승인, 몇 분 내 완료):
   - [한국관광공사_국문 관광정보 서비스_GW](https://www.data.go.kr/data/15101578/openapi.do)
   - [전국박물관미술관정보표준데이터](https://www.data.go.kr/data/15017323/standard.do)
   - [국립중앙의료원_전국 병·의원 찾기 서비스](https://www.data.go.kr/data/15000736/openapi.do)
   - [한국관광공사_고캠핑 정보 조회서비스_GW](https://www.data.go.kr/data/15101933/openapi.do)
3. 마이페이지 > 오픈API > **인증키 발급현황**에서 **일반 인증키(Decoding)** 복사 → `DATA_GO_KR_KEY`로 사용
   (계정당 키 1개를 여러 API에 공용으로 씁니다. API마다 활용신청만 각각 필요)
4. 공연·전시 정보는 별도 시스템(KOPIS)이라 키가 다릅니다:
   https://www.kopis.or.kr/por/cs/openapi/openApiUseSend.do 에서 이메일 입력 → 인증키를 메일로 수신 → `KOPIS_API_KEY`로 사용

> ⚠️ 기상청 날씨 API와 한국환경공단 전기차 충전소 API는 각각 별도 포털 가입이 필요하거나(기상청 API허브),
> 클라우드/해외 IP를 차단하는 경우(환경공단)가 있어서 이 프로젝트에서는 제외했습니다.

---

## 3단계. Supabase 프로젝트 만들기

1. https://supabase.com 접속 → New Project
2. 프로젝트 이름/비밀번호 아무거나 설정, Region은 **Northeast Asia (Seoul)** 선택
3. 생성 완료되면 왼쪽 메뉴 **SQL Editor** 클릭 → New query
4. 이 프로젝트 폴더의 `supabase-schema.sql` 파일 내용을 전부 복사해서 붙여넣고 **Run** 실행
   → `spots`, `reviews`, `checkins` 테이블 3개가 자동으로 생성됩니다
5. 왼쪽 메뉴 **Project Settings > API** 에서 다음 2가지를 복사:
   - `Project URL` (예: `https://abcdxxxx.supabase.co`)
   - `anon public` 키 (긴 문자열)

---

## 4단계. 코드에 설정값 넣기

`public/index.html` 파일을 열어서 아래 부분을 찾아 값을 바꿔주세요.

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';   // ← 2단계에서 복사한 Project URL
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';               // ← 2단계에서 복사한 anon public 키
```

> 이 anon key는 "누구나 봐도 되는 공개키"라서 코드에 그대로 넣어도 안전합니다.
> (진짜 비밀키인 네이버 Client Secret은 절대 여기 넣지 않고, 4단계에서 Vercel 환경변수로만 등록합니다)

---

## 5단계. GitHub에 올리고 Vercel로 배포

1. 이 프로젝트 폴더 전체를 새 GitHub 저장소(repository)에 업로드
   - GitHub 웹사이트에서 New repository → 파일 드래그 앤 드롭으로도 가능
2. https://vercel.com 접속 → New Project → 방금 만든 저장소 선택 → Deploy
3. 배포가 끝나면 Vercel이 `xxx.vercel.app` 형태의 무료 주소를 줍니다
4. **Vercel 프로젝트 > Settings > Environment Variables** 에서 아래 4개 등록 후 **Redeploy**:
   - `NAVER_CLIENT_ID` = 1단계에서 받은 값
   - `NAVER_CLIENT_SECRET` = 1단계에서 받은 값
   - `DATA_GO_KR_KEY` = 2단계에서 받은 공공데이터포털 일반 인증키
   - `KOPIS_API_KEY` = 2단계에서 받은 KOPIS 인증키
5. 네이버 개발자센터로 돌아가서, 애플리케이션 설정의 **웹 서비스 URL**에 방금 받은 `xxx.vercel.app` 주소도 추가 등록

---

## 이제 뭐가 되나요?

- `xxx.vercel.app` 주소를 지인들에게 공유하면 다 같이 접속 가능
- 댓글/후기, 체크인 카운트는 Supabase DB에 저장되어 **모든 사람에게 실시간 공유**
- "한국관광공사 공식 관광DB"·"공연·전시" 패널에서 검색 결과를 "커뮤니티에 추가" 버튼으로 바로 명소 목록에 반영 가능
  (DB에도 저장되어 다음 접속자에게도 보임)
- "한국관광공사 공식 관광DB" 패널에서 전국 관광지·맛집·숙박·축제 정보를 사진과 함께 조회
- "나라 데이터로 검색" 패널에서 소아과 진료시간, 박물관·미술관, 공연·전시 정보를 지역별로 조회
- 지역 선택 화면의 명소 목록에는 고캠핑(한국관광공사) 캠핑장 정보도 자동으로 합쳐져서 표시됨

## 앞으로 더 해볼 수 있는 것
- 인기지수(popularity)를 네이버 리뷰수 기반으로 자동 계산하는 로직 추가
- 스팸 방지를 위한 간단한 캡차나 하루 등록 제한
- 커스텀 도메인 연결 (Vercel에서 도메인 구매 or 기존 도메인 연결, 연 1~2만원대)
