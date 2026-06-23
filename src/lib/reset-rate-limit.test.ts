/**
 * reset-rate-limit.ts 단위 테스트 — SPEC-AUTH-RESET-001 (REQ-RESET-003, 이메일 폭탄 방지).
 *
 * 동일 이메일 또는 동일 IP 기준 10분당 3회 초과 시 차단.
 * in-memory sliding window. 시간 주입 가능(tickFn)으로 단위 테스트 deterministic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createResetRateLimiter } from './reset-rate-limit';

describe('createResetRateLimiter — 10분당 3회 (REQ-RESET-003)', () => {
  let now = 0;
  const l = createResetRateLimiter({ windowMs: 10 * 60_000, max: 3, tickFn: () => now });

  beforeEach(() => {
    now = 0;
    l.reset();
  });

  it('최초 3회까지는 허용(true)', () => {
    expect(l.tryConsume('a@example.com', '1.1.1.1')).toBe(true);
    expect(l.tryConsume('a@example.com', '1.1.1.1')).toBe(true);
    expect(l.tryConsume('a@example.com', '1.1.1.1')).toBe(true);
  });

  it('4회째는 차단(false)', () => {
    l.tryConsume('b@example.com', '2.2.2.2');
    l.tryConsume('b@example.com', '2.2.2.2');
    l.tryConsume('b@example.com', '2.2.2.2');
    expect(l.tryConsume('b@example.com', '2.2.2.2')).toBe(false);
  });

  it('동일 IP 다른 이메일도 IP 기준 차단 (IP 폭탄 방어)', () => {
    const ip = '3.3.3.3';
    expect(l.tryConsume('e1@x.com', ip)).toBe(true);
    expect(l.tryConsume('e2@x.com', ip)).toBe(true);
    expect(l.tryConsume('e3@x.com', ip)).toBe(true);
    // 동일 IP 4회째 — 이메일이 달라도 IP 임계 초과
    expect(l.tryConsume('e4@x.com', ip)).toBe(false);
  });

  it('윈도우 경과(10분+) 후 카운트 초기화 → 다시 허용', () => {
    l.tryConsume('c@x.com', '4.4.4.4');
    l.tryConsume('c@x.com', '4.4.4.4');
    l.tryConsume('c@x.com', '4.4.4.4');
    expect(l.tryConsume('c@x.com', '4.4.4.4')).toBe(false);
    // 10분 + 1초 경과
    now = 10 * 60_000 + 1000;
    expect(l.tryConsume('c@x.com', '4.4.4.4')).toBe(true);
  });

  it('서로 다른 IP/이메일 조합은 독립 카운트', () => {
    expect(l.tryConsume('d1@x.com', '5.5.5.5')).toBe(true);
    expect(l.tryConsume('d2@x.com', '6.6.6.6')).toBe(true);
    expect(l.tryConsume('d3@x.com', '7.7.7.7')).toBe(true);
    // 각각 다른 IP/이메일 → 3회 모두 허용 후 4번째 IP 신규도 허용
    expect(l.tryConsume('d4@x.com', '8.8.8.8')).toBe(true);
  });
});
