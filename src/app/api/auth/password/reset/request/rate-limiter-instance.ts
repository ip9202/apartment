/**
 * 재설정 요청 Rate Limiter 프로세스 싱글턴 — SPEC-AUTH-RESET-001 (REQ-RESET-003).
 *
 * route.ts 가 import 하는 단일 in-memory limiter. 모듈 캐시로 인해 프로세스 생명 주기
 * 동안 상태가 유지된다. 향후 Redis 등 외부 저장으로 교체 시 본 파일만 변경.
 */

import { createResetRateLimiter, type ResetRateLimiter } from '../../../../../../lib/reset-rate-limit';

export const resetRateLimiter: ResetRateLimiter = createResetRateLimiter();
