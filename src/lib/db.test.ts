import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query, withTransaction } from './db';

const TEST_TABLE = 'test_tx_marker';

beforeAll(async () => {
  // 단순 트랜잭션 테스트용 임시 테이블
  await query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
  await query(`CREATE TABLE ${TEST_TABLE} (id SERIAL PRIMARY KEY, val TEXT NOT NULL)`);
});

beforeEach(async () => {
  await query(`DELETE FROM ${TEST_TABLE}`);
});

afterAll(async () => {
  await query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
  await pool.end();
});

describe('db.ts — PostgreSQL Pool 싱글턴', () => {
  it('pool.query("SELECT 1") 가 1을 반환한다', async () => {
    const res = await pool.query('SELECT 1 AS one');
    expect(res.rows[0].one).toBe(1);
  });

  it('query 헬퍼로 SELECT 1 을 실행할 수 있다', async () => {
    const res = await query('SELECT $1::int AS n', [42]);
    expect(res.rows[0].n).toBe(42);
  });

  it('동일 모듈을 재 import 해도 pool 인스턴스는 동일하다 (싱글턴)', async () => {
    const mod = await import('./db');
    expect(mod.pool).toBe(pool);
  });
});

describe('db.ts — withTransaction', () => {
  it('성공 시 커밋되어 데이터가 영속된다', async () => {
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO ${TEST_TABLE} (val) VALUES ($1)`, ['committed']);
    });
    const res = await query(`SELECT val FROM ${TEST_TABLE}`);
    expect(res.rows.map((r) => r.val)).toEqual(['committed']);
  });

  it('fn 이 throw 하면 롤백되어 부분 쓰기가 남지 않는다', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TEST_TABLE} (val) VALUES ($1)`, ['should-rollback']);
        throw new Error('intentional failure');
      }),
    ).rejects.toThrow('intentional failure');

    const res = await query(`SELECT val FROM ${TEST_TABLE}`);
    expect(res.rows.find((r) => r.val === 'should-rollback')).toBeUndefined();
  });
});
