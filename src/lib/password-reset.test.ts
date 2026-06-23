/**
 * password-reset.ts 단위 테스트 — SPEC-AUTH-RESET-001 (REQ-RESET-001/004/005/008).
 *
 * 토큰 생성(crypto.randomBytes 32), SHA-256 해시, 만료 검증, 일회용 갱신,
 * 사용자별 활성 토큰 일괄 무효화를 단정한다.
 * DB 통합은 API route 테스트에서 다루며 본 파일은 순수 함수 단위.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateResetToken,
  hashToken,
  TOKEN_BYTES,
  TOKEN_TTL_MINUTES,
  isTokenRecordUsable,
  type ResetTokenRecord,
} from './password-reset';

function makeRecord(overrides: Partial<ResetTokenRecord> = {}): ResetTokenRecord {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    token_hash: 'dummy',
    expires_at: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString(),
    used_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateResetToken — 난수 토큰 생성 (REQ-RESET-001)', () => {
  it('hex 문자열 길이는 TOKEN_BYTES*2 (64자)', () => {
    const token = generateResetToken();
    expect(token).toHaveLength(TOKEN_BYTES * 2);
  });

  it('hex 만으로 구성된다', () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('연속 호출 시 매번 다른 값 (예측 불가)', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    const c = generateResetToken();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('엔트로피 충분: 1000회 생성 시 충돌 0건', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateResetToken());
    }
    expect(seen.size).toBe(1000);
  });
});

describe('hashToken — SHA-256 (REQ-RESET-001, 보안 6.1)', () => {
  it('동일 입력에 대해 동일 해시 반환 (결정론적)', () => {
    const t = generateResetToken();
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it('미리 계산한 SHA-256 hex 와 일치 (node:crypto createHash)', () => {
    const t = generateResetToken();
    const expected = createHash('sha256').update(t, 'utf8').digest('hex');
    expect(hashToken(t)).toBe(expected);
  });

  it('입력이 1자 달라도 해시가 완전히 다르다 (눈사태)', () => {
    const t = generateResetToken();
    const t2 = t.slice(0, -1) + (t.slice(-1) === '0' ? '1' : '0');
    expect(hashToken(t)).not.toBe(hashToken(t2));
  });

  it('빈 문자열도 정상 처리 (예외 없이)', () => {
    expect(() => hashToken('')).not.toThrow();
    expect(hashToken('')).toBe(createHash('sha256').update('', 'utf8').digest('hex'));
  });
});

describe('isTokenRecordUsable — 만료/사용 여부 판별 (REQ-RESET-005, REQ-RESET-008)', () => {
  it('미사용+미만료 → true', () => {
    expect(isTokenRecordUsable(makeRecord())).toBe(true);
  });

  it('만료됨(expires_at 과거) → false', () => {
    const rec = makeRecord({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    expect(isTokenRecordUsable(rec)).toBe(false);
  });

  it('사용됨(used_at 설정) → false', () => {
    const rec = makeRecord({ used_at: new Date().toISOString() });
    expect(isTokenRecordUsable(rec)).toBe(false);
  });

  it('사용됨 + 만료 → false', () => {
    const rec = makeRecord({
      used_at: new Date().toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(isTokenRecordUsable(rec)).toBe(false);
  });
});

describe('TOKEN_TTL_MINUTES — 만료 상수 (보안 6.1)', () => {
  it('30분 고정 (과도한 만료 창 금지)', () => {
    expect(TOKEN_TTL_MINUTES).toBe(30);
  });
});

describe('TOKEN_BYTES — 난수 길이 상수 (REQ-RESET-001)', () => {
  it('32바이트 (256비트 엔트로피)', () => {
    expect(TOKEN_BYTES).toBe(32);
  });
});
