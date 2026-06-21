/**
 * POST /api/auth/logout 통합 테스트 — TASK-AUTH-009.
 *
 * AC-AUTH-010 (200 + revoked_refresh_tokens row + 쿠키 Max-Age=0),
 * REQ-AUTH-007 (RT 블랙리스트 등록 + 쿠키 만료).
 * 인증 필요(401 if no/invalid AT), 멱등(no RT → still 200).
 *
 * TEST ISOLATION: beforeAll 마이그레이션+시드 멱등, beforeEach users/revoked truncate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../../../lib/auth';
import { createHash } from 'node:crypto';

const LOGOUT_URL = 'http://localhost/api/auth/logout';
const PASSWORD = 'password123';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
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
  email = 'alice@example.com',
  verified = true,
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = 'RESIDENT'),
       'email', 'ACTIVE',
       CASE WHEN $3 THEN now() ELSE NULL END,
       NULL, NULL
     )
     RETURNING id`,
    [email, passwordHash, verified],
  );
  return { id: res.rows[0].id, email, role: 'RESIDENT' };
}

async function postLogout(opts: {
  accessToken?: string;
  refreshToken?: string;
}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.accessToken) {
    headers.authorization = `Bearer ${opts.accessToken}`;
  }
  const cookies: string[] = [];
  if (opts.refreshToken) {
    cookies.push(`rt=${opts.refreshToken}`);
  }
  if (cookies.length > 0) {
    headers.cookie = cookies.join('; ');
  }
  const request = new Request(LOGOUT_URL, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const mod = await import('./route');
  return mod.POST(request);
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/logout — 로그아웃', () => {
  it('401: Authorization 헤더 누락 → 401', async () => {
    const res = await postLogout({});
    expect(res.status).toBe(401);
  });

  it('401: 잘못된 형식의 Authorization 헤더 → 401', async () => {
    const res = await postLogout({ accessToken: 'not-a-jwt' });
    expect(res.status).toBe(401);
  });

  it('AC-010: 정상 로그아웃 → 200 + revoked_refresh_tokens row 생성 + 쿠키 Max-Age=0', async () => {
    const user = await seedUser();
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });
    const rt = signRefreshToken({ sub: user.id });

    const res = await postLogout({ accessToken: at, refreshToken: rt });

    expect(res.status).toBe(200);

    // 쿠키 만료 — Max-Age=0
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/rt=/);
    expect(setCookie).toMatch(/Max-Age=0/i);

    // AT 쿠키도 함께 만료 (REQ-AUTH-013 — Edge 미들웨어용 AT 쿠키 정리)
    const cookies = res.headers.getSetCookie();
    const atClear = cookies.find((c) => c.startsWith('at='));
    expect(atClear).toBeDefined();
    expect(atClear).toMatch(/Max-Age=0/i);

    // 블랙리스트 row 생성 확인
    const rtClaims = verifyRefreshToken(rt);
    const rtHash = sha256(rt);
    const row = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM revoked_refresh_tokens
       WHERE token_jti = $1 AND token_hash = $2 AND user_id = $3`,
      [rtClaims.jti, rtHash, user.id],
    );
    expect(row.rows[0].n).toBe(1);
  });

  it('AC-010: 블랙리스트 row 의 expires_at 이 RT 만료 시점과 일치 (7일)', async () => {
    const user = await seedUser('expiry@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });
    const rt = signRefreshToken({ sub: user.id });

    await postLogout({ accessToken: at, refreshToken: rt });

    const rtClaims = verifyRefreshToken(rt);
    const rtHash = sha256(rt);
    const row = await query<{ expires_at: string }>(
      `SELECT expires_at FROM revoked_refresh_tokens
       WHERE token_jti = $1 AND token_hash = $2`,
      [rtClaims.jti, rtHash],
    );
    const expiresAt = new Date(row.rows[0].expires_at).getTime();
    const expectedMin = Date.now() + (7 * 24 * 60 * 60 - 60) * 1000;
    const expectedMax = Date.now() + (7 * 24 * 60 * 60 + 60) * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it('멱등: RT 쿠키 없이 요청 → 200 (AT 만 유효하면)', async () => {
    const user = await seedUser('nort@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });

    const res = await postLogout({ accessToken: at });

    expect(res.status).toBe(200);
    // 쿠키 삭제는 여전히 수행
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it('멱등: RT 쿠키 없을 때 revoked_refresh_tokens row 추가 안 함', async () => {
    const user = await seedUser('nortrow@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });

    await postLogout({ accessToken: at });

    const row = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM revoked_refresh_tokens WHERE user_id = $1`,
      [user.id],
    );
    expect(row.rows[0].n).toBe(0);
  });

  it('잘못된 RT 쿠키(서명 불일치) → 여전히 200 (에러 무시, 쿠키만 삭제)', async () => {
    const user = await seedUser('badrt@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });

    const res = await postLogout({ accessToken: at, refreshToken: 'invalid-rt-token' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('AC-025: 응답 본문에 password_hash 미포함', async () => {
    const user = await seedUser('nohash2@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });
    const rt = signRefreshToken({ sub: user.id });

    const res = await postLogout({ accessToken: at, refreshToken: rt });
    const text = await res.clone().text();
    expect(text).not.toMatch(/password_hash/i);
  });

  it('동일 RT 로 두 번째 로그아웃 → 여전히 200 (ON CONFLICT 멱등)', async () => {
    const user = await seedUser('double@example.com');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: true });
    const rt = signRefreshToken({ sub: user.id });

    const r1 = await postLogout({ accessToken: at, refreshToken: rt });
    expect(r1.status).toBe(200);

    const r2 = await postLogout({ accessToken: at, refreshToken: rt });
    expect(r2.status).toBe(200);

    // row 는 1개만 (jti UNIQUE)
    const rtClaims = verifyRefreshToken(rt);
    const rtHash = sha256(rt);
    const row = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM revoked_refresh_tokens WHERE token_jti = $1`,
      [rtClaims.jti],
    );
    expect(row.rows[0].n).toBe(1);
    void rtHash;
  });
});
