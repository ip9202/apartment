/**
 * 입력 유효성 검증 스키마 (zod) — 클라이언트/서버 공유.
 *
 * 회원가입: email(RFC 형식, 최대 255자), password(8자 이상, 영문+숫자 조합),
 * password_confirm(password 와 일치), name(선택). AC-AUTH-003 정책 준수.
 *
 * @MX:NOTE: [AUTO] 비밀번호 정책(8자+영문/숫자)은 SPEC-AUTH-001 research.md §3.1 의 명시적 계약 — 완화 불가.
 */

import { z } from 'zod';

/** 비밀번호 정책 정규식 — 8자 이상, 영문 1자 이상, 숫자 1자 이상. */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/**
 * 이메일 형식 정규식 — zod 4 에서는 deprecated 된 z.string().email() 대신 사용.
 * @MX:NOTE: [AUTO] zod 4 idiom: top-level z.email() 은 별도 스키마 결합이 까다로워
 *           동일 동작 보존을 위해 .refine(EMAIL_REGEX) 패턴 사용.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 회원가입 요청 본문 스키마. AC-AUTH-003. */
export const signupSchema = z
  .object({
    email: z
      .string()
      .max(255, '이메일은 255자 이하여야 합니다')
      .refine((v) => EMAIL_REGEX.test(v), '올바른 이메일 형식이 아닙니다'),
    password: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다')
      .regex(PASSWORD_REGEX, '비밀번호는 영문과 숫자를 모두 포함해야 합니다'),
    password_confirm: z.string(),
    name: z.string().optional(),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: '비밀번호 확인이 일치하지 않습니다',
    path: ['password_confirm'],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * 로그인 요청 본문 스키마 (TASK-AUTH-008).
 * email(RFC 형식, 최대 255자), password(최소 1자 — 빈 문자열만 거부).
 * 회원가입과 달리 비밀번호 정책(8자+영문/숫자)은 검증하지 않는다:
 * 이미 가입된 사용자의 비밀번호는 정책 변경 전에 설정되었을 수 있으므로,
 * 로그인 시점에는 형식 검증이 아닌 comparePassword 결과로 판별한다.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .max(255, '이메일은 255자 이하여야 합니다')
    .refine((v) => EMAIL_REGEX.test(v), '올바른 이메일 형식이 아닙니다'),
  password: z.string().min(1, '비밀번호를 입력해주세요'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * 비밀번호 재설정 강도 정규식 — 8자 이상, 영문+숫자+특수문자 조합.
 * SPEC-AUTH-RESET-001 §4 REQ-RESET-004/006. 로그인/회원가입보다 한 단계 강한 정책.
 * @MX:NOTE: [AUTO] 재설정 시 강제되는 강력한 비밀번호 정책 — 회원가입(영문+숫자)보다 특수문자 추가 요구.
 */
const STRONG_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

/** 재설정 요청 본문 스키마 (REQ-RESET-001). email 만 검증. */
export const resetRequestSchema = z.object({
  email: z
    .string()
    .max(255, '이메일은 255자 이하여야 합니다')
    .refine((v) => EMAIL_REGEX.test(v), '올바른 이메일 형식이 아닙니다'),
});

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

/** 재설정 확인 본문 스키마 (REQ-RESET-004/006). token + 강력한 새 비밀번호 + 확인. */
export const resetConfirmSchema = z
  .object({
    token: z.string().min(1, '토큰이 필요합니다'),
    password: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다')
      .regex(
        STRONG_PASSWORD_REGEX,
        '비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다',
      ),
    password_confirm: z.string(),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: '비밀번호 확인이 일치하지 않습니다',
    path: ['password_confirm'],
  });

export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

/** 회원가입 응답 본문 data 객체 (AC-AUTH-025: password_hash 절대 미포함). */
export interface SignupResponseUser {
  id: string;
  email: string;
  role: string;
  verified: boolean;
}

export interface SignupResponse {
  success: true;
  data: SignupResponseUser;
}
