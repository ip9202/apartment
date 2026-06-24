/**
 * 카카오 OAuth 2.0 헬퍼 — SPEC-AUTH-KAKAO-001 (T-002/T-003/T-004).
 *
 * 외부 카카오 API(kauth.kakao.com, kapi.kakao.com) 호출을 캡슐화한다.
 * 모든 함수는 global.fetch 를 통해 외부 API 를 호출하므로, 단위 테스트는
 * 반드시 fetch 를 모킹해야 한다 (실제 카카오 API 호출 금지).
 *
 * @MX:NOTE: [AUTO] 카카오 토큰은 반환 후 호출자가 즉시 1회 사용하고 폐기한다.
 *           DB/쿠키/로그에 영속 저장하지 않는다 (REQ-KAKAO-013, 최소권한 원칙).
 *           서비스는 자체 JWT 만 세션으로 유지한다.
 */

import { z } from 'zod';
import { env } from './env';

const KAKAO_AUTH_BASE = 'https://kauth.kakao.com/oauth/authorize';
const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_USER_URL = 'https://kapi.kakao.com/v2/user/me';

/**
 * 카카오 인가 URL 을 조합한다 (T-002, REQ-KAKAO-001).
 * @param state CSRF 방지용 난수 문자열 (시작 엔드포인트에서 생성, 쿠키로 전달)
 * @returns client_id, redirect_uri, response_type=code, state, scope=account_email 포함 URL
 */
export function buildKakaoAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: env.KAKAO_REDIRECT_URI,
    response_type: 'code',
    state,
    scope: 'account_email',
  });
  return `${KAKAO_AUTH_BASE}?${params.toString()}`;
}

/**
 * 카카오 토큰 교환 응답 Zod 스키마 (T-003).
 * access_token 만 필수 — refresh_token/expires_in 은 카카오 응답에 따라 생략 가능.
 */
const KakaoTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  scope: z.string().optional(),
});

/** 카카오 토큰 교환 실패 (에러 응답 또는 스키마 위반) 시 발생하는 에러. */
export class KakaoTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KakaoTokenError';
  }
}

/**
 * 인가 코드를 카카오 액세스 토큰으로 교환한다 (T-003, REQ-KAKAO-003).
 *
 * @MX:WARN: [AUTO] Client Secret 이 요청 본문에 포함된다 — 노출 시 타 앱 위장 가능.
 * @MX:REASON: KAKAO_CLIENT_SECRET 노출 시 공격자가 타 서비스 앱을 위장해 사용자 토큰 탈취 가능.
 *
 * @param code 카카오 인가 코드 (1회성)
 * @returns 카카오 액세스 토큰 (호출자가 즉시 사용 후 폐기, REQ-KAKAO-013)
 * @throws {KakaoTokenError} 카카오 API 에러 응답 또는 응답 스키마 위반 시
 */
export async function exchangeKakaoToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.KAKAO_REST_API_KEY,
    client_secret: env.KAKAO_CLIENT_SECRET,
    code,
    redirect_uri: env.KAKAO_REDIRECT_URI,
  });

  const res = await fetch(KAKAO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: body.toString(),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new KakaoTokenError(
      `카카오 토큰 교환 실패 (status=${res.status})`,
      res.status,
    );
  }

  const parsed = KakaoTokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KakaoTokenError(
      '카카오 토큰 응답 스키마 위반 (access_token 누락)',
      res.status,
    );
  }
  return parsed.data.access_token;
}

/**
 * 카카오 사용자 정보 응답 Zod 스키마 (T-004).
 * - id: 카카오 고유 ID. number 로 오며, EC-KAKAO-004 BigInt 정밀도 위험을 피해
 *       z.coerce.string() 으로 문자열로 변환한다.
 * - kakao_account.email: 이메일 (동의하지 않은 경우 undefined)
 */
const KakaoUserResponseSchema = z.object({
  id: z.coerce.string(),
  kakao_account: z
    .object({
      email: z.string().optional(),
    })
    .optional(),
});

/** 카카오 사용자 정보 파싱 결과. */
export interface KakaoUserInfo {
  providerId: string;
  email: string;
}

/** 카카오 이메일 누락 (미동의) 시 발생하는 에러 — 콜백이 안내 메시지로 변환 (REQ-KAKAO-006). */
export class KakaoEmailMissingError extends Error {
  constructor() {
    super('카카오 계정에서 이메일 제공 동의가 필요합니다');
    this.name = 'KakaoEmailMissingError';
  }
}

/**
 * 카카오 액세스 토큰으로 사용자 정보(고유 ID, 이메일)를 조회한다 (T-004, REQ-KAKAO-005).
 *
 * @param accessToken 카카오 액세스 토큰 (exchangeKakaoToken 결과, 1회 사용 후 폐기)
 * @returns 카카오 고유 ID(문자열) 와 이메일
 * @throws {KakaoEmailMissingError} 이메일이 없거나 동의하지 않은 경우 (REQ-KAKAO-006)
 * @throws {Error} 카카오 API 에러 응답 시
 */
export async function fetchKakaoUser(accessToken: string): Promise<KakaoUserInfo> {
  const res = await fetch(KAKAO_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`카카오 사용자 정보 조회 실패 (status=${res.status})`);
  }

  const json = await res.json();
  const parsed = KakaoUserResponseSchema.parse(json);

  const email = parsed.kakao_account?.email;
  if (!email) {
    throw new KakaoEmailMissingError();
  }

  return {
    providerId: parsed.id,
    email,
  };
}
