/**
 * 카카오 최초 연결 알림 이메일 — SPEC-AUTH-KAKAO-001 T-006 (REQ-KAKAO-017).
 *
 * 이메일 자동 연결 정책의 탈취 탐지 창 제공:
 * 기존 이메일 계정에 카카오 수단이 최초 1회 연결될 때 발송된다.
 * 본인이 아닌 경우 사용자가 이상 징후를 인지할 수 있도록 한다.
 *
 * 전송 해석 전략 (FIX-C1, sendResetEmail 과 동일 패턴):
 *  - opts.transport 주입 시: 해당 전송기로 발송 (단위 테스트용 가짜 전송기)
 *  - 미주입 + 비프로덕션: console 폴백 (개발/테스트 환경)
 *  - 미주입 + 프로덕션: createSmtpTransport() 로 nodemailer 전송기 자체 생성
 *
 * 이 폴백이 없으면 프로덕션 콜백(callback/route.ts)이 transport 없이
 * upsertKakaoAccount 를 호출하기 때문에 알림이 데드코드가 된다 (FIX-C1).
 */

import {
  createSmtpTransport,
  type MailTransport,
  type MailMessage,
  type NodemailerLoader,
} from './email';

/** 알림 발송 옵션. */
export interface SendKakaoLinkedOptions {
  /** 발송 전송기 (단위 테스트 주입용). 미주입 시 환경에 따라 자체 해석. */
  transport?: MailTransport;
  /** 프로덕션 SMTP 경로 테스트용 nodemailer 로더 주입. */
  smtpLoader?: NodemailerLoader;
}

/**
 * 카카오 계정 연결 알림 이메일을 발송한다.
 *
 * @param to 수신자 이메일 (연결된 기존 계정 주소)
 * @param opts transport 주입 시 해당 전송기 사용; 미주입 시 dev console 폴백 / prod SMTP 자체 생성
 */
export async function sendKakaoLinkedNotification(
  to: string,
  opts: SendKakaoLinkedOptions = {},
): Promise<void> {
  const subject = '[아이뜨락] 카카오 계정이 연결되었습니다';
  const text = [
    '아이뜨락 계정에 카카오 로그인이 연결되었습니다.',
    '',
    '이제 카카오 계정으로도 아이뜨락에 로그인할 수 있습니다.',
    '기존 이메일/비밀번호 로그인도 그대로 사용 가능합니다.',
    '',
    '본인이 연결한 것이 아니라면 즉시 관리사무소에 문의해 주세요.',
  ].join('\n');
  const html = [
    '<p>아이뜨락 계정에 카카오 로그인이 연결되었습니다.</p>',
    '<p>이제 카카오 계정으로도 아이뜨락에 로그인할 수 있습니다.</p>',
    '<p>기존 이메일/비밀번호 로그인도 그대로 사용 가능합니다.</p>',
    '<p><strong>본인이 연결한 것이 아니라면 즉시 관리사무소에 문의해 주세요.</strong></p>',
  ].join('\n');

  const msg: MailMessage = { to, subject, text, html };

  if (opts.transport) {
    await opts.transport.send(msg);
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    // 개발/테스트 폴백 — 외부 SMTP 의존 없이 발송 시뮬레이션.
    console.log('[kakao-linked:dev-fallback] 카카오 최초 연결 알림 발송 시뮬레이션', { to, subject });
    return;
  }

  const transport = await createSmtpTransport(opts.smtpLoader);
  await transport.send(msg);
}
