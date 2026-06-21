/**
 * POST /api/auth/login 통합 테스트 — TASK-AUTH-008.
 *
 * AC-AUTH-005 (200 + access_token + RT 쿠키), AC-AUTH-006 (not-found/wrong 동일 401),
 * AC-AUTH-007 (미인증 200 + verified:false), AC-AUTH-008 (5회 잠금 → 429),
 * AC-AUTH-009 (잠금 해제 후 복귀 → 200 + count 초기화), AC-AUTH-026 (injection safe).
 * REQ-AUTH-004/005/006 검증.
 *
 * TEST ISOLATION: beforeAll 마이그레이션+시드 멱등, beforeEach users/login_attempts/truncate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';
import { hashPassword } from '../../../../lib/auth';

const LOGIN_URL = 'http://localhost/api/auth/login';
const PASSWORD = 'password123';

interface LoginResponseBody {
  success: boolean;
  data?: {
    access_token: string;
    user: {
      id: string;
      email: string;
      role: string;
      verified: boolean;
    };
  };
  error?: { code: string; message: string };
}

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

/** 테스트용 사용자를 DB에 직접 INSERT. */
async function seedUser(
  email: string,
  opts: { password?: string; verified?: boolean; status?: string; role?: string } = {},
): Promise<string> {
  const passwordHash = hashPassword(opts.password ?? PASSWORD);
  const verified = opts.verified === false ? false : true;
  const status = opts.status ?? 'ACTIVE';
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', $4,
       CASE WHEN $5 THEN now() ELSE NULL END,
       NULL, NULL
     )
     RETURNING id`,
    [email, passwordHash, roleCode, status, verified],
  );
  return res.rows[0].id;
}

async function postLogin(body: unknown): Promise<Response> {
  const request = new Request(LOGIN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const mod = await import('./route');
  return mod.POST(request);
}

async function readBody(res: Response): Promise<LoginResponseBody> {
  return (await res.json()) as LoginResponseBody;
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/login — 로그인', () => {
  it('AC-005: 정상 로그인 → 200 + access_token 본문 + RT httpOnly 쿠키', async () => {
    await seedUser('alice@example.com');
    const res = await postLogin({ email: 'alice@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.success).toBe(true);
    expect(body.data?.access_token).toEqual(expect.any(String));
    expect(body.data?.access_token.split('.')).toHaveLength(3); // JWT 구조
    expect(body.data?.user.email).toBe('alice@example.com');
    expect(body.data?.user.role).toBe('RESIDENT');
    expect(body.data?.user.verified).toBe(true);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toMatch(/rt=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/);
  });

  it('REQ-AUTH-013: 로그인 성공 시 AT httpOnly 쿠키도 설정 (Edge 미들웨어용)', async () => {
    await seedUser('atcookie@example.com');
    const res = await postLogin({ email: 'atcookie@example.com', password: PASSWORD });
    expect(res.status).toBe(200);

    // getSetCookie() 로 개별 Set-Cookie 헤더 배열 확인 (NextResponse 가 append 한 두 값)
    const cookies = res.headers.getSetCookie();
    const atCookie = cookies.find((c) => c.startsWith('at='));
    expect(atCookie).toBeDefined();
    expect(atCookie).toMatch(/HttpOnly/i);
    expect(atCookie).toMatch(/SameSite=Strict/i);
    expect(atCookie).toMatch(/Path=\//);
    expect(atCookie).toMatch(/Max-Age=900/);

    // RT 쿠키도 여전히 설정됨
    const rtCookie = cookies.find((c) => c.startsWith('rt='));
    expect(rtCookie).toBeDefined();
  });

  it('AC-025: 응답 본문에 password_hash 미포함', async () => {
    await seedUser('nohash@example.com');
    const res = await postLogin({ email: 'nohash@example.com', password: PASSWORD });
    const text = await res.clone().text();
    expect(text).not.toMatch(/password_hash/i);
  });

  it('AC-006: 존재하지 않는 이메일 → 401 + 통일된 메시지', async () => {
    const res = await postLogin({ email: 'ghost@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    const body = await readBody(res);
    expect(body.error?.message).toBe('이메일 또는 비밀번호가 올바르지 않습니다');
  });

  it('AC-006: 비밀번호 불일치 → 동일한 401 메시지 (사용자 열거 방지)', async () => {
    await seedUser('bob@example.com');
    const res = await postLogin({ email: 'bob@example.com', password: 'wrongpass1' });
    expect(res.status).toBe(401);
    const body = await readBody(res);
    expect(body.error?.message).toBe('이메일 또는 비밀번호가 올바르지 않습니다');
  });

  it('AC-006: not-found 와 wrong-password 메시지가 완전히 동일하다', async () => {
    await seedUser('samemsg@example.com');
    const r1 = await postLogin({ email: 'nonexistent@example.com', password: PASSWORD });
    const r2 = await postLogin({ email: 'samemsg@example.com', password: 'wrongpass1' });
    const b1 = await readBody(r1);
    const b2 = await readBody(r2);
    expect(b1.error?.message).toBe(b2.error?.message);
    expect(b1.error?.code).toBe(b2.error?.code);
  });

  it('AC-007: 미인증(verified=false) 회원 로그인 → 200 + verified:false', async () => {
    await seedUser('unverified@example.com', { verified: false });
    const res = await postLogin({ email: 'unverified@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.data?.user.verified).toBe(false);
  });

  it('이메일 대소문자 정규화: USER@X.com 로그인 가능', async () => {
    await seedUser('user@x.com');
    const res = await postLogin({ email: 'USER@X.com', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('잘못된 이메일 형식 → 422', async () => {
    const res = await postLogin({ email: 'not-an-email', password: PASSWORD });
    expect(res.status).toBe(422);
  });

  it('JSON 본문이 아닌 경우 → 422', async () => {
    const request = new Request(LOGIN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const mod = await import('./route');
    const res = await mod.POST(request);
    expect(res.status).toBe(422);
  });

  it('AC-008: 5회 연속 실패 → 6번째 시도 429 + Retry-After 헤더', async () => {
    await seedUser('locked@example.com');
    for (let i = 0; i < 5; i++) {
      const r = await postLogin({ email: 'locked@example.com', password: 'wrongpass1' });
      expect(r.status).toBe(401);
    }
    // 6번째 (잠금 활성 후)
    const res = await postLogin({ email: 'locked@example.com', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('AC-008: 잠금 후 login_attempts.locked_until 설정됨', async () => {
    await seedUser('locked2@example.com');
    for (let i = 0; i < 5; i++) {
      await postLogin({ email: 'locked2@example.com', password: 'wrongpass1' });
    }
    const row = await query<{ locked_until: string | null }>(
      'SELECT locked_until FROM login_attempts WHERE email = $1',
      ['locked2@example.com'],
    );
    expect(row.rows[0].locked_until).not.toBeNull();
  });

  it('AC-009: 잠금 만료 후 올바른 비밀번호 → 200 + failed_count 0으로 초기화', async () => {
    await seedUser('recover@example.com');
    for (let i = 0; i < 5; i++) {
      await postLogin({ email: 'recover@example.com', password: 'wrongpass1' });
    }
    // 잠금을 과거로 되감아 만료 시뮬레이션
    await query(
      `UPDATE login_attempts SET locked_until = now() - interval '1 minute' WHERE email = $1`,
      ['recover@example.com'],
    );

    const res = await postLogin({ email: 'recover@example.com', password: PASSWORD });
    expect(res.status).toBe(200);

    const row = await query<{ failed_count: number; locked_until: string | null }>(
      'SELECT failed_count, locked_until FROM login_attempts WHERE email = $1',
      ['recover@example.com'],
    );
    expect(row.rows[0].failed_count).toBe(0);
    expect(row.rows[0].locked_until).toBeNull();
  });

  it('잠금 중 올바른 비밀번호여도 → 429 (잠금 우회 불가)', async () => {
    await seedUser('stilllocked@example.com');
    for (let i = 0; i < 5; i++) {
      await postLogin({ email: 'stilllocked@example.com', password: 'wrongpass1' });
    }
    const res = await postLogin({ email: 'stilllocked@example.com', password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('성공 로그인 시 login_attempts.failed_count 가 0으로 초기화', async () => {
    await seedUser('reset@example.com');
    // 2회 실패 후 성공
    await postLogin({ email: 'reset@example.com', password: 'wrongpass1' });
    await postLogin({ email: 'reset@example.com', password: 'wrongpass1' });
    const res = await postLogin({ email: 'reset@example.com', password: PASSWORD });
    expect(res.status).toBe(200);

    const row = await query<{ failed_count: number }>(
      'SELECT failed_count FROM login_attempts WHERE email = $1',
      ['reset@example.com'],
    );
    expect(row.rows[0].failed_count).toBe(0);
  });

  it('status=INACTIVE 회원 로그인 → 401', async () => {
    await seedUser('inactive@example.com', { status: 'INACTIVE' });
    const res = await postLogin({ email: 'inactive@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('AC-026: SQL Injection 페이로드 이메일 → 422 또는 401, DB 무변조', async () => {
    const payload = "x@y.com' OR '1'='1";
    const res = await postLogin({ email: payload, password: PASSWORD });
    expect([422, 401]).toContain(res.status);

    // 주입된 값으로 실제 사용자 row 가 생성되지 않았는지 확인
    const row = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM users WHERE email = $1",
      [payload],
    );
    expect(row.rows[0].n).toBe(0);
  });
});
