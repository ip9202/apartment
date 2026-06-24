/**
 * upsertKakaoAccount + 최초 연결 알림 단위 테스트 — SPEC-AUTH-KAKAO-001 T-005/T-006.
 *
 * 5개 분기 + 알림 발송 검증:
 *  (a) 기존 이메일(provider='email') → provider/provider_id 갱신, password_hash/role/unit/verified/status 보존, 알림 발송
 *  (b) 신규 이메일 → RESIDENT 신규 가입, password_hash=NULL, verified_at=NULL
 *  (c) 동일 이메일+동일 provider_id → 멱등 재로그인, 알림 미발송
 *  (d) provider_id 가 다른 이메일에 이미 연결 → 409 (REQ-KAKAO-009)
 *  (e) 기존 provider='kakao' + 다른 provider_id → 409 (AC-KAKAO-019 탈취 방어)
 *  (f) status=INACTIVE → 403 (REQ-KAKAO-010)
 *
 * db 모듈(query/withTransaction) 을 모킹하여 분기 로직을 결정론적으로 검증.
 * DB 레벨 유일성 보장은 migration-011.test.ts 에서 검증.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted 로 vi.mock 보다 먼저 안전하게 초기화되는 mock 함수 생성
const { queryMock, clientQueryMock, withTransactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientQueryMock: vi.fn(),
  withTransactionMock: vi.fn(
    async <T>(fn: (client: { query: typeof clientQueryMock }) => Promise<T>): Promise<T> =>
      fn({ query: clientQueryMock }),
  ),
}));

vi.mock('./db', () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

// import 는 vi.mock 이후에 호출되어야 모킹 적용 (vitest 호이스트는 vi.mock 을 자동으로 끌어올림)
import { upsertKakaoAccount, KakaoConflictError, KakaoInactiveError } from './kakao-account';
import type { MailTransport } from './email';

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  withTransactionMock.mockClear();
});

describe('upsertKakaoAccount (T-005)', () => {
  describe('(b) 신규 이메일 → RESIDENT 자동 가입 (REQ-KAKAO-008)', () => {
    it('기존 이메일 미존재 시 password_hash=NULL 인 신규 RESIDENT 레코드를 INSERT 한다', async () => {
      // 첫 쿼리: 기존 사용자 조회 → 없음
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // provider_id 중복 조회 → 없음
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // INSERT 결과
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-user-id',
            email: 'newuser@example.com',
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });

      const result = await upsertKakaoAccount('newuser@example.com', '67890');

      expect(result.user.id).toBe('new-user-id');
      expect(result.user.role).toBe('RESIDENT');
      expect(result.isNewLink).toBe(false); // 신규 가입은 알림 미발송
      // INSERT SQL 검증 (client.query(sql, params) — args[0] 이 SQL 문자열)
      const insertCall = clientQueryMock.mock.calls[2];
      expect(String(insertCall[0])).toContain('INSERT');
    });
  });

  describe('(a) 기존 이메일(provider=email) → 카카오 연결 + 알림 (REQ-KAKAO-007/017)', () => {
    it('기존 이메일 계정의 provider 를 kakao 로 갱신하고 password_hash 등 보존한다', async () => {
      // 기존 사용자 조회 → provider='email' 존재
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'existing-id',
            email: 'resident@example.com',
            provider: 'email',
            provider_id: null,
            password_hash: 'bcrypt-hash-preserved',
            role: 'RESIDENT',
            verified_at: '2026-01-01T00:00:00Z',
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });
      // provider_id 중복 조회 → 없음
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // UPDATE 결과
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'existing-id',
            email: 'resident@example.com',
            role: 'RESIDENT',
            verified_at: '2026-01-01T00:00:00Z',
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });

      const transport: MailTransport = { send: vi.fn().mockResolvedValue(undefined) };
      const result = await upsertKakaoAccount('resident@example.com', '12345', {
        transport,
      });

      expect(result.user.id).toBe('existing-id');
      expect(result.isNewLink).toBe(true);
      // UPDATE SQL 이 provider, provider_id 만 갱신 (password_hash 미포함) — call index 2
      const updateCall = clientQueryMock.mock.calls[2];
      expect(String(updateCall[0])).toContain('UPDATE');
      expect(String(updateCall[0])).not.toContain('password_hash');
    });

    it('최초 연결 시 알림 이메일이 발송된다 (REQ-KAKAO-017)', async () => {
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'uid',
            email: 'r@example.com',
            provider: 'email',
            provider_id: null,
            password_hash: 'h',
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      clientQueryMock.mockResolvedValueOnce({
        rows: [{ id: 'uid', email: 'r@example.com', role: 'RESIDENT', verified_at: null, status: 'ACTIVE' }],
        rowCount: 1,
      });

      const transport: MailTransport = { send: vi.fn().mockResolvedValue(undefined) };
      await upsertKakaoAccount('r@example.com', '999', { transport });

      expect(transport.send).toHaveBeenCalledTimes(1);
      const msgArg = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msgArg.to).toBe('r@example.com');
      expect(msgArg.subject).toContain('카카오');
      expect(msgArg.text).toContain('연결');
    });

    // C1 회귀 테스트 (FIX SPEC-AUTH-KAKAO-001): transport 미주입 시에도 알림은 발생해야 한다.
    // 프로덕션 콜백은 upsertKakaoAccount(email, providerId) 로 transport 없이 호출한다.
    // 기존 버그: if (opts.transport) 게이트로 인해 transport 미주입 시 알림이 데드코드가 됨.
    it('transport 미주입(프로덕션 콜백 경로) 시에도 최초 연결 알림이 발생한다 (REQ-KAKAO-017, FIX-C1)', async () => {
      // dev/test 환경 폴백(console.log) 발생을 감지하여 알림 코드 경로가 실행됐음을 증명.
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'uid2',
            email: 'notrans@example.com',
            provider: 'email',
            provider_id: null,
            password_hash: 'h',
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      clientQueryMock.mockResolvedValueOnce({
        rows: [{ id: 'uid2', email: 'notrans@example.com', role: 'RESIDENT', verified_at: null, status: 'ACTIVE' }],
        rowCount: 1,
      });

      // transport 미주입 — 프로덕션 콜백과 동일 호출 형태
      const result = await upsertKakaoAccount('notrans@example.com', '777');

      expect(result.isNewLink).toBe(true);
      // dev 폴백 알림이 발생했는지 확인 (kakao-email dev-fallback 마커)
      const logged = consoleSpy.mock.calls.some((c) =>
        String(c).includes('kakao-linked') || String(c).includes('알림'),
      );
      expect(logged).toBe(true);

      consoleSpy.mockRestore();
    });

    // C1 보강: 알림 발송 자체가 실패해도 로그인은 차단되지 않는다 (best-effort).
    it('알림 발송 실패 시에도 upsert 결과는 정상 반환된다 (REQ-KAKAO-017 best-effort, FIX-C1)', async () => {
      // 프로덕션 SMTP 경로를 createSmtpTransport 실패로 시뮬레이션하기 위해
      // NODE_ENV=production + transport 미주입 + SMTP 미설정 → createSmtpTransport throw.
      const prevEnv = process.env.NODE_ENV;
      (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'uid3',
            email: 'fail@example.com',
            provider: 'email',
            provider_id: null,
            password_hash: 'h',
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      clientQueryMock.mockResolvedValueOnce({
        rows: [{ id: 'uid3', email: 'fail@example.com', role: 'RESIDENT', verified_at: null, status: 'ACTIVE' }],
        rowCount: 1,
      });

      // 알림 실패(SMTP 설정 누락)해도 예외가 사용자에게 전파되지 않아야 함
      const result = await upsertKakaoAccount('fail@example.com', '555');

      expect(result.isNewLink).toBe(true);
      expect(result.user.id).toBe('uid3');
      // 실패 로그가 기록됨 (운영자 가시성)
      expect(consoleErr).toHaveBeenCalled();

      (process.env as { NODE_ENV: string }).NODE_ENV = prevEnv ?? '';
      consoleErr.mockRestore();
    });
  });

  describe('(c) 동일 이메일 + 동일 provider_id → 멱등 재로그인', () => {
    it('이미 연결된 동일 카카오 계정은 갱신 없이 반환하고 알림을 발송하지 않는다', async () => {
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'uid',
            email: 'k@example.com',
            provider: 'kakao',
            provider_id: '12345',
            password_hash: null,
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });

      const transport: MailTransport = { send: vi.fn().mockResolvedValue(undefined) };
      const result = await upsertKakaoAccount('k@example.com', '12345', { transport });

      expect(result.user.id).toBe('uid');
      expect(result.isNewLink).toBe(false);
      expect(transport.send).not.toHaveBeenCalled();
      // UPDATE 미수행 (clientQueryMock 호출 1회: 조회만)
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('(e) 기존 provider=kakao + 다른 provider_id → 409 (AC-KAKAO-019)', () => {
    it('기존 kakao 계정의 provider_id 가 다르면 409 를 throw 한다', async () => {
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'victim-id',
            email: 'victim@example.com',
            provider: 'kakao',
            provider_id: '99999',
            password_hash: null,
            role: 'RESIDENT',
            verified_at: null,
            status: 'ACTIVE',
          },
        ],
        rowCount: 1,
      });

      await expect(upsertKakaoAccount('victim@example.com', '88888')).rejects.toThrow(
        KakaoConflictError,
      );
    });
  });

  describe('(d) provider_id 가 다른 이메일에 이미 연결 → 409 (REQ-KAKAO-009)', () => {
    it('동일 provider_id 가 다른 이메일에 존재하면 409 를 throw 한다', async () => {
      // 이메일 조회 → 없음 (신규 가입 시도)
      clientQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // provider_id 중복 조회 → 다른 이메일에 존재
      clientQueryMock.mockResolvedValueOnce({
        rows: [{ id: 'other-id', email: 'other@example.com', provider: 'kakao', provider_id: '12345' }],
        rowCount: 1,
      });

      await expect(upsertKakaoAccount('new@example.com', '12345')).rejects.toThrow(
        KakaoConflictError,
      );
    });
  });

  describe('이메일 대소문자 정규화 (REQ-KAKAO-007/017, AC-KAKAO-008/018)', () => {
    it('카카오가 대소문자 혼용 이메일을 반환해도 기존 소문자 계정과 동일 사용자로 연결한다', async () => {
      // 기존 사용자는 소문자 이메일로 저장되어 있음 (login route 가 toLowerCase() 로 저장)
      // 카카오는 'User@Example.com' (대소문자 혼용) 반환 → 동일 계정이어야 함
      // BUG (수정 전): 대소문자 미정규화 → 조회 누락 → 신규 가입 분기 → 중복 계정
      clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        const [param1] = (params as unknown[]) ?? [];
        // 기존 사용자 조회: 정규화된 소문자 이메일로 조회해야 기존 행이 발견됨
        if (sql.includes('SELECT u.id') && sql.includes('WHERE u.email = $1')) {
          if (param1 === 'user@example.com') {
            return {
              rows: [
                {
                  id: 'existing-id',
                  email: 'user@example.com',
                  provider: 'email',
                  provider_id: null,
                  password_hash: 'bcrypt-hash',
                  role: 'RESIDENT',
                  verified_at: '2026-01-01T00:00:00Z',
                  status: 'ACTIVE',
                },
              ],
              rowCount: 1,
            };
          }
          // 대소문자 혼용 이메일로 조회하면 발견되지 않음 (현재 버그)
          return { rows: [], rowCount: 0 };
        }
        // provider_id 중복 조회
        if (sql.includes("provider = 'kakao'") && sql.includes('email <> $2')) {
          return { rows: [], rowCount: 0 };
        }
        // UPDATE 결과
        if (sql.includes('UPDATE users SET provider')) {
          return {
            rows: [
              {
                id: 'existing-id',
                email: 'user@example.com',
                role: 'RESIDENT',
                verified_at: '2026-01-01T00:00:00Z',
                status: 'ACTIVE',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await upsertKakaoAccount('User@Example.com', '12345');

      // 기존 계정이 연결되어야 함 (신규 가입 아님)
      expect(result.user.id).toBe('existing-id');
      expect(result.isNewLink).toBe(true);
      // 기존 사용자 조회 시 정규화된 소문자 이메일이 사용되었는지 확인
      const lookupCall = clientQueryMock.mock.calls.find(
        (c) => String(c[0]).includes('WHERE u.email = $1'),
      );
      expect(lookupCall).toBeDefined();
      expect(lookupCall![1]).toEqual(['user@example.com']);
    });
  });

  describe('(f) status=INACTIVE → 403 (REQ-KAKAO-010)', () => {
    it('기존 계정이 INACTIVE 면 403 을 throw 한다', async () => {
      clientQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'banned-id',
            email: 'banned@example.com',
            provider: 'email',
            provider_id: null,
            password_hash: 'h',
            role: 'RESIDENT',
            verified_at: null,
            status: 'INACTIVE',
          },
        ],
        rowCount: 1,
      });

      await expect(upsertKakaoAccount('banned@example.com', '11111')).rejects.toThrow(
        KakaoInactiveError,
      );
    });
  });
});
