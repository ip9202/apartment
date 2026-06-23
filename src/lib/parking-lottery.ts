/**
 * 결정론적 순열 알고리즘 — HMAC-SHA256 PRNG + Fisher-Yates (SPEC-PARKING-001).
 *
 * REQ-PK-006 (추첨 seed 순열), REQ-PK-015 (자동배정 동일 순열),
 * REQ-PK-026/027 (투명성 공개 + 재현 검증).
 *
 * 동일 seed_value + 동일 정렬 unit 목록 + 동일 slot_pool → 항상 동일 unit→slot 배정.
 * HMAC-SHA256 을 PRNG로 사용: 동일 key(seed)로 동일 난수 스트림 보장.
 *
 * @MX:ANCHOR: [AUTO] generatePermutation — fan_in=3 (M2 추첨, M4 자동배정, M5 투명성공개)
 * @MX:REASON:  결정론 불변 계약. 본 함수 시그니처/PRNG 알고리즘 변경 시 모든 과거 회차
 *             배정 결과가 달라져 투명성 공정성이 붕괴. REQ-PK-027 재현 검증 보증의 핵심.
 *
 * @MX:NOTE: [AUTO] slot assignment 도메인 — win/lose 추첨 아님. 모든 unit 은 정확히 1 slot 배정.
 *           순서 무관 — 먼저/나중 추첨 버튼이든 동일 결과.
 */

import { createHmac } from 'node:crypto';

/** 순열 입력 unit — 정렬 기준(sort_key) 과 식별자(unit_id) 분리. */
export interface PermutationUnit {
  unit_id: string;
  sort_key: string;
}

/** 순열 결과 — unit→slot 매핑 1건. */
export interface PermutationEntry {
  unit_id: string;
  slot: string;
}

/**
 * HMAC-SHA256 기반 PRNG — 동일 seed 로 동일 난수 스트림 생성.
 * Fisher-Yates 에서 i 번째 인덱스 결정 시 호출.
 */
function makePrng(seed: string): () => number {
  let counter = 0;
  return () => {
    // counter 를 4바이트 BE 로 직렬화 → HMAC 메시지. 동일 seed+counter → 동일 바이트.
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(counter++, 0);
    const digest = createHmac('sha256', seed).update(buf).digest();
    // 상위 4바이트를 부호없는 정수로 변환 → [0,1) 로 정규화
    const val = digest.readUInt32BE(0);
    return val / 0x100000000;
  };
}

/**
 * 결정론적 unit→slot 순열 산출.
 *
 * 1. units 를 sort_key 오름차순 정렬 (입력 순서 무관화).
 * 2. slots 를 사전순 정렬 (자리풀 입력 순서 무관화).
 * 3. Fisher-Yates shuffle 로 units 순서를 섞음 (HMAC-SHA256 PRNG 사용).
 * 4. 섞인 units[i] → sorted_slots[i] 매핑.
 *
 * units.length > slots.length 이면 slot assignment 불변 위반 → throw.
 *
 * @MX:WARN: [AUTO] units.length > slots.length 시 throw — 도메인 불변 "탈락자 없음" 방어.
 * @MX:REASON: REQ-PK-018. 정상 흐름(REQ-PK-003 사전 검증)에서는 도달 불가하나 방어적 불변 수호.
 */
export function generatePermutation(
  seed: string,
  units: ReadonlyArray<PermutationUnit>,
  slotPool: ReadonlyArray<string>,
): PermutationEntry[] {
  if (units.length === 0) {
    return [];
  }
  if (units.length > slotPool.length) {
    throw new Error(
      `slot 부족: units=${units.length} slots=${slotPool.length} (slot assignment 불변 위반)`,
    );
  }

  // 1. 정렬 (입력 순서 무관화) — 복사본 생성하여 원본 불변
  const sortedUnits = [...units].sort((a, b) =>
    a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0,
  );
  const sortedSlots = [...slotPool].sort();

  // 2. Fisher-Yates shuffle (HMAC-SHA256 PRNG)
  const prng = makePrng(seed);
  for (let i = sortedUnits.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [sortedUnits[i], sortedUnits[j]] = [sortedUnits[j], sortedUnits[i]];
  }

  // 3. unit[i] → slot[i] 매핑
  return sortedUnits.map((u, i) => ({ unit_id: u.unit_id, slot: sortedSlots[i] }));
}
