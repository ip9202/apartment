-- 마이그레이션 007 — suggestion_categories 시드 + suggestions ALTER + suggestion_replies
-- SPEC-SUGGEST-001 (M8b, REQ-SUGGEST-038/039/040, AC-SUGGEST-046~050)
--
-- @MX:ANCHOR: [AUTO] SUGGEST 스키마 불변 지점 — suggestions/suggestion_categories/suggestion_replies 정의
-- @MX:REASON:  suggestions 는 AUTH 004(AUTH 사이드이펙트 최소 스키마) 를 ALTER 로 확장.
--             기존 컬럼(id, author_id, author_label, archived, unit_id, created_at) 보존 필수.
--             suggestion_categories.name UNIQUE + ON CONFLICT 로 시드 멱등성 보장.
--             AUTH deactivate route(deactivate/route.ts:131-136) 가 ALTER 후에도 동일 UPDATE 로
--             정상 동작해야 (R1 최고 위험 — author_id/author_label/archived 만 갱신, 신규 NOT NULL 컬럼 미참조).
--
-- 멱등성: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--         + name UNIQUE + ON CONFLICT (name) DO NOTHING. 재실행 안전.

-- @MX:NOTE: [AUTO] 4종(시설/주차/소음/기타) 고정 시드 — 동적 카테고리 CRUD 는 SUGGEST-13 P1 별도 SPEC.
--           name UNIQUE 로 ON CONFLICT (name) 충돌 타겟 보장 (NOTICE 006 패턴 동일).
CREATE TABLE IF NOT EXISTS suggestion_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(30) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO suggestion_categories (name, sort_order) VALUES
  ('시설', 1),
  ('주차', 2),
  ('소음', 3),
  ('기타', 4)
ON CONFLICT (name) DO NOTHING;

-- @MX:WARN: [AUTO] suggestions ALTER — 기존 004 데이터 보존 필수. ADD COLUMN IF NOT EXISTS + DEFAULT 사용.
-- @MX:REASON: NOT NULL DEFAULT 로 PG 15+ 기존 행에 디폴트값 자동 채움 (데이터 손실 없음).
--            DEFAULT 없는 NOT NULL 추가는 기존 행 보유 테이블에서 실패하므로 반드시 DEFAULT 명시.
ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES suggestion_categories(id),
  ADD COLUMN IF NOT EXISTS title VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT '접수',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suggestions_category_id ON suggestions(category_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_is_public   ON suggestions(is_public);
CREATE INDEX IF NOT EXISTS idx_suggestions_status      ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_archived    ON suggestions(archived);

-- @MX:NOTE: [AUTO] suggestion_replies — ADMIN 답변 등록(M6) 전용. 수정/삭제는 본 SPEC OUT (별도 SPEC).
CREATE TABLE IF NOT EXISTS suggestion_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES suggestions(id),
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_replies_suggestion_id
  ON suggestion_replies(suggestion_id);
