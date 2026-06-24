/**
 * attachments-storage 단위 테스트 — SPEC-ATTACHMENT-001 (REQ-ATT-008).
 *
 * saveAttachmentBinary / readAttachmentStream / removeAttachmentBinary.
 * 각 테스트는 os.tmpdir 하위 고유 디렉토리에서 실행 (격리).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveAttachmentBinary,
  readAttachmentStream,
  removeAttachmentBinary,
  resolveStorageDir,
} from './attachments-storage';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'att-store-'));
  process.env.ATTACHMENTS_DIR = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
});

describe('saveAttachmentBinary (REQ-ATT-008)', () => {
  it('버퍼를 저장하고 { storagePath, relativePath } 반환 — 파일명은 UUID 기반', async () => {
    const buf = Buffer.from('hello-world');
    const r = await saveAttachmentBinary(buf, 'png');
    expect(r.storagePath).toBeTruthy();
    expect(r.relativePath).toBeTruthy();
    // 파일명이 UUID 형태 (확장자만 사용자 제공)
    const filename = r.storagePath.split('/').pop() ?? '';
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
    // 실제 파일 존재 + 내용 일치
    expect(existsSync(r.storagePath)).toBe(true);
    expect(readFileSync(r.storagePath)).toEqual(buf);
  });

  it('동일 버퍼 두 번 저장 → 서로 다른 파일명 (UUID 충돌 없음)', async () => {
    const buf = Buffer.from('dup');
    const a = await saveAttachmentBinary(buf, 'pdf');
    const b = await saveAttachmentBinary(buf, 'pdf');
    expect(a.storagePath).not.toBe(b.storagePath);
  });
});

describe('readAttachmentStream (REQ-ATT-008)', () => {
  it('저장된 파일을 ReadableStream 으로 읽기 — 내용 일치', async () => {
    const buf = Buffer.from('stream-content-123');
    const saved = await saveAttachmentBinary(buf, 'png');
    const stream = readAttachmentStream(saved.storagePath);
    expect(typeof stream.read).toBe('function');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(buf);
  });
});

describe('removeAttachmentBinary (REQ-ATT-008)', () => {
  it('저장된 파일 삭제 — 파일 소실', async () => {
    const buf = Buffer.from('to-delete');
    const saved = await saveAttachmentBinary(buf, 'png');
    expect(existsSync(saved.storagePath)).toBe(true);
    removeAttachmentBinary(saved.storagePath);
    expect(existsSync(saved.storagePath)).toBe(false);
  });

  it('미존재 파일 삭제 → 에러 throw 하지 않음 (best-effort 멱등)', () => {
    const ghost = join(testDir, 'never-existed.png');
    expect(() => removeAttachmentBinary(ghost)).not.toThrow();
  });
});

describe('resolveStorageDir (REQ-ATT-008)', () => {
  it('ATTACHMENTS_DIR 환경변수 우선', () => {
    process.env.ATTACHMENTS_DIR = testDir;
    expect(resolveStorageDir()).toBe(testDir);
  });

  it('환경변수 없으면 기본 ./public/uploads', () => {
    delete process.env.ATTACHMENTS_DIR;
    expect(resolveStorageDir()).toBe('./public/uploads');
  });
});
