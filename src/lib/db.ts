/**
 * PostgreSQL 연결 풀 (pg) + 트랜잭션 헬퍼.
 *
 * 모든 DB 접근 경로의 기반 계층. 싱글턴 Pool 을 노출하여 커넥션을 재사용하고,
 * withTransaction 으로 다중 문 트랜잭션의 원자성을 보장한다.
 *
 * @MX:ANCHOR: [AUTO] 모든 인증/도메인 쿼리의 진입점 — fan_in >= 3 (auth, rate-limit, migrations, routes)
 * @MX:REASON: Pool/withTransaction 시그니처 변경 시 모든 호출자에 파급 → 불변 계약으로 취급
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on('error', (err) => {
  // 풀 수준의 유휴 클라이언트 에러 — 프로세스 종료를 유발하지 않도록 로깅만 수행.
  console.error('[db] 예상치 못한 풀 에러:', err.message);
});

/** 쿼리 헬퍼 — 풀에서 클라이언트를 빌려 1회 쿼리 후 반납. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * 단일 트랜잭션 내에서 fn 을 실행.
 * - fn 이 정상 반환하면 COMMIT.
 * - fn 이 throw 하면 ROLLBACK 후 에러 재전파.
 * 어떤 경우에도 클라이언트는 풀로 반환된다.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK 실패는 이미 치명적 상태 — 원본 에러를 보존.
    }
    throw err;
  } finally {
    client.release();
  }
}
