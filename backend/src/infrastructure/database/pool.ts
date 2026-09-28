import pg from 'pg';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { FailureSimulator } from '../resilience/FailureSimulator.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';

export type Db = {
  pool: pg.Pool;
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
  withTransaction: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createDatabase(
  env: Pick<Env, 'DATABASE_URL' | 'DB_POOL_MAX'>,
  logger: Logger,
  failures: FailureSimulator,
): Db {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected Postgres pool error');
  });

  const query: Db['query'] = async (text, params) => {
    if (failures.shouldFailDatabase()) {
      throw new ServiceUnavailableError('Simulated database failure');
    }
    return pool.query(text, params);
  };

  const withTransaction: Db['withTransaction'] = async (fn) => {
    if (failures.shouldFailDatabase()) {
      throw new ServiceUnavailableError('Simulated database failure');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    pool,
    query,
    withTransaction,
    close: async () => {
      await pool.end();
      logger.info('Postgres pool closed');
    },
  };
}
