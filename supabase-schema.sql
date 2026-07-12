-- Supabase SQL Editor에서 이 파일 내용을 그대로 붙여넣고 실행하세요.
-- (프로젝트 대시보드 > SQL Editor > New query)

-- 1) 명소 테이블: 정적 시드 데이터 + 커뮤니티가 실시간 검색으로 추가한 명소가 함께 쌓입니다
create table if not exists spots (
  id text primary key,
  city text not null,
  name text not null,
  theme text not null default 'food',
  weekday boolean default true,
  weekend boolean default true,
  rating numeric,
  reviews text,
  popularity int default 50,
  badge text,               -- 'jyj' | 'bbcs' | null
  source text default 'community',  -- 'seed' | 'naver' | 'community'
  address text,
  link text,
  created_at timestamptz default now()
);

-- 2) 후기(댓글) 테이블
create table if not exists reviews (
  id bigserial primary key,
  spot_id text references spots(id) on delete cascade,
  name text default '익명',
  text text not null,
  created_at timestamptz default now()
);

-- 3) 체크인(방문 인증) 테이블
create table if not exists checkins (
  spot_id text primary key references spots(id) on delete cascade,
  count int default 0
);

-- ── 보안 설정 (RLS) ──
-- 지인 커뮤니티용이라 로그인 없이 "누구나 읽기/쓰기"는 허용하되,
-- 수정(update)·삭제(delete)는 막아서 장난으로 남의 글이 지워지는 걸 방지합니다.

alter table spots enable row level security;
alter table reviews enable row level security;
alter table checkins enable row level security;

create policy "spots_select_all" on spots for select using (true);
create policy "spots_insert_all" on spots for insert with check (true);

create policy "reviews_select_all" on reviews for select using (true);
create policy "reviews_insert_all" on reviews for insert with check (true);

create policy "checkins_select_all" on checkins for select using (true);
create policy "checkins_insert_all" on checkins for insert with check (true);
create policy "checkins_update_all" on checkins for update using (true);
