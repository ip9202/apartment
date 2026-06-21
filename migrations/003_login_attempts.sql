-- 마이그레이션 003: login_attempts (DB 기반 Rate Limiting 추적)
-- SPEC-AUTH-001 (REQ-AUTH-006)
--
-- 동일 이메일 연속 5회 실패 → 10분 잠금 (locked_until).
-- DB 영속화로 서버 재시작 후에도 잠금 상태 유지.
-- 멱등: IF NOT EXISTS 사용.

CREATE TABLE IF NOT EXISTS login_attempts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) NOT NULL,
    failed_count      INT NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ NULL,
    last_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
