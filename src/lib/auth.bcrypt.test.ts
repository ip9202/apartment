import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from './auth';

describe('auth.ts — bcrypt (REQ-AUTH-002, AC-AUTH-004)', () => {
  describe('hashPassword', () => {
    it('반환값이 bcrypt $2[aby]$12$ 형식과 일치한다 (salt rounds 12)', () => {
      const hash = hashPassword('password123');
      // $2a$ / $2b$ / $2y$ + 12$ + 22자 salt + 31자 해시
      expect(hash).toMatch(/^\$2[aby]\$12\$.{53}$/);
    });

    it('동일 평문도 매 호출마다 상이한 해시를 생성한다 (salt 랜덤성)', () => {
      const h1 = hashPassword('same-password');
      const h2 = hashPassword('same-password');
      expect(h1).not.toBe(h2);
    });

    it('평문과 해시는 서로 다르다 (평문 저장 금지, AC-AUTH-004)', () => {
      const plaintext = 'password123';
      const hash = hashPassword(plaintext);
      expect(hash).not.toBe(plaintext);
      expect(hash).not.toContain(plaintext);
    });
  });

  describe('comparePassword', () => {
    it('올바른 평문 + 해시 쌍이면 true 를 반환한다', () => {
      const hash = hashPassword('correct-horse-battery-9');
      expect(comparePassword('correct-horse-battery-9', hash)).toBe(true);
    });

    it('잘못된 평문이면 false 를 반환한다', () => {
      const hash = hashPassword('correct-password');
      expect(comparePassword('wrong-password', hash)).toBe(false);
    });

    it('빈 평문은 false 를 반환한다', () => {
      const hash = hashPassword('real-password');
      expect(comparePassword('', hash)).toBe(false);
    });

    it('잘못된 형식의 해시값이면 false 를 반환한다 (예외 대신 안전한 false)', () => {
      // bcrypt 가 인식 불가한 문자열 — compareSync 가 throw 해도 false 로 흡수
      expect(comparePassword('anything', 'not-a-valid-bcrypt-hash')).toBe(false);
    });
  });
});
