/**
 * 마이그레이션 테스트 헬퍼 — TEST_DATABASE_URL 기반.
 *
 * 각 마이그레이션 테스트는 (1) 기존 테이블을 역의존성 순서로 DROP 하고,
 * (2) 대상 SQL 파일을 적용한 뒤, (3) information_schema 로 스키마를 단정한다.
 * 이 헬퍼는 파일 읽기/적용과 검증 유틸리티를 제공한다.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { env } from './env';

export const migrationsDir = resolve(process.cwd(), 'migrations');

export function readMigration(filename: string): string {
  return readFileSync(resolve(migrationsDir, filename), 'utf8');
}

/** AUTH 도메인 전체 테이블을 역의존성 순서로 DROP (테스트 격리용). */
const AUTH_TABLES_IN_REVERSE = [
  'suggestions',
  'login_attempts',
  'revoked_refresh_tokens',
  'users',
  'roles',
  'units',
  'buildings',
];

export async function dropAllAuthTables(pool: Pool): Promise<void> {
  for (const table of AUTH_TABLES_IN_REVERSE) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

/** 단일 SQL 파일을 풀을 통해 실행. */
export async function applySql(pool: Pool, sql: string): Promise<void> {
  await pool.query(sql);
}

/**
 * information_schema.columns 기반 컬럼 존재/타입 단정 유틸리티.
 */
export interface ColumnSpec {
  table: string;
  column: string;
  dataType?: string; // e.g. 'uuid', 'character varying', 'integer', 'timestamp with time zone'
  isNullable?: boolean;
}

export async function assertColumnsExist(
  pool: Pool,
  specs: ColumnSpec[],
): Promise<void> {
  for (const spec of specs) {
    const res = await pool.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [spec.table, spec.column],
    );
    if (res.rowCount === 0) {
      throw new Error(`컬럼 누락: ${spec.table}.${spec.column}`);
    }
    const row = res.rows[0] as { data_type: string; is_nullable: string };
    if (spec.dataType && row.data_type !== spec.dataType) {
      throw new Error(
        `${spec.table}.${spec.column} 타입 불일치: 기대=${spec.dataType} 실제=${row.data_type}`,
      );
    }
    if (spec.isNullable !== undefined) {
      const nullable = row.is_nullable === 'YES';
      if (spec.isNullable !== nullable) {
        throw new Error(
          `${spec.table}.${spec.column} NULL 허용 불일치: 기대=${spec.isNullable} 실제=${nullable}`,
        );
      }
    }
  }
}

/** 테이블 존재 여부 조회. */
export async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 인덱스 존재 여부 조회 (인덱스명 기준). */
export async function indexExists(pool: Pool, indexName: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [indexName],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 외래키 제약 존재 여부 조회 (제약명 기준). */
export async function foreignKeyExists(
  pool: Pool,
  constraintName: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND constraint_name = $1 AND constraint_type = 'FOREIGN KEY'`,
    [constraintName],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 마이그레이션 통합 테스트용 공유 풀 팩토리.
 * TEST_DATABASE_URL 사용 — vitest.setup.ts 가 DATABASE_URL 을 치환하므로 env.DATABASE_URL 참조.
 */
export function createTestPool(): Pool {
  const connStr = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  return new Pool({ connectionString: connStr });
}
