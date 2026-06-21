/**
 * 환경 변수 부트 검증 (fail-fast).
 *
 * 인증 시스템의 안전한 부팅을 보장하기 위해, 잘못된/누락된 환경 변수는
 * 애플리케이션 시작 즉시 예외로 중단시킨다. 설정 오류를 런타임이 아닌
 * 부트 타임에 발견하기 위함이다.
 *
 * @MX:WARN: [AUTO] JWT 시크릿 검증은 인증 시스템의 근간 — 오설정 시 토큰 위조/검증 실패로 전체 인증 마비
 * @MX:REASON: JWT_SECRET < 32자 또는 AT/RT 시크릿 동일 시 공격 표면 증가 (무차별 대입, 단일 키 유출 시 전 토큰 탈취)
 */

const MIN_SECRET_LENGTH = 32;

export interface AppEnv {
  DATABASE_URL: string;
  TEST_DATABASE_URL?: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  NEXT_PUBLIC_APP_URL: string;
  NODE_ENV?: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[env] ${message}`);
}

/**
 * 주어진 환경 객체를 검증하고 타입이 좁혀진 AppEnv 를 반환한다.
 * process.env 대신 임의의 레코드를 받아 단위 테스트가 가능하다.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const jwtSecret = source.JWT_SECRET;
  const jwtRefreshSecret = source.JWT_REFRESH_SECRET;
  const databaseUrl = source.DATABASE_URL;
  const appUrl = source.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  assert(databaseUrl, 'DATABASE_URL 이 설정되지 않았습니다');
  assert(jwtSecret, 'JWT_SECRET 이 설정되지 않았습니다');
  assert(
    jwtSecret.length >= MIN_SECRET_LENGTH,
    `JWT_SECRET 은 최소 ${MIN_SECRET_LENGTH}자 이상이어야 합니다 (현재 ${jwtSecret.length}자)`,
  );
  assert(jwtRefreshSecret, 'JWT_REFRESH_SECRET 이 설정되지 않았습니다');
  assert(
    jwtRefreshSecret.length >= MIN_SECRET_LENGTH,
    `JWT_REFRESH_SECRET 은 최소 ${MIN_SECRET_LENGTH}자 이상이어야 합니다 (현재 ${jwtRefreshSecret.length}자)`,
  );
  assert(
    jwtSecret !== jwtRefreshSecret,
    'JWT_SECRET 과 JWT_REFRESH_SECRET 은 서로 상이해야 합니다 (distinct secrets required)',
  );

  return {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: source.TEST_DATABASE_URL,
    JWT_SECRET: jwtSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    NEXT_PUBLIC_APP_URL: appUrl,
    NODE_ENV: source.NODE_ENV,
  };
}

/** 부트 시 검증된 환경 (process.env 기반). 검증 실패 시 모듈 로드 즉시 throw. */
export const env: AppEnv = loadEnv();
