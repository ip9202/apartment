-- 마이그레이션 011 — 카카오 OAuth (SPEC-AUTH-KAKAO-001, REQ-KAKAO-009)
--
-- 목적: users(provider, provider_id) 부분 유니크 인덱스 추가.
--   provider_id IS NOT NULL 인 행(소셜 계정)만 유일성 검사 대상.
--   이메일 계정의 provider_id=NULL 은 유일성 제약에서 제외 (여러 이메일 계정 허용).
--
-- 멱등: CREATE INDEX IF NOT EXISTS 로 재적용 시 에러 없음.
--   migration 001 이 이미 provider/provider_id 컬럼을 정의하므로 본 마이그레이션은 인덱스만 추가.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_provider_id_unique
  ON users (provider, provider_id)
  WHERE provider_id IS NOT NULL;
