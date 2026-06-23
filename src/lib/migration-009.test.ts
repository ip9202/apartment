/**
 * 마이그레이션 009 — password_reset_tokens (SPEC-AUTH-RESET-001, REQ-RESET-001/004/005/008).
 *
 * 스키마 단정: id(UUID PK), user_id(FK), token_hash(SHA-256), expires_at, used_at(nullable),
 * created_at. FK user_id→users, 인덱스(token_hash, user_id, expires_at), 멱등성.
 *
 * @MX:ANCHOR: [AUTO] AUTH-05 스키마 불변 지점 — 토큰 해시/만료/일회용 스키마 회귀 방어
 * @MX:REASON:  token_hash UNIQUE + expires_at + used_at 는 비밀번호 재설정 보안 계약의 근간.
 *              회귀 시 토큰 재사용/만료 우회 공격 허용.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  assertColumnsExist,
  indexExists,
} from './migration-test-helpers';

const pool = createTestPool();

beforeAll(async () => {
  // 신규 테이블 로컬 DROP
  await pool.query('DROP TABLE IF EXISTS password_reset_tokens CASCADE');
  // AUTH 도메인 전체 정리 후 001→009 순차 적용
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await applySql(pool, readMigration('009_password_reset_tokens.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 009 — password_reset_tokens 컬럼', () => {
  it('6개 컬럼 모두 존재', async () => {
    await assertColumnsExist(pool, [
      { table: 'password_reset_tokens', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'password_reset_tokens', column: 'user_id', dataType: 'uuid', isNullable: false },
      { table: 'password_reset_tokens', column: 'token_hash', dataType: 'character varying', isNullable: false },
      { table: 'password_reset_tokens', column: 'expires_at', dataType: 'timestamp with time zone', isNullable: false },
      { table: 'password_reset_tokens', column: 'used_at', dataType: 'timestamp with time zone', isNullable: true },
      { table: 'password_reset_tokens', column: 'created_at', dataType: 'timestamp with time zone', isNullable: false },
    ]);
  });

  it('created_at 기본값 now()', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='password_reset_tokens' AND column_name='created_at'`,
    );
    const def = (res.rows[0] as { column_default: string }).column_default;
    expect(def).toMatch(/now\(\)/);
  });

  it('used_at 은 기본 NULL (일회용 미사용 상태)', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='password_reset_tokens' AND column_name='used_at'`,
    );
    expect((res.rows[0] as { column_default: string | null }).column_default).toBeNull();
  });
});

describe('마이그레이션 009 — 제약/인덱스', () => {
  it('user_id → users FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='password_reset_tokens'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='user_id' AND ccu.table_name='users'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('token_hash 인덱스 존재 (해시 조회 가속)', async () => {
    expect(await indexExists(pool, 'idx_password_reset_tokens_token_hash')).toBe(true);
  });

  it('user_id 인덱스 존재 (사용자별 토큰 조회)', async () => {
    expect(await indexExists(pool, 'idx_password_reset_tokens_user_id')).toBe(true);
  });

  it('expires_at 인덱스 존재 (정기 정리용)', async () => {
    expect(await indexExists(pool, 'idx_password_reset_tokens_expires_at')).toBe(true);
  });
});

describe('마이그레이션 009 — 동작 검증', () => {
  it('유효 user_id 로 토큰 레코드 INSERT 성공', async () => {
    // 테스트용 role + user 준비 (roles 시드 미실행 환경 대비 자체 INSERT)
    await pool.query(
      `INSERT INTO roles (code, name) VALUES ('RST', '테스트직책')
       ON CONFLICT (code) DO NOTHING`,
    );
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, provider, status)
       SELECT 'rst-test@example.com', 'hash', r.id, 'email', 'ACTIVE' FROM roles r WHERE r.code='RST'
       RETURNING id`,
    );
    const userId = userRes.rows[0].id;

    const insertRes = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, 'sha256dummy', now() + interval '30 minutes')`,
      [userId],
    );
    expect(insertRes.rowCount).toBe(1);

    // 정리
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query("DELETE FROM roles WHERE code = 'RST'");
  });

  it('존재하지 않는 user_id INSERT → FK 위반 에러', async () => {
    await expect(
      pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ('00000000-0000-0000-0000-000000000000', 'x', now() + interval '30 minutes')`,
      ),
    ).rejects.toThrow();
  });

  it('멱등: 재적용 시 에러 없음', async () => {
    await expect(
      applySql(pool, readMigration('009_password_reset_tokens.sql')),
    ).resolves.toBeUndefined();
  });
});
