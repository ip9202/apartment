-- 마이그레이션 004: suggestions (최소 스키마 — AUTH 사이드이펙트용)
-- SPEC-AUTH-001 (REQ-AUTH-014, ADR-005 호수 귀속, MAJOR-5 suggestions side-effect)
--
-- @MX:NOTE: [AUTO] SUGGEST SPEC 이 이 테이블을 확장 예정 (category/title/content/status/is_public 등).
--           AUTH 는 강제 탈퇴(deactivate) 사이드이펙트용 최소 스키마만 소유한다.
--           ADR-005: unit_id 는 호수 귀속 정책 준수를 위해 NOT NULL 로 보존 —
--           deactivate 트랜잭션에서 unit_id 를 건드리지 않는다 (author_id 만 NULL 처리).
-- 멱등: IF NOT EXISTS 사용.

CREATE TABLE IF NOT EXISTS suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NULL REFERENCES users(id),
    author_label    VARCHAR(30) NOT NULL DEFAULT '입주민',
    archived        BOOLEAN NOT NULL DEFAULT false,
    unit_id         UUID NOT NULL REFERENCES units(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestions_author_id ON suggestions(author_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_unit_id   ON suggestions(unit_id);
