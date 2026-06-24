/**
 * attachments-validation 단위 테스트 — SPEC-ATTACHMENT-001 (REQ-ATT-005/008/022/023/025).
 *
 * 순수 함수 단위 테스트 (DB/파일시스템 의존 없음).
 * - MIME 화이트리스트 + 확장자 + 매직 바이트 교차 검증
 * - 파일 크기 경계 (10MB 정확히 허용, +1 byte 거부)
 * - 스푸핑(선언 MIME ≠ 실제 시그니처) 거부
 * - HWP 예외 (매직 바이트 스킵, 확장자 + 선언 MIME 만 검사)
 * - 경로 순회 파일명(newFilename 은 UUID 기반이므로 원본 파일명은 보존만)
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_SIZE_BYTES,
  MAX_PER_POST,
  validateAttachment,
  isAllowedExtension,
} from './attachments-validation';

// 헬퍼: 매직 바이트 시그니처로 Buffer 생성
function buf(hex: string, padLen = 16): Buffer {
  const prefix = Buffer.from(hex, 'hex');
  const pad = Buffer.alloc(Math.max(0, padLen - prefix.length), 0);
  return Buffer.concat([prefix, pad]);
}

describe('MAX_SIZE_BYTES / MAX_PER_POST 상수 (REQ-ATT-005/023/024)', () => {
  it('MAX_SIZE_BYTES = 10MB = 10485760', () => {
    expect(MAX_SIZE_BYTES).toBe(10485760);
  });
  it('MAX_PER_POST = 5', () => {
    expect(MAX_PER_POST).toBe(5);
  });
});

describe('validateAttachment — MIME/확장자/매직바이트 교차 검증 (REQ-ATT-005/022/025)', () => {
  it('PNG: 선언 MIME=image/png + .png + PNG 시그니처 → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'a.png',
      size: 100,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(true);
  });

  it('JPEG: image/jpeg + .jpg + FFD8FF → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'image/jpeg',
      filename: 'b.jpg',
      size: 200,
      buffer: buf('FFD8FF'),
    });
    expect(r.ok).toBe(true);
  });

  it('JPEG (.jpeg 확장자 변형) → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'image/jpeg',
      filename: 'b.jpeg',
      size: 200,
      buffer: buf('FFD8FF'),
    });
    expect(r.ok).toBe(true);
  });

  it('WEBP: image/webp + .webp + RIFF → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'image/webp',
      filename: 'c.webp',
      size: 300,
      buffer: buf('52494646'),
    });
    expect(r.ok).toBe(true);
  });

  it('PDF: application/pdf + .pdf + %PDF → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'application/pdf',
      filename: 'd.pdf',
      size: 400,
      buffer: buf('25504446'),
    });
    expect(r.ok).toBe(true);
  });

  it('DOCX: application/vnd.openxmlformats... + .docx + ZIP(504B0304) → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'e.docx',
      size: 500,
      buffer: buf('504B0304'),
    });
    expect(r.ok).toBe(true);
  });

  it('HWP 예외: application/x-hwp + .hwp → 매직바이트 스킵, 통과 (REQ-ATT-022 완화)', () => {
    // HWP 매직바이트 비표준 → 임의 버퍼여도 확장자+MIME 일치 시 통과
    const r = validateAttachment({
      declaredMime: 'application/x-hwp',
      filename: 'f.hwp',
      size: 600,
      buffer: buf('00000000'),
    });
    expect(r.ok).toBe(true);
  });

  it('HWP (application/hwp 변형 MIME) → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'application/hwp',
      filename: 'g.hwp',
      size: 600,
      buffer: buf('00000000'),
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateAttachment — 스푸핑 거부 (REQ-ATT-022)', () => {
  it('선언 MIME=image/png 이지만 시그니처=JPEG → 422', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'spoof.png',
      size: 100,
      buffer: buf('FFD8FF'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it('선언 MIME=application/pdf 이지만 시그니처=PNG → 422', () => {
    const r = validateAttachment({
      declaredMime: 'application/pdf',
      filename: 'spoof.pdf',
      size: 100,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it('확장자 .png 이지만 선언 MIME=application/pdf → 422 (MIME/확장자 불일치)', () => {
    const r = validateAttachment({
      declaredMime: 'application/pdf',
      filename: 'mismatch.png',
      size: 100,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateAttachment — 화이트리스트 외 유형 거부 (REQ-ATT-025)', () => {
  it('선언 MIME=text/plain + .txt → 422', () => {
    const r = validateAttachment({
      declaredMime: 'text/plain',
      filename: 'x.txt',
      size: 10,
      buffer: buf('00000000'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it('선언 MIME=application/octet-stream + .exe → 422', () => {
    const r = validateAttachment({
      declaredMime: 'application/octet-stream',
      filename: 'evil.exe',
      size: 10,
      buffer: buf('4D5A'),
    });
    expect(r.ok).toBe(false);
  });

  it('확장자 없음 → 422', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'noext',
      size: 10,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateAttachment — 크기 경계 (REQ-ATT-023)', () => {
  it('size = 0 → 422', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'a.png',
      size: 0,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it('size = 10485760 (정확히 10MB) → 통과', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'a.png',
      size: 10485760,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(true);
  });

  it('size = 10485761 (10MB + 1) → 422', () => {
    const r = validateAttachment({
      declaredMime: 'image/png',
      filename: 'a.png',
      size: 10485761,
      buffer: buf('89504E47'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
});

describe('isAllowedExtension (REQ-ATT-005)', () => {
  it('화이트리스트 확장자 true/false', () => {
    expect(isAllowedExtension('a.png')).toBe(true);
    expect(isAllowedExtension('a.PDF')).toBe(true); // 대소문자 무관
    expect(isAllowedExtension('a.hwp')).toBe(true);
    expect(isAllowedExtension('a.docx')).toBe(true);
    expect(isAllowedExtension('a.txt')).toBe(false);
    expect(isAllowedExtension('a.exe')).toBe(false);
  });
});
