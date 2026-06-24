/**
 * 첨부파일 디스크 저장소 — SPEC-ATTACHMENT-001 (REQ-ATT-008).
 *
 * 로컬 파일시스템 계층. ATTACHMENTS_DIR 환경변수(기본 ./public/uploads) 하위에 UUID 기반
 * 파일명으로 바이너리를 저장. 사용자 제공 파일명은 디스크 경로에 절대 사용하지 않는다
 * (경로 순회 방어 — REQ-ATT-008).
 *
 * 메타데이터는 DB 에 저장되고 바이너리만 디스크에 존재 → 향후 클라우드 스토리지(S3/Supabase)
 * 이전 시 본 계층만 교체하면 DB 는 동일 유지.
 *
 * @MX:WARN: [AUTO] 디스크 I/O + 경로 구성 — path traversal 방어 필수
 * @MX:REASON:  사용자 제공 original_filename 을 디스크 경로에 직접 사용하면 ../traversal 또는
 *             절대경로 주입으로 임의 파일 겹쳐쓰기 가능. UUID v4 파일명으로 원천 차단.
 */

import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join, isAbsolute, relative } from 'node:path';
import { Readable } from 'node:stream';

/** 기본 저장소 루트 (ATTACHMENTS_DIR 미설정 시). */
const DEFAULT_DIR = './public/uploads';

/**
 * 저장소 디렉토리 해석 — ATTACHMENTS_DIR 환경변수 우선, 없으면 기본값.
 * 디렉토리가 없으면 생성(mkdir recursive).
 */
export function resolveStorageDir(): string {
  const dir = process.env.ATTACHMENTS_DIR ?? DEFAULT_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface SaveResult {
  /** 디스크 절대/상대 저장 경로 (DB storage_path 컬럼용). */
  storagePath: string;
  /** 클라이언트 다운로드/참조용 상대 경로 (옵션). */
  relativePath: string;
}

/**
 * 버퍼를 디스크에 저장. 파일명은 `randomUUID().${ext}` 형태 (사용자 파일명 미사용).
 * @param buffer 파일 바이너리
 * @param ext 확장자 (png/jpeg/pdf/hwp/docx 등 — 화이트리스트 검증된 값)
 */
export async function saveAttachmentBinary(
  buffer: Buffer,
  ext: string,
): Promise<SaveResult> {
  const dir = resolveStorageDir();
  const filename = `${randomUUID()}.${ext.toLowerCase()}`;
  const abs = resolve(dir, filename);

  // 경로 순회 방어 — 결과 경로가 반드시 dir 하위인지 확인
  ensureWithin(abs, dir);

  return new Promise<SaveResult>((resolveFn, reject) => {
    const ws = createWriteStream(abs);
    ws.on('error', reject);
    ws.on('finish', () => {
      resolveFn({ storagePath: abs, relativePath: filename });
    });
    ws.end(buffer);
  });
}

/**
 * 저장된 파일을 읽기 위한 Node.js ReadableStream 반환. 다운로드 응답 스트리밍용.
 */
export function readAttachmentStream(storagePath: string): Readable {
  return createReadStream(storagePath);
}

/**
 * 디스크 파일 제거 (best-effort). 미존재 시 에러 throw 하지 않음 — cascade 호출자가
 * post-commit cleanup 시 디스크 누락은 정상(REQ-ATT-016 모니터링 대상)이므로 멱등 처리.
 */
export function removeAttachmentBinary(storagePath: string): void {
  try {
    unlinkSync(storagePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      throw err;
    }
    // ENOENT 는 조용히 무시 (이미 없음)
  }
}

/**
 * 대상 경로가 base 디렉토리 하위에 있는지 검증 (path traversal 방어).
 * 절대 경로이거나 base 외부로 벗어나면 throw.
 *
 * @MX:NOTE: [AUTO] 내부 헬퍼 — saveAttachmentBinary 만 호출. 파일명은 항상 UUID 이므로
 *           실제로는 traversal 불가능하나, 방어막으로 추가 (심층 보안).
 */
function ensureWithin(target: string, base: string): void {
  if (isAbsolute(target)) {
    const rel = relative(resolve(base), target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('storage path escapes base directory');
    }
  }
}

/** 테스트/디버그용 — 파일 존재 + 크기 확인 (REQ-ATT-016 디스크 소실 감지). */
export function fileStat(storagePath: string): { size: number } {
  const s = statSync(storagePath);
  return { size: s.size };
}
