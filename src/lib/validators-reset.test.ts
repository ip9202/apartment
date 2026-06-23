/**
 * validators.ts 재설정 스키마 단위 테스트 — SPEC-AUTH-RESET-001.
 *
 * resetRequestSchema (email 검증), resetConfirmSchema (강비밀번호 정책 + 확인 일치) 단정.
 */

import { describe, it, expect } from 'vitest';
import { resetRequestSchema, resetConfirmSchema } from './validators';

describe('resetRequestSchema (REQ-RESET-001)', () => {
  it('정상 이메일 → 통과', () => {
    const r = resetRequestSchema.safeParse({ email: 'a@example.com' });
    expect(r.success).toBe(true);
  });

  it('잘못된 이메일 형식 → 실패', () => {
    const r = resetRequestSchema.safeParse({ email: 'no-at-sign' });
    expect(r.success).toBe(false);
  });

  it('이메일 255자 초과 → 실패', () => {
    const r = resetRequestSchema.safeParse({ email: 'x'.repeat(250) + '@x.com' });
    expect(r.success).toBe(false);
  });

  it('이메일 누락 → 실패', () => {
    const r = resetRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('resetConfirmSchema — 강비밀번호 정책 (REQ-RESET-004/006)', () => {
  const valid = { token: 'tok', password: 'Strong1!', password_confirm: 'Strong1!' };

  it('정상 토큰 + 강비밀번호 + 일치 → 통과', () => {
    expect(resetConfirmSchema.safeParse(valid).success).toBe(true);
  });

  it('토큰 누락 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ password: 'Strong1!', password_confirm: 'Strong1!' }).success,
    ).toBe(false);
  });

  it('빈 토큰 → 실패', () => {
    expect(resetConfirmSchema.safeParse({ ...valid, token: '' }).success).toBe(false);
  });

  it('8자 미만 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ ...valid, password: 'Ab1!', password_confirm: 'Ab1!' }).success,
    ).toBe(false);
  });

  it('숫자 누락 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ ...valid, password: 'OnlyLetters!', password_confirm: 'OnlyLetters!' })
        .success,
    ).toBe(false);
  });

  it('영문 누락 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ ...valid, password: '12345678!', password_confirm: '12345678!' })
        .success,
    ).toBe(false);
  });

  it('특수문자 누락 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ ...valid, password: 'NoSpecial1', password_confirm: 'NoSpecial1' })
        .success,
    ).toBe(false);
  });

  it('비밀번호 확인 불일치 → 실패', () => {
    expect(
      resetConfirmSchema.safeParse({ ...valid, password_confirm: 'Different1!' }).success,
    ).toBe(false);
  });

  it('공백만 있는 특수문자는 특수문자로 인정하지 않는다 (s 제외)', () => {
    // 공백은 특수문자 카운트에서 제외되므로 "Abcdefg1 " (끝 공백) 은 특수문자 부족으로 실패
    expect(
      resetConfirmSchema.safeParse({ ...valid, password: 'Abcdefg1 ', password_confirm: 'Abcdefg1 ' })
        .success,
    ).toBe(false);
  });
});
