-- 마이그레이션 009: password_reset_tokens (비밀번호 재설정 토큰)
-- SPEC-AUTH-RESET-001 (REQ-RESET-001, REQ-RESET-004, REQ-RESET-005, REQ-RESET-008)
--
-- 비밀번호 재설정 링크 토큰을 SHA-256 해시로 저장 (원문 미보관).
-- 만료 30분, used_at 으로 일회용 추적.
-- 멱등: IF NOT EXISTS 사용.
-- @MX:WARN: [AUTO] 원문 토큰 평문 저장 금지 — DB 유출 시 직접 공격 허용
-- @MX:REASON: token_hash 컬럼에 원문을 넣으면 DB 덤프 시 즉시 재설정 링크 탈취 가능

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    token_hash    VARCHAR(255) NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash   ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id      ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at   ON password_reset_tokens(expires_at);
