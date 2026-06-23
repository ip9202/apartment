/**
 * PARKING 도메인 로컬 RBAC 헬퍼 테스트 — parking-rbac.ts (SPEC-PARKING-001).
 *
 * REQ-PK-004/010/025 (401 미인증), REQ-PK-005/019/022 (403 역할),
 * REQ-PK-023/024 (역할별 가시성 필터링).
 *
 * 본 테스트는 requireAuthenticated 의 401/성공 경로와 filterAllocationsByRole
 * 의 역할별 필터링 로직을 단정한다. 실제 DB 기반 인증은 route 통합 테스트에서 검증.
 */

import { describe, it, expect } from 'vitest';
import { filterAllocationsByRole, canSeeAll } from './parking-rbac';

interface Alloc {
  unit_id: string;
  building: string;
  assigned_slot: string;
}

const ALL: Alloc[] = [
  { unit_id: 'u1', building: 'A동', assigned_slot: 'S1' },
  { unit_id: 'u2', building: 'A동', assigned_slot: 'S2' },
  { unit_id: 'u3', building: 'B동', assigned_slot: 'S3' },
];

describe('filterAllocationsByRole — 공개 회차 (is_published=true, REQ-PK-023-a)', () => {
  it('RESIDENT 는 본인 unit 만', () => {
    const r = filterAllocationsByRole({
      role: 'RESIDENT',
      unitId: 'u1',
      managedBuildingId: null,
      isPublished: true,
      allocations: ALL,
    });
    expect(r).toEqual([{ unit_id: 'u1', building: 'A동', assigned_slot: 'S1' }]);
  });

  it('AUDITOR 는 본인 unit 만 (RESIDENT 동일)', () => {
    const r = filterAllocationsByRole({
      role: 'AUDITOR',
      unitId: 'u2',
      managedBuildingId: null,
      isPublished: true,
      allocations: ALL,
    });
    expect(r.map((a) => a.unit_id)).toEqual(['u2']);
  });

  it('REP 는 담당동 building 만', () => {
    const r = filterAllocationsByRole({
      role: 'REP',
      unitId: 'u1',
      managedBuildingId: 'B동',
      isPublished: true,
      allocations: ALL,
    });
    expect(r.map((a) => a.unit_id)).toEqual(['u3']);
  });

  it('CHAIR 는 전체', () => {
    const r = filterAllocationsByRole({
      role: 'CHAIR',
      unitId: 'u1',
      managedBuildingId: null,
      isPublished: true,
      allocations: ALL,
    });
    expect(r).toHaveLength(3);
  });

  it('ADMIN 은 전체', () => {
    const r = filterAllocationsByRole({
      role: 'ADMIN',
      unitId: null,
      managedBuildingId: null,
      isPublished: true,
      allocations: ALL,
    });
    expect(r).toHaveLength(3);
  });
});

describe('filterAllocationsByRole — 미공개 회차 (is_published=false, REQ-PK-023-b/024)', () => {
  it('RESIDENT 는 본인 unit 만 (타인 존재 여부 누출 금지)', () => {
    const r = filterAllocationsByRole({
      role: 'RESIDENT',
      unitId: 'u1',
      managedBuildingId: null,
      isPublished: false,
      allocations: ALL,
    });
    expect(r.map((a) => a.unit_id)).toEqual(['u1']);
  });

  it('RESIDENT 본인 assignment 없으면 빈 목록 (정보은닉)', () => {
    const r = filterAllocationsByRole({
      role: 'RESIDENT',
      unitId: 'uX',
      managedBuildingId: null,
      isPublished: false,
      allocations: ALL,
    });
    expect(r).toEqual([]);
  });

  it('REP 도 미공개 시 본인 unit 만 (담당동特权 없음)', () => {
    const r = filterAllocationsByRole({
      role: 'REP',
      unitId: 'u1',
      managedBuildingId: 'B동',
      isPublished: false,
      allocations: ALL,
    });
    expect(r.map((a) => a.unit_id)).toEqual(['u1']);
  });

  it('ADMIN 미공개 시 전체 (관리 목적)', () => {
    const r = filterAllocationsByRole({
      role: 'ADMIN',
      unitId: null,
      managedBuildingId: null,
      isPublished: false,
      allocations: ALL,
    });
    expect(r).toHaveLength(3);
  });

  it('CHAIR 미공개 시 전체', () => {
    const r = filterAllocationsByRole({
      role: 'CHAIR',
      unitId: 'u1',
      managedBuildingId: null,
      isPublished: false,
      allocations: ALL,
    });
    expect(r).toHaveLength(3);
  });
});

describe('canSeeAll — 권한 판정 헬퍼', () => {
  it('ADMIN/CHAIR 만 true', () => {
    expect(canSeeAll('ADMIN')).toBe(true);
    expect(canSeeAll('CHAIR')).toBe(true);
    expect(canSeeAll('REP')).toBe(false);
    expect(canSeeAll('RESIDENT')).toBe(false);
    expect(canSeeAll('AUDITOR')).toBe(false);
  });
});
