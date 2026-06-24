/**
 * 마이그레이션 010 — attachments (SPEC-ATTACHMENT-001 M-ATT)
 *
 * REQ-ATT-029 / AC-ATT-001 (스키마) / AC-ATT-002 (인덱스) / AC-ATT-003 (멱등성)
 *
 * attachments: 다형성(target_type/target_id) + uploader_id FK(users) +
 *              size_bytes CHECK(<= 10485760) + sha256 CHAR(64) NOT NULL.
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
  // attachments 역의존성 순서로 DROP 후 001→010 순차 적용
  await pool.query('DROP TABLE IF EXISTS attachments CASCADE');
  await dropAllAuthTables(pool);
  for (const f of [
    '001_init_users_buildings_units_roles.sql',
    '002_revoked_refresh_tokens.sql',
    '003_login_attempts.sql',
    '004_suggestions_minimal.sql',
    '005_managed_building_unify.sql',
    '006_notices.sql',
    '007_suggestions_expand.sql',
    '008_parking.sql',
    '009_password_reset_tokens.sql',
    '010_attachments.sql',
  ]) {
    await applySql(pool, readMigration(f));
  }
  // roles seed (migration 001 은 roles 행을 시드하지 않음 — runSeed 가 담당하지만
  // 본 마이그레이션 단위 테스트는 CHECK 제약 검증용 1행만 직접 삽입)
  await pool.query(
    `INSERT INTO roles (id, code, name) VALUES ('11111111-1111-1111-1111-111111111111', 'RESIDENT', '입주민')
     ON CONFLICT DO NOTHING`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 010 — attachments 테이블 스키마 (SPEC-ATTACHMENT-001 M-ATT, REQ-ATT-029)', () => {
  it('attachments 컬럼이 SPEC §7 DDL 준거 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'attachments', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'attachments', column: 'target_type', dataType: 'character varying', isNullable: false },
      { table: 'attachments', column: 'target_id', dataType: 'uuid', isNullable: false },
      { table: 'attachments', column: 'uploader_id', dataType: 'uuid', isNullable: false },
      { table: 'attachments', column: 'original_filename', dataType: 'character varying', isNullable: false },
      { table: 'attachments', column: 'mime_type', dataType: 'character varying', isNullable: false },
      { table: 'attachments', column: 'size_bytes', dataType: 'bigint', isNullable: false },
      { table: 'attachments', column: 'storage_path', dataType: 'text', isNullable: false },
      { table: 'attachments', column: 'sha256', dataType: 'character', isNullable: false },
      { table: 'attachments', column: 'created_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('attachments.uploader_id → users FK 존재 (REQ-ATT-028 호환성)', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='attachments'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='uploader_id' AND ccu.table_name='users'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('target_type CHECK 제약은 NOTICE/SUGGEST 만 허용', async () => {
    // NOTICE/SUGGEST 삽입 성공
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, provider, status)
       VALUES ('chk-att@example.com', 'x', (SELECT id FROM roles WHERE code='RESIDENT'), 'email', 'ACTIVE')
       RETURNING id`,
    );
    const uid = userRes.rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
         VALUES ('NOTICE', $1, $2, 'a.png', 'image/png', 10, '/tmp/a', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')`,
        ['00000000-0000-0000-0000-000000000001', uid],
      ),
    ).resolves.toBeDefined();
    // PARKING 는 거부 (CHECK 위반)
    await expect(
      pool.query(
        `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
         VALUES ('PARKING', $1, $2, 'a.png', 'image/png', 10, '/tmp/b', 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy')`,
        ['00000000-0000-0000-0000-000000000002', uid],
      ),
    ).rejects.toThrow();
    await pool.query('DELETE FROM attachments WHERE uploader_id = $1', [uid]);
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  });

  it('size_bytes CHECK 제약: 0/음수/10MB+1 거부, 1~10485760 허용', async () => {
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, provider, status)
       VALUES ('size-att@example.com', 'x', (SELECT id FROM roles WHERE code='RESIDENT'), 'email', 'ACTIVE')
       RETURNING id`,
    );
    const uid = userRes.rows[0].id;
    const insert = (target: string, targetId: string, size: number) =>
      pool.query(
        `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
         VALUES ($1, $2, $3, 'a.png', 'image/png', $4, '/tmp/s', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')`,
        [target, targetId, uid, size],
      );

    // 1 byte 허용
    await expect(insert('NOTICE', '00000000-0000-0000-0000-000000000001', 1)).resolves.toBeDefined();
    // 10MB 정확히 허용
    await expect(insert('SUGGEST', '00000000-0000-0000-0000-000000000002', 10485760)).resolves.toBeDefined();
    // 0 거부
    await expect(insert('NOTICE', '00000000-0000-0000-0000-000000000003', 0)).rejects.toThrow();
    // 음수 거부
    await expect(insert('NOTICE', '00000000-0000-0000-0000-000000000004', -1)).rejects.toThrow();
    // 10MB + 1 거부
    await expect(insert('NOTICE', '00000000-0000-0000-0000-000000000005', 10485761)).rejects.toThrow();

    await pool.query('DELETE FROM attachments WHERE uploader_id = $1', [uid]);
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  });
});

describe('마이그레이션 010 — 인덱스 (REQ-ATT-029)', () => {
  it('idx_attachments_target (target_type, target_id) 복합 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_attachments_target')).toBe(true);
  });

  it('idx_attachments_uploader_id 인덱스 존재 (AUTH deactivate cascade)', async () => {
    expect(await indexExists(pool, 'idx_attachments_uploader_id')).toBe(true);
  });
});

describe('마이그레이션 010 — 멱등성', () => {
  it('재적용 시 에러 없음', async () => {
    await expect(
      applySql(pool, readMigration('010_attachments.sql')),
    ).resolves.toBeUndefined();
  });
});
