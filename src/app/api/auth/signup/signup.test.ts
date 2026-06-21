/**
 * POST /api/auth/signup 통합 테스트 — TASK-AUTH-006.
 *
 * AC-AUTH-001 / 002 / 003 / 004 / 025 / 026 검증.
 * TEST_DATABASE_URL 로 라우팅 (vitest.setup.ts). 각 케이스 beforeEach 에서 users truncate.
 * password_hash 노출 금지(AC-025), SQL Injection 안전성(AC-026) 단정.
 *
 * @MX:ANCHOR: [AUTO] signup 테스트는 자체적으로 시드를 보장한다 (형제 테스트 부작용에 견고)
 * @MX:REASON: migration-001/002/003 테스트가 동일 test DB 의 스키마를 DROP/재적용하여
 *             roles/buildings/units 시드가 소실될 수 있음. RESIDENT 서브쿼리가 NULL 을 반환하면
 *             users.role_id NOT NULL 위반으로 5개 케이스가 비결정적 실패함 (TASK-AUTH-006 flake).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';

const SIGNUP_URL = 'http://localhost/api/auth/signup';

function makeBody(email: string, password: string, passwordConfirm = password) {
  return { email, password, password_confirm: passwordConfirm };
}

async function postSignup(body: unknown) {
  const request = new Request(SIGNUP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Next.js route handler 는 동적 import 로 POST 심볼을 호출.
  const mod = await import('./route');
  return mod.POST(request);
}

/**
 * 마이그레이션 + 시드를 멱등하게 보장.
 * 형제 migration-* 테스트가 스키마를 DROP 한 후여도 안전하도록 beforeAll 에서 재적용.
 * CREATE TABLE ... IF NOT EXISTS / ON CONFLICT DO NOTHING 으로 재실행 안전.
 */
async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  // RESIDENT 역할 ID 등 시드 데이터는 유지하되, 가입된 회원만 매 케이스마다 초기화.
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/signup — 회원가입', () => {
  it('AC-001: 정상 가입 → 201 + {role:"RESIDENT", verified:false}, DB verified_at IS NULL', async () => {
    const res = await postSignup(makeBody('alice@example.com', 'password123'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      role: 'RESIDENT',
      verified: false,
    });

    const row = await query(
      'SELECT email, verified_at, role_id FROM users WHERE email = $1',
      ['alice@example.com'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].verified_at).toBeNull();
  });

  it('AC-002: 이메일 중복 → 409, 신규 row 미생성', async () => {
    await postSignup(makeBody('bob@example.com', 'password123'));
    const before = await query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1', [
      'bob@example.com',
    ]);

    const res = await postSignup(makeBody('bob@example.com', 'another456'));

    expect(res.status).toBe(409);
    const after = await query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1', [
      'bob@example.com',
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('AC-003: 비밀번호 8자 미만 → 422', async () => {
    const res = await postSignup(makeBody('short@example.com', 'ab1'));
    expect(res.status).toBe(422);
  });

  it('AC-003: 비밀번호에 숫자 누락 → 422', async () => {
    const res = await postSignup(makeBody('noDigits@example.com', 'abcdefgh'));
    expect(res.status).toBe(422);
  });

  it('AC-003: password_confirm 불일치 → 422', async () => {
    const res = await postSignup(
      makeBody('mismatch@example.com', 'password123', 'password999'),
    );
    expect(res.status).toBe(422);
  });

  it('AC-025: 응답 본문에 password_hash 필드가 없다', async () => {
    const res = await postSignup(makeBody('hashless@example.com', 'password123'));
    const text = await res.clone().text();
    expect(text).not.toMatch(/password_hash/i);
  });

  it('AC-004: DB password_hash 는 bcrypt($2[aby]$12$) 형식이며 평문이 아니다', async () => {
    await postSignup(makeBody('bcryptcheck@example.com', 'password123'));
    const row = await query(
      'SELECT password_hash FROM users WHERE email=$1',
      ['bcryptcheck@example.com'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.rows[0].password_hash).not.toBe('password123');
  });

  it('AC-026: SQL Injection 페이로드 → 422/409, DB 무결성 유지 (parameterized)', async () => {
    const payload = makeBody("a@b.com' OR '1'='1", 'password123');
    const res = await postSignup(payload);

    // 422(형식 오류) 또는 409(정상 중복) 중 하나. 절대 500 이면 안 됨.
    expect([422, 409]).toContain(res.status);

    // 주입된 이메일로 실제 row 가 생성되지 않았는지 확인.
    const row = await query("SELECT COUNT(*)::int AS n FROM users WHERE email = $1", [
      "a@b.com' OR '1'='1",
    ]);
    expect(row.rows[0].n).toBe(0);
  });

  it('이메일 대소문자 정규화: USER@X.com == user@x.com → 두 번째 409', async () => {
    const first = await postSignup(makeBody('USER@X.com', 'password123'));
    expect(first.status).toBe(201);

    const second = await postSignup(makeBody('user@x.com', 'another456'));
    expect(second.status).toBe(409);
  });

  it('잘못된 이메일 형식 → 422', async () => {
    const res = await postSignup(makeBody('not-an-email', 'password123'));
    expect(res.status).toBe(422);
  });

  it('JSON 본문이 아닌 경우 → 422', async () => {
    const request = new Request(SIGNUP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const mod = await import('./route');
    const res = await mod.POST(request);
    expect(res.status).toBe(422);
  });
});
