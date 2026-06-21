-- 마이그레이션 001: AUTH 기반 테이블 — buildings, units, roles, users
-- SPEC-AUTH-001 (research.md §2 정확 스키마)
--
-- 참고: buildings/units/roles 의 CRUD 관리는 SETUP SPEC 소관.
--       AUTH는 이 테이블을 읽기 전용으로 소비한다.
-- 멱등: IF NOT EXISTS 사용.

-- 1. buildings (동)
CREATE TABLE IF NOT EXISTS buildings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(20) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. units (호수) — UNIQUE(building_id, unit_number)
CREATE TABLE IF NOT EXISTS units (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id   UUID NOT NULL REFERENCES buildings(id),
    unit_number   VARCHAR(10) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT units_building_id_unit_number_key UNIQUE (building_id, unit_number)
);

-- 3. roles (직책)
CREATE TABLE IF NOT EXISTS roles (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  VARCHAR(20) NOT NULL UNIQUE,
    name                  VARCHAR(30) NOT NULL,
    managed_building_id   UUID NULL REFERENCES buildings(id),
    sort_order            INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. users (회원) — AUTH 핵심 테이블
-- @MX:NOTE: [AUTO] managed_building_id 는 AUTH가 추가한 컬럼 — REP 동대표 권한 위임(REQ-AUTH-011)의 근간.
--           SETUP SPEC 후속 마이그레이션에서 소유권 이관 예정.
CREATE TABLE IF NOT EXISTS users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 VARCHAR(255) NOT NULL UNIQUE,
    password_hash         VARCHAR(255) NULL,
    provider              VARCHAR(20) NOT NULL DEFAULT 'email',
    provider_id           VARCHAR(255) NULL,
    role_id               UUID NOT NULL REFERENCES roles(id),
    unit_id               UUID NULL REFERENCES units(id),
    managed_building_id   UUID NULL REFERENCES buildings(id),
    status                VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    verified_at           TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_unit_id     ON users(unit_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id     ON users(role_id);
