/**
 * PUT /api/suggestions/[id]/status — SPEC-SUGGEST-001 M7 (처리 상태 변경).
 *
 * ADMIN 전용. 상태 전이 규칙 화이트리스트 검증.
 *   - 미인증 → 401
 *   - 비-ADMIN → 403 (REQ-SUGGEST-034b)
 *   - path UUID 형식 오류 → 400
 *   - 미존재 건의 → 404 (REQ-SUGGEST-033)
 *   - 잘못된 status enum → 422
 *   - 불가능 전이 → 409 (REQ-SUGGEST-032, 현재/요청 상태 포함)
 *   - 성공 → 200 { id, status, updated_at }
 *
 * @MX:WARN: [AUTO] 상태 전이 화이트리스트 — 불허 전이는 409 로 거부 (무결성 유지)
 * @MX:REASON:  접수→완료 스킵 등 불허 전이가 통과되면 처리 절차 무결성 위반. 화이트리스트로 엄격 검증.
 *
 * 전이 규칙 (REQ-SUGGEST-031):
 *   접수 → {처리중, 보류}, 처리중 → {완료, 보류}, 보류 → {처리중, 접수}, 완료 → {접수}(재오픈)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../../lib/db';
import {
  requireAdmin,
  badRequest,
  notFound,
  conflict,
  validationError,
} from '../../../../../lib/rbac';

/** UUID v4 정규식. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 허용 상태값 (REQ-SUGGEST-031). */
const STATUS_VALUES = ['접수', '처리중', '완료', '보류'] as const;
type SuggestionStatus = (typeof STATUS_VALUES)[number];

/** 상태 전이 화이트리스트 맵. */
const ALLOWED_TRANSITIONS: Record<SuggestionStatus, Set<SuggestionStatus>> = {
  접수: new Set<SuggestionStatus>(['처리중', '보류']),
  처리중: new Set<SuggestionStatus>(['완료', '보류']),
  보류: new Set<SuggestionStatus>(['처리중', '접수']),
  완료: new Set<SuggestionStatus>(['접수']), // 재오픈
};

const updateStatusSchema = z.object({
  status: z.enum(STATUS_VALUES),
  reason: z.string().max(500).optional(),
});

interface StatusParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/suggestions/[id]/status — ADMIN 상태 변경 (REQ-SUGGEST-030~034b).
 */
export async function PUT(request: Request, ctx: StatusParams): Promise<Response> {
  // 1. RBAC — ADMIN 전용
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. params + UUID 형식 검증
  const { id: suggestionId } = await ctx.params;
  if (!UUID_REGEX.test(suggestionId)) {
    return badRequest('올바른 건의 ID 가 아닙니다');
  }

  // 3. 본문 파싱 + zod 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = updateStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { status: requestedStatus, reason } = parsed.data;

  // 4. 건의 존재 + 현재 status 조회 — 미존재 404
  const existRes = await query<{ status: string }>(
    'SELECT status FROM suggestions WHERE id = $1',
    [suggestionId],
  );
  if (!existRes.rows[0]) {
    return notFound('존재하지 않는 건의입니다');
  }
  const currentStatus = existRes.rows[0].status as SuggestionStatus;

  // 5. 전이 규칙 검증 — 불허 시 409 (REQ-SUGGEST-032)
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(requestedStatus)) {
    return conflict(
      `현재 상태(${currentStatus})에서 요청 상태(${requestedStatus})로 전이할 수 없습니다`,
    );
  }

  // 6. 상태 갱신 — updated_at 자동 갱신. reason 은 로그 전용(현재 테이블 미저장, 별도 SPEC).
  const upd = await query<{ updated_at: string }>(
    `UPDATE suggestions SET status = $1, updated_at = now() WHERE id = $2
     RETURNING updated_at`,
    [requestedStatus, suggestionId],
  );

  // reason 제공 시 — 현재는 로깅만 (테이블 컬럼 없음). @MX:TODO: 상태 변경 이력 테이블 별도 SPEC.
  if (reason) {
    // no-op: 향후 status_history 테이블 도입 시 기록
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        id: suggestionId,
        status: requestedStatus,
        updated_at: upd.rows[0].updated_at,
      },
    },
    { status: 200 },
  );
}
