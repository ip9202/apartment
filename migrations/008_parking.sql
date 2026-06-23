-- 마이그레이션 008 — parking_rounds + parking_assignments (SPEC-PARKING-001 M5)
-- REQ-PK-001 (parking_rounds 스키마), parking_assignments 스키마
--
-- @MX:ANCHOR: [AUTO] PARKING 스키마 불변 지점 — parking_rounds/parking_assignments 테이블 정의
-- @MX:REASON:  seed_value 불변 + UNIQUE(round_id, unit_id) + status 단방향 전이는
--             slot assignment 도메인("모든 세대 1자리, 탈락자 없음")의 핵심 계약.
--             migration 007 이후 순차 적용. CREATE TABLE IF NOT EXISTS 로 멱등성 보장.
--
-- @MX:NOTE: [AUTO] slot assignment 도메인 — win/lose 추첨 아님. 회차 seed 기반 결정론적 순열로
--           unit→slot 배정. 자리풀(slot_pool)은 회차 생성 시 동적 입력(JSONB).

-- @MX:WARN: [AUTO] seed 불변 보장 — seed_value 는 회차 생성 시 한 번 설정, UPDATE 금지.
-- @MX:REASON: seed 조작 원천 차단. 투명성 공개(PARKING-07)의 공정성 기반.
--            seed 공개 후에도 사후 조작 불가(불변). 애플리케이션 계층에서 UPDATE 미구현으로 강제.
CREATE TABLE IF NOT EXISTS parking_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  application_start TIMESTAMPTZ NOT NULL,
  application_end TIMESTAMPTZ NOT NULL,
  slot_pool JSONB NOT NULL,
  seed_value TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @MX:NOTE: [AUTO] 신청/배정 분리 불필요 — 추첨=자리확정 동시 발생.
--           assignment_source DRAW(주민 추첨)/AUTO(자동배정)/ADMIN(수동, P1 별도 SPEC).
CREATE TABLE IF NOT EXISTS parking_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES parking_rounds(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  assigned_slot TEXT NOT NULL,
  assignment_source VARCHAR(10) NOT NULL,
  drawn_at TIMESTAMPTZ,
  drawn_by UUID REFERENCES users(id),
  -- @MX:WARN: [AUTO] UNIQUE(round_id, unit_id) — 세대당 1배정 불변 핵심 제약.
  -- @MX:REASON: 동시 추첨 버튼 클릭 시 두 번째 INSERT 는 unique violation → 409.
  --            slot assignment 도메인("세대당 1자리") 강제. 동일 unit_id 가구원 중복 추첨 방어.
  UNIQUE(round_id, unit_id)
);

-- @MX:NOTE: [AUTO] 회차별 assignments 조회 성능 — PARKING-06 결과 열람 인덱스.
CREATE INDEX IF NOT EXISTS idx_parking_assignments_round ON parking_assignments(round_id);
