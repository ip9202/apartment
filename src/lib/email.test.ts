/**
 * email.ts 단위 테스트 — SPEC-AUTH-RESET-001 (REQ-RESET-001 이메일 발송).
 *
 * SMTP 전송은 테스트 환경에서 외부 의존이므로, MailTransport 인터페이스를 주입받아
 * 가짜 전송기(FakeTransport)로 발송 검증. 개발 fallback(console) 동작도 단정.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendResetEmail, buildResetLink, createSmtpTransport, type MailTransport, type MailMessage } from './email';

interface CapturedCall {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function makeFakeTransport(): MailTransport & { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  return {
    calls,
    async send(msg: MailMessage): Promise<void> {
      calls.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    },
  };
}

describe('buildResetLink — 재설정 링크 URL (REQ-RESET-001)', () => {
  it('APP_URL + /reset-password?token= 원문 토큰', () => {
    const link = buildResetLink('https://app.example.com', 'abc123');
    expect(link).toBe('https://app.example.com/reset-password?token=abc123');
  });

  it('후행 슬래시 정규화 (이중 슬래시 방지)', () => {
    const link = buildResetLink('https://app.example.com/', 'abc123');
    expect(link).toBe('https://app.example.com/reset-password?token=abc123');
  });

  it('원문 토큰이 쿼리에 URL-인코딩되지 않은 hex 그대로 전달', () => {
    const token = '0123456789abcdef'.repeat(4);
    expect(buildResetLink('https://x.io', token)).toBe(`https://x.io/reset-password?token=${token}`);
  });
});

describe('sendResetEmail — 재설정 이메일 발송 (REQ-RESET-001)', () => {
  it('주입받은 전송기로 메일을 1회 발송', async () => {
    const transport = makeFakeTransport();
    await sendResetEmail({
      to: 'user@example.com',
      resetLink: 'https://app.example.com/reset-password?token=t1',
      appUrl: 'https://app.example.com',
      transport,
    });
    expect(transport.calls).toHaveLength(1);
  });

  it('수신자 주소가 전달된 주소와 일치', async () => {
    const transport = makeFakeTransport();
    await sendResetEmail({
      to: 'alice@example.com',
      resetLink: 'https://app.example.com/reset-password?token=t2',
      appUrl: 'https://app.example.com',
      transport,
    });
    expect(transport.calls[0].to).toBe('alice@example.com');
  });

  it('본문에 재설정 링크가 포함된다', async () => {
    const transport = makeFakeTransport();
    const link = 'https://app.example.com/reset-password?token=LINK42';
    await sendResetEmail({
      to: 'bob@example.com',
      resetLink: link,
      appUrl: 'https://app.example.com',
      transport,
    });
    expect(transport.calls[0].text).toContain(link);
    expect(transport.calls[0].html).toContain(link);
  });

  it('제목에 "비밀번호 재설정" 의미가 포함된다', async () => {
    const transport = makeFakeTransport();
    await sendResetEmail({
      to: 'c@example.com',
      resetLink: 'https://app.example.com/reset-password?token=t3',
      appUrl: 'https://app.example.com',
      transport,
    });
    expect(transport.calls[0].subject).toMatch(/비밀번호\s*재설정/);
  });

  it('본문에 만료 안내(30분)가 포함된다', async () => {
    const transport = makeFakeTransport();
    await sendResetEmail({
      to: 'd@example.com',
      resetLink: 'https://app.example.com/reset-password?token=t4',
      appUrl: 'https://app.example.com',
      transport,
    });
    expect(transport.calls[0].text).toContain('30');
  });

  it('원문 토큰 값 자체는 본문에 노출되지 않는다 (링크에만)', async () => {
    const transport = makeFakeTransport();
    const token = 'SECRET_TOKEN_VALUE_42';
    const link = `https://app.example.com/reset-password?token=${token}`;
    await sendResetEmail({
      to: 'e@example.com',
      resetLink: link,
      appUrl: 'https://app.example.com',
      transport,
    });
    // 링크에는 토큰이 있지만, 링크 외 텍스트에 토큰 원문이 반복되지 않아야 함
    const textNoLink = transport.calls[0].text.replace(link, '');
    expect(textNoLink).not.toContain(token);
  });
});

describe('개발 환경 fallback (전송기 없을 때)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('transport 미주입 + NODE_ENV=test → 콘솔 출력, 예외 없음', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(
      sendResetEmail({
        to: 'dev@example.com',
        resetLink: 'https://localhost:3000/reset-password?token=devtoken',
        appUrl: 'https://localhost:3000',
      }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});

describe('프로덕션 경로 — NODE_ENV=production + SMTP 환경', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
      delete process.env[k as keyof NodeJS.ProcessEnv];
    }
    Object.assign(process.env, {
      SMTP_HOST: originalEnv.SMTP_HOST,
      SMTP_USER: originalEnv.SMTP_USER,
      SMTP_PASSWORD: originalEnv.SMTP_PASSWORD,
      SMTP_FROM: originalEnv.SMTP_FROM,
    });
  });

  it('NODE_ENV=production → SMTP 전송 경로 호출', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'from@example.com';
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const loader = async () => ({
      createTransport: () => ({ sendMail }),
    });
    await sendResetEmail({
      to: 'prod@example.com',
      resetLink: 'https://app/reset-password?token=t',
      appUrl: 'https://app',
      smtpLoader: loader,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'prod@example.com' }));
  });
});

describe('createSmtpTransport — SMTP 팩토리', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_PORT;
  });

  afterEach(() => {
    // 테스트 간 환경 변수 오염 방지
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_PORT']) {
      delete process.env[k as keyof NodeJS.ProcessEnv];
    }
    Object.assign(process.env, {
      SMTP_HOST: originalEnv.SMTP_HOST,
      SMTP_USER: originalEnv.SMTP_USER,
      SMTP_PASSWORD: originalEnv.SMTP_PASSWORD,
      SMTP_FROM: originalEnv.SMTP_FROM,
      SMTP_PORT: originalEnv.SMTP_PORT,
    });
  });

  it('SMTP 환경 변수 누락 시 에러 throw', async () => {
    await expect(createSmtpTransport()).rejects.toThrow(/SMTP 설정 누락/);
  });

  it('HOST 만 있고 나머지 누락 시 에러 throw', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    await expect(createSmtpTransport()).rejects.toThrow(/SMTP 설정 누락/);
  });

  it('전체 설정 + 가짜 로더 → sendMail 호출로 전송', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'no-reply@example.com';

    const sendMail = vi.fn().mockResolvedValue(undefined);
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const loader = async () => ({ createTransport });

    const transport = await createSmtpTransport(loader);
    await transport.send({ to: 'to@x.com', subject: 's', text: 't' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@example.com',
        to: 'to@x.com',
        subject: 's',
        text: 't',
      }),
    );
  });

  it('PORT=465 → secure:true', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'no-reply@example.com';
    const createTransport = vi.fn().mockReturnValue({ sendMail: vi.fn() });
    const loader = async () => ({ createTransport });
    await createSmtpTransport(loader);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });
});
