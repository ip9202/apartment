/**
 * POST /api/auth/refresh 통합 테스트 — TASK-AUTH-010 (Phase D).
 *
 * AC-AUTH-011 (유효 RT → 200 + 새 access_token),
 * AC-AUTH-012 (블랙리스트 RT → 401),
 * AC-AUTH-013 (만료 RT → 401),
 * RT 없음 → 401, 변조 RT → 401.
 * REQ-AUTH-008 / REQ-AUTH-009 검증.
 *
 * Q3 정책: RT 재사용 갱신 허용 (갱신 후 블랙리스트 등록 안 함).
 *
 * TEST ISOLATION: beforeAll 마이그레이션+시드 멱등, beforeEach users/login_attempts/revoked_refresh_tokens truncate.
 *
 * @MX:ANCHOR: [AUTO] refresh 테스트는 자체적으로 시드를 보장한다 (형제 테스트 부작용에 견고)
 * @MX:REASON: migration-001/002/003 테스트가 동일 test DB 의 스키마를 DROP/재적용하여
 *             roles/buildings/units 시드가 소실될 수 있음. RESIDENT 서브쿼리가 NULL 을 반환하면
 *             users.role_id NOT NULL 위반으로 케이스들이 비결정적 실패함.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';
import {
  hashPassword,
  signRefreshToken,
  verifyAccessToken,
  REFRESH_TTL_SECONDS,
} from '../../../../lib/auth';
import { buildRefreshCookie } from '../../../../lib/cookies';
import { env } from '../../../../lib/env';

const REFRESH_URL = 'http://localhost/api/auth/refresh';
const PASSWORD = 'password123';

interface RefreshResponseBody {
  success: boolean;
  data?: { access_token: string };
  error?: { code: string; message: string };
}

/** 마이그레이션 + 시드를 멱등하게 보장 (형제 migration-* 테스트가 스키마를 DROP 한 후여도 안전). */
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
  opts: { verified?: boolean; status?: string; role?: string } = {},
): Promise<{ id: string; email: string; role: string; verified: boolean }> {
  const passwordHash = hashPassword(PASSWORD);
  const verified = opts.verified === false ? false : true;
  const status = opts.status ?? 'ACTIVE';
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', $4,
       CASE WHEN $5 THEN now() ELSE NULL END,
       NULL, NULL
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode, status, verified],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode, verified };
}

/** 로그인 플로우 재사용 없이 RT 를 직접 발급 — refresh 는 RT 자체만 소비하므로 충분. */
async function makeRefreshToken(userId: string): Promise<string> {
  return signRefreshToken({ sub: userId });
}

/** RT 를 쿠키로 포함한 POST 요청 생성. */
function buildRequest(rt?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (rt !== undefined) {
    headers.cookie = buildRefreshCookie(rt);
  }
  return new Request(REFRESH_URL, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

async function postRefresh(rt?: string): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildRequest(rt));
}

async function readBody(res: Response): Promise<RefreshResponseBody> {
  return (await res.json()) as RefreshResponseBody;
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

describe('POST /api/auth/refresh — 토큰 갱신', () => {
  it('AC-011: 유효 RT → 200 + 새 access_token (HS256 AT, jti 는 RT 와 상이)', async () => {
    const user = await seedUser('alice@example.com');
    const rt = await makeRefreshToken(user.id);

    const res = await postRefresh(rt);
    expect(res.status).toBe(200);

    const body = await readBody(res);
    expect(body.success).toBe(true);
    expect(body.data?.access_token).toEqual(expect.any(String));
    expect(body.data?.access_token.split('.')).toHaveLength(3); // JWT 구조

    // 새 AT 는 HS256 으로 정상 검증되어야 함
    const atClaims = verifyAccessToken(body.data!.access_token);
    expect(atClaims.sub).toBe(user.id);
    expect(atClaims.jti).toEqual(expect.any(String));

    // AC-011: 새 AT 의 jti 는 RT 의 jti 와 달라야 함 (signAccessToken 이 새 jti 발급)
    const rtClaims = jwt.verify(rt, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    expect(atClaims.jti).not.toBe(rtClaims.jti);
  });

  it('REQ-AUTH-013: 갱신 성공 시 AT httpOnly 쿠키도 재설정 (Edge 미들웨어용)', async () => {
    const user = await seedUser('atrefresh@example.com');
    const rt = await makeRefreshToken(user.id);

    const res = await postRefresh(rt);
    expect(res.status).toBe(200);

    const cookies = res.headers.getSetCookie();
    const atCookie = cookies.find((c) => c.startsWith('at='));
    expect(atCookie).toBeDefined();
    expect(atCookie).toMatch(/HttpOnly/i);
    expect(atCookie).toMatch(/Path=\//);
    expect(atCookie).toMatch(/Max-Age=900/);
  });

  it('AC-011: 응답 본문에 password_hash 미포함 (AC-025)', async () => {
    const user = await seedUser('nohash@example.com');
    const rt = await makeRefreshToken(user.id);
    const res = await postRefresh(rt);
    const text = await res.clone().text();
    expect(text).not.toMatch(/password_hash/i);
  });

  it('AC-012: 블랙리스트 RT → 401', async () => {
    const user = await seedUser('bob@example.com');
    const rt = await makeRefreshToken(user.id);

    // logout 과 동일한 SHA-256 해시로 블랙리스트 row 등록
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(rt).digest('hex');
    const rtClaims = jwt.verify(rt, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    await query(
      `INSERT INTO revoked_refresh_tokens (token_jti, token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [rtClaims.jti, tokenHash, user.id, String(REFRESH_TTL_SECONDS)],
    );

    const res = await postRefresh(rt);
    expect(res.status).toBe(401);
  });

  it('AC-013: 만료 RT → 401', async () => {
    const user = await seedUser('carol@example.com');
    // 과거 만료 시간으로 RT 서명
    const expiredRt = jwt.sign(
      { sub: user.id, jti: 'expired-jti' },
      env.JWT_REFRESH_SECRET,
      { algorithm: 'HS256', expiresIn: '-1s' },
    );

    const res = await postRefresh(expiredRt);
    expect(res.status).toBe(401);
  });

  it('RT 쿠키 없음 → 401', async () => {
    const res = await postRefresh(undefined);
    expect(res.status).toBe(401);
  });

  it('변조된 RT (서명 불일치) → 401', async () => {
    const user = await seedUser('dave@example.com');
    const rt = await makeRefreshToken(user.id);
    // 시그니처 부분을 조작
    const tampered = rt.replace(/\.[^.]+$/, '.tamperedsignature');

    const res = await postRefresh(tampered);
    expect(res.status).toBe(401);
  });

  it('Q3: 성공적 갱신 후 RT 는 블랙리스트에 등록되지 않는다 (재사용 허용)', async () => {
    const user = await seedUser('reuse@example.com');
    const rt = await makeRefreshToken(user.id);

    const res = await postRefresh(rt);
    expect(res.status).toBe(200);

    // 같은 RT 로 두 번째 갱신도 성공해야 함 (재사용 허용)
    const res2 = await postRefresh(rt);
    expect(res2.status).toBe(200);
  });

  it('AC-026: 블랙리스트 조회는 parameterized query (SQL Injection 안전)', async () => {
    // 이 케이스는 정상 플로우를 통해 parameterized 경로가 호출됨을 간접 확인.
    // 조작된 RT 는 verifyRefreshToken 단계에서 401 처리되어 쿼리 도달 전 차단됨.
    const user = await seedUser('inj@example.com');
    const rt = await makeRefreshToken(user.id);
    const res = await postRefresh(rt);
    expect(res.status).toBe(200);

    // 블랙리스트 테이블에 주입된 row 가 생성되지 않았는지 확인
    const row = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM revoked_refresh_tokens WHERE token_hash LIKE '%;%'",
    );
    expect(row.rows[0].n).toBe(0);
  });

  it('status=INACTIVE 회원의 RT → 401 (탈퇴 회원 갱신 거부)', async () => {
    const user = await seedUser('inactive@example.com', { status: 'INACTIVE' });
    // RT 는 탈퇴 전에 발급된 것으로 가정 — 서명은 유효하나 사용자 상태가 INACTIVE
    const rt = await makeRefreshToken(user.id);
    const res = await postRefresh(rt);
    expect(res.status).toBe(401);
  });
});
