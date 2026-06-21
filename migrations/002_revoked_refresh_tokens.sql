-- 마이그레이션 002: revoked_refresh_tokens (Refresh Token 블랙리스트)
-- SPEC-AUTH-001 (REQ-AUTH-007, REQ-AUTH-009, REQ-AUTH-014)
--
-- 로그아웃/강제탈퇴 시 RT 의 jti+hash 를 등록하여 즉시 무효화.
-- 정책 Q4: 만료 RT 도 보존 (정리 cron 제외) — ADR-003 트레이드오프.
-- 멱등: IF NOT EXISTS 사용.
-- @MX:WARN: [AUTO] 블랙리스트 누락 시 탈취된 RT 재사용 허용 — 인증 보안 핵심
-- @MX:REASON: revoked_refresh_tokens 미구성 시 로그아웃/탈퇴 후에도 RT 가 유효하여 세션 탈취 지속

CREATE TABLE IF NOT EXISTS revoked_refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_jti     VARCHAR(255) NOT NULL UNIQUE,
    token_hash    VARCHAR(255) NOT NULL,
    user_id       UUID NOT NULL REFERENCES users(id),
    revoked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_refresh_tokens_token_hash   ON revoked_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_revoked_refresh_tokens_user_id      ON revoked_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_refresh_tokens_expires_at   ON revoked_refresh_tokens(expires_at);
