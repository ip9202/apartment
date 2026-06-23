/**
 * POST /api/auth/password/reset/request 통합 테스트 — SPEC-AUTH-RESET-001.
 *
 * REQ-RESET-001 (토큰 생성 + 이메일 발송), REQ-RESET-002 (사용자 열거 방지),
 * REQ-RESET-003 (10분당 3회 Rate Limit).
 *
 * TEST ISOLATION: beforeAll 마이그레이션+시드 멱등, beforeEach 테이블 truncate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashToken } from '../../../../../../lib/password-reset';
import { hashPassword } from '../../../../../../lib/auth';
import type { MailTransport } from '../../../../../../lib/email';
import { resetRateLimiter } from './rate-limiter-instance';

const URL = 'http://localhost/api/auth/password/reset/request';
const PASSWORD = 'OldPass123!';

interface ResponseBody {
  success: boolean;
  data?: { message: string };
  error?: { code: string; message: string };
}

async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
      '009_password_reset_tokens.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

async function seedUser(email: string): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code='RESIDENT'), 'email', 'ACTIVE', now())
     RETURNING id`,
    [email, hashPassword(PASSWORD)],
  );
  return res.rows[0].id;
}

async function postRequest(body: unknown, ip = '127.0.0.1'): Promise<Response> {
  // 주의: vi.resetModules() 사용 금지 — rate-limiter-instance 싱글턴 상태가 초기화되어
  // REQ-RESET-003 (10분당 3회) 검증이 불가해진다. route 모듈 자체는 무상태이므로
  // 재임포트할 필요 없다.
  const mod = await import('./route');
  const req = new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

async function readBody(res: Response): Promise<ResponseBody> {
  return (await res.json()) as ResponseBody;
}

/** 가짜 메일 전송기 — 발송 호출 캡처. route 가 createSmtpTransport 대신 이것을 쓰도록
 *  환경변수/모킹은 복잡하므로, route 는 process.env.NODE_ENV !== production 일 때
 *  console 폴백을 쓴다. 발송 검증은 password_reset_tokens INSERT 로 대신한다. */
function noopTransport(): MailTransport {
  return { async send(): Promise<void> {} };
}
void noopTransport;

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  resetRateLimiter.reset();
  await query('DELETE FROM password_reset_tokens');
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM password_reset_tokens');
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/password/reset/request — 재설정 요청 (REQ-RESET-001/002/003)', () => {
  it('REQ-RESET-001: 가입된 이메일 → 200 + 성공 메시지 + 토큰 레코드 생성', async () => {
    await seedUser('alice@example.com');
    const res = await postRequest({ email: 'alice@example.com' });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.success).toBe(true);
    expect(body.data?.message).toContain('이메일');

    // DB 에 토큰 해시 저장되었는지 확인
    const tokens = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM password_reset_tokens',
    );
    expect(tokens.rows[0].count).toBeGreaterThanOrEqual(1);
  });

  it('REQ-RESET-001: 저장된 것은 SHA-256 해시(64자 hex) 이지 원문이 아니다', async () => {
    await seedUser('hash@example.com');
    await postRequest({ email: 'hash@example.com' });
    const res = await query<{ token_hash: string }>(
      'SELECT token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1',
    );
    const stored = res.rows[0].token_hash;
    expect(stored).toHaveLength(64);
    expect(stored).toMatch(/^[0-9a-f]+$/);
  });

  it('REQ-RESET-001: 토큰 만료는 30분 후 (±1분 허용)', async () => {
    await seedUser('exp@example.com');
    await postRequest({ email: 'exp@example.com' });
    const res = await query<{ expires_at: string }>(
      'SELECT expires_at FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1',
    );
    const expiresAt = new Date(res.rows[0].expires_at).getTime();
    const deltaMin = (expiresAt - Date.now()) / 60_000;
    expect(deltaMin).toBeGreaterThan(29);
    expect(deltaMin).toBeLessThan(31);
  });

  it('REQ-RESET-002: 가입되지 않은 이메일도 동일한 200 성공 응답 (사용자 열거 방지)', async () => {
    const r1 = await postRequest({ email: 'ghost@example.com' });
    const r2 = await postRequest({ email: 'real@example.com' }).then(async (resp) => {
      // 'real' 도 가입 안 됨 → 동일 응답
      return { status: resp.status, body: await readBody(resp) };
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = await readBody(r1);
    expect(b1.data?.message).toBe(r2.body.data?.message);
    // 가입되지 않은 이메일에 대해 토큰은 생성되지 않아야 함
    const tokens = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM password_reset_tokens',
    );
    expect(tokens.rows[0].count).toBe(0);
  });

  it('REQ-RESET-002: 응답 본문에 가입 여부 힌트 미포함', async () => {
    await seedUser('hint@example.com');
    const r1 = await postRequest({ email: 'hint@example.com' });
    const r2 = await postRequest({ email: 'nohint@example.com' });
    const t1 = await r1.clone().text();
    const t2 = await r2.clone().text();
    // 두 응답 본문이 동일해야 함 (사용자 열거 방지)
    expect(t1).toBe(t2);
  });

  it('잘못된 이메일 형식 → 422', async () => {
    const res = await postRequest({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('JSON 본문이 아닌 경우 → 422', async () => {
    const mod = await import('./route');
    const req = new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(422);
  });

  it('REQ-RESET-003: 동일 이메일 4회째 요청 → 429', async () => {
    await seedUser('rl@example.com');
    for (let i = 0; i < 3; i++) {
      const r = await postRequest({ email: 'rl@example.com' }, '10.0.0.1');
      expect(r.status).toBe(200);
    }
    const res = await postRequest({ email: 'rl@example.com' }, '10.0.0.1');
    expect(res.status).toBe(429);
  });

  it('REQ-RESET-003: 동일 IP로 서로 다른 이메일 4회째 → 429 (IP 폭탄 방어)', async () => {
    await seedUser('ip1@example.com');
    await seedUser('ip2@example.com');
    await seedUser('ip3@example.com');
    await postRequest({ email: 'ip1@example.com' }, '9.9.9.9');
    await postRequest({ email: 'ip2@example.com' }, '9.9.9.9');
    await postRequest({ email: 'ip3@example.com' }, '9.9.9.9');
    const res = await postRequest({ email: 'ip4-new@example.com' }, '9.9.9.9');
    expect(res.status).toBe(429);
  });

  it('Rate Limit 429 시 password_reset_tokens 에 새 레코드 생성되지 않음', async () => {
    await seedUser('rl2@example.com');
    for (let i = 0; i < 3; i++) await postRequest({ email: 'rl2@example.com' }, '11.0.0.1');
    // 4회째 차단
    await postRequest({ email: 'rl2@example.com' }, '11.0.0.1');
    const tokens = await query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email='rl2@example.com')",
    );
    // 정확히 3개(차단 전까지 발급분)만 존재
    expect(tokens.rows[0].count).toBe(3);
  });

  it('AC: 이메일 대소문자 정규화 (USER@X.com 요청 가능)', async () => {
    await seedUser('case@example.com');
    const res = await postRequest({ email: 'CASE@example.com' }, '12.0.0.1');
    expect(res.status).toBe(200);
  });

  it('AC: 요청 시 이미 존재하는 활성 토큰이 있어도 새 토큰 발급 허용 (덮어쓰지 않음)', async () => {
    const userId = await seedUser('dup@example.com');
    // 기존 토큰 1건 수동 INSERT
    await query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 minutes\')',
      [userId, hashToken('previoustokenhex')],
    );
    const res = await postRequest({ email: 'dup@example.com' }, '13.0.0.1');
    expect(res.status).toBe(200);
    const tokens = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
    expect(tokens.rows[0].count).toBe(2);
  });
});
