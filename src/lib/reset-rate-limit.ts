/**
 * 비밀번호 재설정 요청 Rate Limiter — SPEC-AUTH-RESET-001 (REQ-RESET-003).
 *
 * 정책: 동일 이메일 또는 동일 IP 기준 10분당 3회 초과 시 429 차단 (이메일 폭탄 방어).
 * 구현: in-memory sliding window. 향후 Redis 등 외부 저장으로 교체 가능하도록
 * ResetRateLimiter 인터페이스로 추상화.
 *
 * @MX:WARN: [AUTO] 임계치 오설정 시 이메일 폭탄 허용 또는 정상 사용자 차단
 * @MX:REASON: max 가 너무 높으면 공격자가 대량 발송으로 비용/스팸 유발,
 *             너무 낮으면 정상 사용자가 재시도 불가. 3회/10분은 SPEC 합의값.
 */

/** 기본 정책 상수 — SPEC-AUTH-RESET-001 §4 REQ-RESET-003. */
export const RESET_WINDOW_MS = 10 * 60_000; // 10분
export const RESET_MAX_REQUESTS = 3;

/** Rate limiter 공개 인터페이스. */
export interface ResetRateLimiter {
  tryConsume(email: string, ip: string): boolean;
  reset(): void;
}

export interface ResetRateLimiterOptions {
  windowMs?: number;
  max?: number;
  /** 시간 소스 — 단위 테스트에서 주입. 기본 Date.now. */
  tickFn?: () => number;
}

/**
 * in-memory sliding window rate limiter 팩토리.
 * email 키와 ip 키 각각에 타임스탬프 배열을 유지하고,
 * 호출 시 만료된 타임스탬프를 제거한 뒤 임계 검사.
 */
export function createResetRateLimiter(
  opts: ResetRateLimiterOptions = {},
): ResetRateLimiter {
  const windowMs = opts.windowMs ?? RESET_WINDOW_MS;
  const max = opts.max ?? RESET_MAX_REQUESTS;
  const tickFn = opts.tickFn ?? (() => Date.now());

  const buckets = new Map<string, number[]>();

  function prune(arr: number[], now: number): number[] {
    const cutoff = now - windowMs;
    return arr.filter((t) => t > cutoff);
  }

  function consumeKey(key: string, now: number): boolean {
    const current = prune(buckets.get(key) ?? [], now);
    if (current.length >= max) {
      buckets.set(key, current);
      return false;
    }
    current.push(now);
    buckets.set(key, current);
    return true;
  }

  return {
    tryConsume(email, ip) {
      const now = tickFn();
      // 이메일 키와 IP 키 각각 카운트. 어느 하나라도 초과하면 차단.
      const emailOk = consumeKey(`email:${email.toLowerCase()}`, now);
      const ipOk = consumeKey(`ip:${ip}`, now);
      return emailOk && ipOk;
    },
    reset() {
      buckets.clear();
    },
  };
}
