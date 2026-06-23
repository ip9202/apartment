/**
 * 이메일 발송 모듈 — SPEC-AUTH-RESET-001 (REQ-RESET-001) 및 향후 알림 재사용.
 *
 * 설계 결정:
 * - MailTransport 인터페이스로 전송을 추상화 → 단위 테스트에서 가짜 전송기 주입 가능
 * - 프로덕션: createSmtpTransport() 가 nodemailer SMTP 전송기를 생성 (lazy import)
 * - 개발/테스트: 전송기 미주입 시 console 로 폴백 (외부 의존 제거)
 * - nodemailer 는 호출 시점에 동적 import → 의존성 미설치 환경에서도 로드 에러 없음
 *
 * @MX:ANCHOR: [AUTO] AUTH-05 이메일 발송 공개 모듈 — 재설정 외 향후 P2 알림에서 재사용 예정
 * @MX:REASON:  발송 인터페이스(send/Transport) 변경 시 모든 호출자(API route, 향후 알림)에 파급
 * @MX:TODO: [AUTO] P2 푸시/이메일 알림 시스템 도입 시 본 모듈 재사용 — 알림 큐/백그라운드 잡 연동
 */

/** 발송 메시지 페이로드. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** 전송 추상화 — 단위 테스트에서 가짜 구현 주입용. */
export interface MailTransport {
  send(msg: MailMessage): Promise<void>;
}

/** 비밀번호 재설정 링크 URL 조합. 후행 슬래시 정규화 포함. */
export function buildResetLink(appUrl: string, token: string): string {
  const base = appUrl.endsWith('/') ? appUrl.slice(0, -1) : appUrl;
  return `${base}/reset-password?token=${token}`;
}

/** 발송 인자. */
export interface SendResetEmailArgs {
  to: string;
  resetLink: string;
  appUrl: string;
  transport?: MailTransport;
  /** 프로덕션 SMTP 경로 테스트용 nodemailer 로더 주입. */
  smtpLoader?: NodemailerLoader;
}

/**
 * 비밀번호 재설정 이메일 발송.
 * - transport 주입 시: 해당 전송기로 발송 (단위 테스트/프로덕션 SMTP)
 * - transport 미주입 + 비프로덕션: console 폴백 (개발 편의)
 * - transport 미주입 + 프로덕션: nodemailer SMTP 전송기 자체 생성 후 발송
 */
export async function sendResetEmail(args: SendResetEmailArgs): Promise<void> {
  const { to, resetLink } = args;
  const subject = '[아이뜨락] 비밀번호 재설정 안내';
  const text = [
    '아이뜨락 계정의 비밀번호 재설정 요청을 받았습니다.',
    '',
    '아래 링크를 눌러 비밀번호를 재설정하세요. 링크는 30분 후 만료됩니다.',
    '',
    resetLink,
    '',
    '본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.',
  ].join('\n');
  const html = [
    '<p>아이뜨락 계정의 비밀번호 재설정 요청을 받았습니다.</p>',
    '<p>아래 링크를 눌러 비밀번호를 재설정하세요. 링크는 30분 후 만료됩니다.</p>',
    `<p><a href="${resetLink}">${resetLink}</a></p>`,
    '<p>본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.</p>',
  ].join('\n');

  const msg: MailMessage = { to, subject, text, html };

  if (args.transport) {
    await args.transport.send(msg);
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    // 개발/테스트 폴백 — 외부 SMTP 의존 없이 발송 시뮬레이션.
    console.log('[email:dev-fallback] 비밀번호 재설정 이메일 발송 시뮬레이션', { to, subject });
    console.log('[email:dev-fallback] 본문 링크:', resetLink);
    return;
  }

  const transport = await createSmtpTransport(args.smtpLoader);
  await transport.send(msg);
}

/** nodemailer 모듈 형태 (lazy import 결과). */
interface NodemailerModule {
  createTransport(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }): { sendMail(opts: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
}

/** 테스트 주입용 nodemailer 로더 — 기본값은 lazy dynamic import. */
export type NodemailerLoader = () => Promise<NodemailerModule>;

const defaultNodemailerLoader: NodemailerLoader = async () => {
  // 변수 지정자 사용으로 Vite 정적 분석 우회 (의존성 미설치 환경에서도 모듈 로드 안전)
  const moduleName = 'nodemailer';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(moduleName);
  return (mod.default ?? mod) as NodemailerModule;
};

/**
 * nodemailer 기반 SMTP 전송기 팩토리 (프로덕션 전용, lazy import).
 * SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM 환경 변수 필요.
 *
 * @MX:WARN: [AUTO] SMTP 자격증명 누출 시 발신자 도용 가능 — 환경 변수로만 관리
 * @MX:REASON: 자격증명이 코드에 hardcoded 되거나 로그에 출력되면 이메일 도메인 신뢰 훼손
 */
export async function createSmtpTransport(
  loader: NodemailerLoader = defaultNodemailerLoader,
): Promise<MailTransport> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from) {
    throw new Error(
      '[email] SMTP 설정 누락: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM 이 필요합니다',
    );
  }
  const nm = await loader();
  const transporter = nm.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return {
    async send(msg: MailMessage): Promise<void> {
      await transporter.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
  };
}
