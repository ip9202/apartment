-- 마이그레이션 006 — notices + notice_categories (SPEC-NOTICE-001 M6)
-- REQ-NOTICE-017 (notice_categories 시드), REQ-NOTICE-018 (notices 스키마)
--
-- @MX:ANCHOR: [AUTO] NOTICE 스키마 불변 지점 — notices/notice_categories 테이블 정의
-- @MX:REASON:  notices.author_id/category_id FK 와 is_pinned 디폴트 false 는 NOTICE 도메인 계약.
--             본 스키마는 AUTH/SETUP 산출물과 독립적이며 migration 005 이후 순차 적용된다.
--
-- 멱등성: CREATE TABLE IF NOT EXISTS + name UNIQUE + ON CONFLICT (name) DO NOTHING.
--   name UNIQUE 제약이 없으면 ON CONFLICT (name) 의 충돌 타겟이 없어 매 실행마다
--   시드 4행이 중복 삽입된다. UNIQUE 추가로 재실행 안전.

-- @MX:NOTE: [AUTO] 4종(일반/긴급/주차/시설) 고정 시드 — 동적 카테고리 CRUD 는
--           NOTICE-07 P1 별도 SPEC. name UNIQUE 로 ON CONFLICT (name) 충돌 타겟 보장.
CREATE TABLE IF NOT EXISTS notice_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(30) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO notice_categories (name, sort_order) VALUES
  ('일반', 1),
  ('긴급', 2),
  ('주차', 3),
  ('시설', 4)
ON CONFLICT (name) DO NOTHING;

-- @MX:NOTE: [AUTO] notices.is_pinned 컬럼은 ERD 전방 호환성을 위해 존재하나
--           본 SPEC(SPEC-NOTICE-001)은 is_pinned API 동작을 노출하지 않는다.
--           디폴트 false 로 저장만 됨. NOTICE-06 P1 별도 SPEC 연결.
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id),
  category_id UUID NOT NULL REFERENCES notice_categories(id),
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notices_category_id ON notices(category_id);
CREATE INDEX IF NOT EXISTS idx_notices_is_pinned ON notices(is_pinned);
-- @MX:NOTE: [AUTO] created_at DESC 인덱스 — REQ-NOTICE-011 최신순 페이지네이션 성능.
CREATE INDEX IF NOT EXISTS idx_notices_created_at_desc ON notices(created_at DESC);
