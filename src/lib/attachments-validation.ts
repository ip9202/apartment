/**
 * 첨부파일 검증 — SPEC-ATTACHMENT-001 (REQ-ATT-005/008/022/023/024/025).
 *
 * 순수 함수 모듈 (DB/파일시스템 의존 없음). upload route 가 호출.
 *   1. MIME 화이트리스트(PNG/JPG/JPEG/WEBP/PDF/HWP/DOCX) 교차 검증
 *   2. 확장자 화이트리스트 일치 검증
 *   3. 매직 바이트 시그니처 교차 검증 (HWP 예외 — 표준 시그니처 부재)
 *   4. 파일 크기 <= 10MB (10485760 bytes)
 *
 * @MX:ANCHOR: [AUTO] 첨부 검증 불변 진입점 — fan_in=2 (notices/[id]/attachments, suggestions/[id]/attachments)
 * @MX:REASON:  MIME/확장자/매직바이트 3중 교차 검증을 한 곳 누락하면 스푸핑 업로드로 이어짐 (REQ-ATT-022).
 *             본 모듈을 단일 진실 원천으로 취급.
 *
 * @MX:NOTE: [AUTO] HWP 매직바이트 예외 — HWP 파일은 공식 표준 시그니처가 없어(버전별 상이)
 *           매직바이트 검증을 스킵하고 확장자(.hwp) + 선언 MIME(application/x-hwp|application/hwp)
 *           만으로 검증한다. 다른 모든 유형은 매직바이트 일치 필수 (CRITICAL decision #2).
 */

/** 파일당 최대 크기 — 10MB (REQ-ATT-023). */
export const MAX_SIZE_BYTES = 10485760;

/** 게시물당 최대 첨부 수 (REQ-ATT-024). */
export const MAX_PER_POST = 5;

/** 확장자 → 허용 MIME 맵. 대소문자 무관 비교를 위해 lowercase 키. */
const EXT_TO_MIMES: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  hwp: ['application/x-hwp', 'application/hwp'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

/** 매직 바이트 시그니처 테이블 (확장자 → hex prefix). HWP 제외 (비표준). */
const MAGIC_BYTES: Record<string, string> = {
  png: '89504E47',
  jpg: 'FFD8FF',
  jpeg: 'FFD8FF',
  webp: '52494646', // "RIFF"
  pdf: '25504446', // "%PDF"
  docx: '504B0304', // ZIP local file header
};

/** 파일명에서 확장자 추출 (소문자, 점 제외). 확장자 없으면 빈 문자열. */
function extractExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/** 확장자가 화이트리스트에 포함되는지 (대소문자 무관). */
export function isAllowedExtension(filename: string): boolean {
  const ext = extractExt(filename);
  return ext in EXT_TO_MIMES;
}

export interface ValidateInput {
  declaredMime: string;
  filename: string;
  size: number;
  buffer: Buffer;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; status: 422; message: string };

/**
 * 첨부 파일 1건 검증 — MIME/확장자/매직바이트/크기 교차.
 * 위반 시 { ok: false, status: 422, message } 반환 (route 가 그대로 validationError 로 매핑).
 */
export function validateAttachment(input: ValidateInput): ValidateResult {
  const { declaredMime, filename, size, buffer } = input;

  // 1. 크기 (REQ-ATT-023): 0 초과 10MB 이하
  if (size <= 0) {
    return { ok: false, status: 422, message: '파일 크기가 0 바이트입니다' };
  }
  if (size > MAX_SIZE_BYTES) {
    return { ok: false, status: 422, message: `파일 크기가 ${MAX_SIZE_BYTES} 바이트를 초과합니다` };
  }

  // 2. 확장자 (REQ-ATT-005)
  const ext = extractExt(filename);
  if (!(ext in EXT_TO_MIMES)) {
    return { ok: false, status: 422, message: '허용되지 않은 파일 확장자입니다' };
  }
  const allowedMimes = EXT_TO_MIMES[ext];

  // 3. 선언 MIME 과 확장자-허용-MIME 일치 (REQ-ATT-022 — MIME/확장자 불일치 거부)
  if (!allowedMimes.includes(declaredMime.toLowerCase())) {
    return { ok: false, status: 422, message: '선언된 MIME 타입이 확장자와 일치하지 않습니다' };
  }

  // 4. 매직 바이트 (REQ-ATT-022) — HWP 예외 (CRITICAL #2)
  if (ext !== 'hwp') {
    const expectedHex = MAGIC_BYTES[ext];
    if (expectedHex) {
      const expectedBytes = Buffer.from(expectedHex, 'hex');
      const actual = buffer.subarray(0, expectedBytes.length);
      if (!actual.equals(expectedBytes)) {
        return { ok: false, status: 422, message: '파일 시그니처가 선언된 유형과 일치하지 않습니다' };
      }
    }
  }

  return { ok: true };
}
