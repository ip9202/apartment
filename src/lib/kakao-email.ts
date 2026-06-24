/**
 * 카카오 최초 연결 알림 이메일 — SPEC-AUTH-KAKAO-001 T-006 (REQ-KAKAO-017).
 *
 * 이메일 자동 연결 정책의 탈취 탐지 창 제공:
 * 기존 이메일 계정에 카카오 수단이 최초 1회 연결될 때 발송된다.
 * 본인이 아닌 경우 사용자가 이상 징후를 인지할 수 있도록 한다.
 *
 * MailTransport 주입 패턴을 재사용하여 단위 테스트에서 가짜 전송기 검증.
 */

import type { MailTransport, MailMessage } from './email';

/**
 * 카카오 계정 연결 알림 이메일을 발송한다.
 *
 * @param to 수신자 이메일 (연결된 기존 계정 주소)
 * @param transport 발송 전송기 (단위 테스트 주입 / 프로덕션 SMTP)
 */
export async function sendKakaoLinkedNotification(
  to: string,
  transport: MailTransport,
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
  await transport.send(msg);
}
