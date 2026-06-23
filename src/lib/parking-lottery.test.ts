/**
 * 결정론적 순열 알고리즘 테스트 — parking-lottery.ts (SPEC-PARKING-001).
 *
 * REQ-PK-006 (추첨 시 seed 순열 산출), REQ-PK-015 (자동배정 동일 순열),
 * REQ-PK-026/027 (재현 검증 — 동일 seed+입력 → 동일 결과).
 *
 * @MX:ANCHOR: [AUTO] generatePermutation 결정론 보증 — 동일 입력 → 동일 출력 회귀 방어
 * @MX:REASON:  재현 검증 가능성(PARKING-07)의 기반. PRNG/HMAC/Fisher-Yates 시그니처 변경 시
 *             모든 과거 회차 배정 결과가 달라지면 투명성 공정성이 붕괴된다.
 */

import { describe, it, expect } from 'vitest';
import { generatePermutation } from './parking-lottery';

const UNITS = [
  { unit_id: 'u1', sort_key: 'A-101' },
  { unit_id: 'u2', sort_key: 'A-102' },
  { unit_id: 'u3', sort_key: 'A-103' },
  { unit_id: 'u4', sort_key: 'B-101' },
];

const SLOTS = ['S1', 'S2', 'S3', 'S4'];
const SEED = 'dGVzdC1zZWVkLTE2Ynl0ZXM='; // base64

describe('generatePermutation — 결정론성 (REQ-PK-027)', () => {
  it('동일 seed+units+slot_pool → 동일 결과 (재현 가능)', () => {
    const r1 = generatePermutation(SEED, UNITS, SLOTS);
    const r2 = generatePermutation(SEED, UNITS, SLOTS);
    expect(r1).toEqual(r2);
  });

  it('다른 seed → 다른 결과 (확률적으로)', () => {
    const r1 = generatePermutation(SEED, UNITS, SLOTS);
    const r2 = generatePermutation('b3RoZXItc2VlZC0xNmJ5dGVz', UNITS, SLOTS);
    // 극히 낮은 확률 제외하고 다름
    expect(r1).not.toEqual(r2);
  });
});

describe('generatePermutation — 불변 계약', () => {
  it('모든 unit 이 정확히 1개 slot 에 배정된다 (탈락자 없음)', () => {
    const result = generatePermutation(SEED, UNITS, SLOTS);
    expect(result).toHaveLength(UNITS.length);
    const assignedUnits = result.map((r) => r.unit_id).sort();
    expect(assignedUnits).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('모든 slot 이 정확히 1회 사용된다 (중복 없음)', () => {
    const result = generatePermutation(SEED, UNITS, SLOTS);
    const usedSlots = result.map((r) => r.slot).sort();
    expect(usedSlots).toEqual([...SLOTS].sort());
  });

  it('입력 units 순서와 무관하게 동일 결과 (정렬 후 순열)', () => {
    const shuffled = [...UNITS].reverse();
    const r1 = generatePermutation(SEED, UNITS, SLOTS);
    const r2 = generatePermutation(SEED, shuffled, SLOTS);
    expect(r1).toEqual(r2);
  });

  it('입력 slot_pool 순서와 무관하게 동일 결과 (정렬 후 순열)', () => {
    const reversedSlots = [...SLOTS].reverse();
    const r1 = generatePermutation(SEED, UNITS, SLOTS);
    const r2 = generatePermutation(SEED, UNITS, reversedSlots);
    // slot_pool 정렬 기준은 알고리즘 내부; 결과 매핑은 동일해야 함
    expect(r1).toEqual(r2);
  });
});

describe('generatePermutation — 엣지 케이스', () => {
  it('units 수 > slot 수 시 에러 (slot assignment 불변 위반)', () => {
    expect(() => generatePermutation(SEED, UNITS, ['S1', 'S2'])).toThrow();
  });

  it('units 수 == slot 수 정상 동작', () => {
    const result = generatePermutation(SEED, UNITS, SLOTS);
    expect(result).toHaveLength(4);
  });

  it('units 수 < slot 수 정상 동작 (남는 slot 미사용)', () => {
    const extraSlots = [...SLOTS, 'S5', 'S6'];
    const result = generatePermutation(SEED, UNITS, extraSlots);
    expect(result).toHaveLength(UNITS.length);
    const usedSlots = result.map((r) => r.slot);
    expect(new Set(usedSlots).size).toBe(UNITS.length); // 중복 없음
  });

  it('단일 unit/slot 정상 동작', () => {
    const result = generatePermutation(SEED, [{ unit_id: 'u1', sort_key: 'A-101' }], ['S1']);
    expect(result).toEqual([{ unit_id: 'u1', slot: 'S1' }]);
  });

  it('빈 units 정상 동작 (빈 결과)', () => {
    const result = generatePermutation(SEED, [], SLOTS);
    expect(result).toEqual([]);
  });
});
