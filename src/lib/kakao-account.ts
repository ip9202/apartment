/**
 * 카카오 계정 연결/가입 로직 — SPEC-AUTH-KAKAO-001 T-005/T-006.
 *
 * 이메일 기준 자동 연결 정책:
 *  (a) 기존 이메일(provider='email') → provider/provider_id 갱신 + 기존 데이터 보존 + 최초 연결 알림
 *  (b) 신규 이메일 → RESIDENT 자동 가입 (password_hash=NULL)
 *  (c) 동일 이메일+provider_id → 멱등 재로그인
 *  (d) provider_id 가 다른 이메일에 연결됨 → 409 (REQ-KAKAO-009)
 *  (e) 기존 provider='kakao' + 다른 provider_id → 409 (AC-KAKAO-019 탈취 방어)
 *  (f) status=INACTIVE → 403 (REQ-KAKAO-010)
 *
 * @MX:NOTE: [AUTO] 자동 연결은 사용자 마찰 최소화 vs 계정 분할 위험의 균형 정책이다.
 *           카카오 이메일 검증을 본인확인의 충분조건이 아닌 보조 신호로 취급한다.
 *           탈취 탐지를 위해 최초 1회 연결 시 기존 이메일 계정 소유자에게 알림을 발송한다 (REQ-KAKAO-017).
 * @MX:TODO: [AUTO] 타 provider(Google/Naver) 추가 시 provider 추상화 계층 도입 검토
 */

import { withTransaction } from './db';
import { sendKakaoLinkedNotification } from './kakao-email';
import type { MailTransport } from './email';

/** 카카오 ID 중복 연결 시 발생 (REQ-KAKAO-009, AC-KAKAO-019). 콜백이 409 로 변환. */
export class KakaoConflictError extends Error {
  constructor(message = '이미 다른 계정에 연결된 카카오 계정입니다') {
    super(message);
    this.name = 'KakaoConflictError';
  }
}

/** INACTIVE 계정 로그인 시도 (REQ-KAKAO-010). 콜백이 403 으로 변환. */
export class KakaoInactiveError extends Error {
  constructor(message = '관리사무소에 문의하세요') {
    super(message);
    this.name = 'KakaoInactiveError';
  }
}

/** upsert 결과 사용자 행(세션 발급에 필요한 최소 필드). */
export interface KakaoUpsertUser {
  id: string;
  email: string;
  role: string;
  verifiedAt: string | null;
  status: string;
}

/** upsertKakaoAccount 반환값. */
export interface KakaoUpsertResult {
  user: KakaoUpsertUser;
  /** 최초 연결 여부 (true 면 알림 이미 발송됨). 멱등 재로그인/신규 가입은 false. */
  isNewLink: boolean;
}

/** upsertKakaoAccount 옵션. */
export interface UpsertKakaoAccountOptions {
  /** 알림 발송 전송기 (단위 테스트 주입용). 미주입 시 발송 생략. */
  transport?: MailTransport;
}

/** DB 행을 KakaoUpsertUser 로 정규화. */
function toUpsertUser(row: {
  id: string;
  email: string;
  role: string;
  verified_at: string | null;
  status: string;
}): KakaoUpsertUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    verifiedAt: row.verified_at,
    status: row.status,
  };
}

/**
 * 카카오 이메일 기준으로 계정을 연결하거나 신규 가입한다.
 *
 * @param email 카카오가 제공한 이메일 (소문자 정규화 권장)
 * @param kakaoId 카카오 고유 ID (문자열)
 * @param opts transport 주입 시 최초 연결 알림 발송
 * @returns 연결/가입된 사용자 행 + isNewLink 플래그
 * @throws {KakaoConflictError} provider_id 가 다른 이메일에 연결되었거나 기존 kakao 계정의 provider_id 불일치
 * @throws {KakaoInactiveError} 기존 계정 status=INACTIVE
 */
export async function upsertKakaoAccount(
  email: string,
  kakaoId: string,
  opts: UpsertKakaoAccountOptions = {},
): Promise<KakaoUpsertResult> {
  // 이메일 소문자 정규화 — login route(toLowerCase) 와 동일 기준으로 저장/조회 (REQ-KAKAO-007/017, AC-KAKAO-008/018).
  // 카카오가 대소문자 혼용 이메일을 반환해도 기존 소문자 계정과 정확히 매칭된다.
  const normalizedEmail = email.toLowerCase();

  return withTransaction(async (client) => {
    // 1. 이메일 기준 기존 사용자 조회
    const existingRes = await client.query<{
      id: string;
      email: string;
      provider: string;
      provider_id: string | null;
      password_hash: string | null;
      role: string;
      verified_at: string | null;
      status: string;
    }>(
      `SELECT u.id, u.email, u.provider, u.provider_id, u.password_hash,
              u.verified_at, u.status, r.code AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1`,
      [normalizedEmail],
    );
    const existing = existingRes.rows[0];

    // 2. 기존 이메일 존재 분기
    if (existing) {
      // (f) INACTIVE 차단 (REQ-KAKAO-010)
      if (existing.status === 'INACTIVE') {
        throw new KakaoInactiveError();
      }

      // (c) 멱등 재로그인 — 동일 provider_id
      if (existing.provider === 'kakao' && existing.provider_id === kakaoId) {
        return {
          user: toUpsertUser({
            id: existing.id,
            email: existing.email,
            role: existing.role,
            verified_at: existing.verified_at,
            status: existing.status,
          }),
          isNewLink: false,
        };
      }

      // (e) 탈취 방어 — provider='kakao' 인데 provider_id 다름 (AC-KAKAO-019)
      if (existing.provider === 'kakao' && existing.provider_id !== kakaoId) {
        throw new KakaoConflictError('이미 다른 카카오 계정에 연결된 이메일입니다');
      }

      // (d) 다른 이메일에 동일 provider_id 가 이미 연결되었는지 확인 (REQ-KAKAO-009)
      const dupRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE provider = 'kakao' AND provider_id = $1 AND email <> $2`,
        [kakaoId, normalizedEmail],
      );
      if ((dupRes.rowCount ?? 0) > 0) {
        throw new KakaoConflictError();
      }

      // (a) 자동 연결 — provider/provider_id 만 갱신, 나머지 보존 (REQ-KAKAO-007/017)
      const updateRes = await client.query<{
        id: string;
        email: string;
        role: string;
        verified_at: string | null;
        status: string;
      }>(
        `UPDATE users SET provider = 'kakao', provider_id = $1
         WHERE id = $2
         RETURNING id, email,
           (SELECT r.code FROM roles r WHERE r.id = users.role_id) AS role,
           verified_at, status`,
        [kakaoId, existing.id],
      );

      // 최초 연결 알림 발송 (REQ-KAKAO-017) — 정규화된 이메일 사용
      if (opts.transport) {
        await sendKakaoLinkedNotification(normalizedEmail, opts.transport);
      }

      return { user: toUpsertUser(updateRes.rows[0]), isNewLink: true };
    }

    // 3. 신규 가입 분기 — provider_id 중복 먼저 확인 (REQ-KAKAO-009)
    const dupRes = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE provider = 'kakao' AND provider_id = $1`,
      [kakaoId],
    );
    if ((dupRes.rowCount ?? 0) > 0) {
      throw new KakaoConflictError();
    }

    // (b) 신규 RESIDENT 가입 (REQ-KAKAO-008)
    const insertRes = await client.query<{
      id: string;
      email: string;
      role: string;
      verified_at: string | null;
      status: string;
    }>(
      `INSERT INTO users (email, password_hash, role_id, provider, provider_id, status, verified_at)
       SELECT $1, NULL, r.id, 'kakao', $2, 'ACTIVE', NULL
       FROM roles r WHERE r.code = 'RESIDENT'
       RETURNING id, email,
         (SELECT r2.code FROM roles r2 WHERE r2.id = users.role_id) AS role,
         verified_at, status`,
      [normalizedEmail, kakaoId],
    );

    return { user: toUpsertUser(insertRes.rows[0]), isNewLink: false };
  });
}
