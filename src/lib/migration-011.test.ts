/**
 * 마이그레이션 011 — 카카오 OAuth 부분 유니크 인덱스 (SPEC-AUTH-KAKAO-001, REQ-KAKAO-009).
 *
 * 검증 항목:
 *  - idx_users_provider_provider_id_unique 인덱스 존재
 *  - 멱등 재적용 (에러 없음)
 *  - provider_id NOT NULL 행에 대해 (provider, provider_id) 중복 삽입 거부 (유니크 위반)
 *  - provider_id NULL 행은 유니크 제약 제외 (여러 이메일 계정 허용)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  indexExists,
} from './migration-test-helpers';

const pool = createTestPool();

beforeAll(async () => {
  // 역의존성 순서로 DROP 후 001 → 011 순차 적용
  await dropAllAuthTables(pool);
  for (const f of [
    '001_init_users_buildings_units_roles.sql',
    '002_revoked_refresh_tokens.sql',
    '003_login_attempts.sql',
    '011_kakao_oauth.sql',
  ]) {
    await applySql(pool, readMigration(f));
  }
  // roles seed — users INSERT 의 role_id FK 충족용 1행
  await pool.query(
    `INSERT INTO roles (id, code, name) VALUES ('11111111-1111-1111-1111-111111111111', 'RESIDENT', '입주민')
     ON CONFLICT DO NOTHING`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 011 — 카카오 OAuth 부분 유니크 인덱스 (SPEC-AUTH-KAKAO-001)', () => {
  it('idx_users_provider_provider_id_unique 인덱스가 존재한다', async () => {
    expect(await indexExists(pool, 'idx_users_provider_provider_id_unique')).toBe(true);
  });

  it('재적용 시 에러 없이 멱등하다', async () => {
    await expect(applySql(pool, readMigration('011_kakao_oauth.sql'))).resolves.toBeUndefined();
    expect(await indexExists(pool, 'idx_users_provider_provider_id_unique')).toBe(true);
  });

  it('provider_id NOT NULL 행에 대해 (provider, provider_id) 중복 삽입을 거부한다 (REQ-KAKAO-009)', async () => {
    // 첫 번째 kakao 계정
    await pool.query(
      `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
       VALUES ('dup1@example.com', NULL,
               (SELECT id FROM roles WHERE code='RESIDENT'),
               'kakao', 'kakao-123', 'ACTIVE')`,
    );
    // 동일 (provider, provider_id) 다른 이메일 → 유니크 위반
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
         VALUES ('dup2@example.com', NULL,
                 (SELECT id FROM roles WHERE code='RESIDENT'),
                 'kakao', 'kakao-123', 'ACTIVE')`,
      ),
    ).rejects.toThrow();
    await pool.query("DELETE FROM users WHERE email IN ('dup1@example.com','dup2@example.com')");
  });

  it('provider_id NULL 행은 유니크 제약에서 제외된다 (여러 이메일 계정 허용)', async () => {
    // provider_id=NULL 이메일 계정 2개 → 둘 다 허용
    await pool.query(
      `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
       VALUES ('null1@example.com', 'hash1',
               (SELECT id FROM roles WHERE code='RESIDENT'),
               'email', NULL, 'ACTIVE')`,
    );
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
         VALUES ('null2@example.com', 'hash2',
                 (SELECT id FROM roles WHERE code='RESIDENT'),
                 'email', NULL, 'ACTIVE')`,
      ),
    ).resolves.toBeDefined();
    await pool.query("DELETE FROM users WHERE email IN ('null1@example.com','null2@example.com')");
  });

  it('서로 다른 provider_id 는 동시에 허용된다', async () => {
    await pool.query(
      `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
       VALUES ('diff1@example.com', NULL,
               (SELECT id FROM roles WHERE code='RESIDENT'),
               'kakao', 'kakao-aaa', 'ACTIVE')`,
    );
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status)
         VALUES ('diff2@example.com', NULL,
                 (SELECT id FROM roles WHERE code='RESIDENT'),
                 'kakao', 'kakao-bbb', 'ACTIVE')`,
      ),
    ).resolves.toBeDefined();
    await pool.query("DELETE FROM users WHERE email IN ('diff1@example.com','diff2@example.com')");
  });
});
