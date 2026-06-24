-- 마이그레이션 010 — attachments (SPEC-ATTACHMENT-001 M-ATT)
-- REQ-ATT-029 (attachments 테이블 스키마)
--
-- @MX:ANCHOR: [AUTO] ATTACHMENT 스키마 불변 지점 — attachments 테이블 정의
-- @MX:REASON:  target_type/target_id 다형성 참조는 DB FK 대신 애플리케이션 검증으로 보완.
--             uploader_id FK는 users(id) — AUTH deactivate cascade(REQ-ATT-028) 호환성 필수.
--             size_bytes CHECK <= 10485760 은 REQ-ATT-023(10MB) DB 레벨 강제.
--
-- 멱등성: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--   migration 009(password_reset_tokens) 이후 순차 적용.

-- @MX:NOTE: [AUTO] 다형성 target — target_id 는 DB FK 가 아님. NOTICE/SUGGEST 삭제/아카이브/
--           AUTH deactivate cascade(REQ-ATT-026/027/028) 가 애플리케이션 레벨에서 원자 정리.
CREATE TABLE IF NOT EXISTS attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type       VARCHAR(10) NOT NULL CHECK (target_type IN ('NOTICE','SUGGEST')),
    target_id         UUID NOT NULL,
    uploader_id       UUID NOT NULL REFERENCES users(id),
    original_filename VARCHAR(255) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    storage_path      TEXT NOT NULL,
    sha256            CHAR(64) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 게시물별 첨부 목록 조회용 복합 인덱스 (REQ-ATT-009/010 attachments[] 조회 고속화)
CREATE INDEX IF NOT EXISTS idx_attachments_target
    ON attachments(target_type, target_id);

-- 업로더별 첨부 조회 (AUTH deactivate cascade — REQ-ATT-028)
CREATE INDEX IF NOT EXISTS idx_attachments_uploader_id
    ON attachments(uploader_id);
