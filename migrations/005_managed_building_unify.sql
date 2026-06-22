-- 마이그레이션 005: managed_building_id 단일 출처 통일 (SETUP Phase A)
-- SPEC-SETUP-001 M5 / REQ-SETUP-018 / REQ-SETUP-019
--
-- @MX:NOTE: [AUTO] SETUP 소유 — users.managed_building_id 단일 출처 원칙.
--           roles.managed_building_id 컬럼은 AUTH 001 마이그레이션에서 잔류한 미사용 컬럼.
--           데이터 안전성: roles.managed_building_id 는 seed.ts 가 채우지 않으므로
--           모든 행이 NULL (사전 검증 완료 — DROP 전 count(*) = 0).
--
-- 멱등: information_schema.columns 로 컬럼 존재 여부를 검사한 뒤 DROP.
--       이미 DROP 된 상태에서 재실행해도 에러 없음.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'roles'
          AND column_name = 'managed_building_id'
    ) THEN
        ALTER TABLE roles DROP COLUMN managed_building_id;
    END IF;
END $$;
