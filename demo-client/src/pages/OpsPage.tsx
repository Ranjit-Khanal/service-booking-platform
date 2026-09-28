// SPDX-License-Identifier: AGPL-3.0-only
import { FormEvent, useEffect, useState } from 'react';
import { fetchHealth, getFailures, postAdminFailures } from '@/api/admin';
import { ApiError } from '@/api/client';
import type { FailureFlags } from '@/api/types';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { useAsync } from '@/hooks/useAsync';

const DEFAULT_FLAGS: FailureFlags = {
  failPayment: false,
  failRedis: false,
  failDatabase: false,
  failBrokerPublish: false,
  paymentLatencyMs: 0,
};

export function OpsPage() {
  const { data: health, error: healthError, loading: healthLoading, reload } = useAsync(
    () => fetchHealth(),
    [],
  );

  const [flags, setFlags] = useState<FailureFlags>(DEFAULT_FLAGS);
  const [failureResult, setFailureResult] = useState<string | null>(null);
  const [failureError, setFailureError] = useState<string | null>(null);
  const [failureLoading, setFailureLoading] = useState(false);

  useEffect(() => {
    getFailures()
      .then((f) => setFlags({ ...DEFAULT_FLAGS, ...f }))
      .catch(() => undefined);
  }, []);

  async function handleFailureSubmit(event: FormEvent) {
    event.preventDefault();
    setFailureError(null);
    setFailureResult(null);
    setFailureLoading(true);
    try {
      const result = await postAdminFailures(flags);
      setFlags({ ...DEFAULT_FLAGS, ...result });
      setFailureResult(JSON.stringify(result, null, 2));
      reload();
    } catch (err) {
      setFailureError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed');
    } finally {
      setFailureLoading(false);
    }
  }

  const checks = (health?.checks ?? {}) as Record<string, boolean>;
  const cache = (health?.cache ?? {}) as Record<string, number>;
  const breaker = typeof health?.circuitBreaker === 'string' ? health.circuitBreaker : undefined;

  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">Ops dashboard</h1>
        <p className="muted">Live health checks, cache metrics, and failure injection for this API instance.</p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
        <button type="button" className="btn btn--secondary" onClick={reload} disabled={healthLoading}>
          Refresh health
        </button>
        {health && (
          <span
            className={`status-pill ${
              health.status === 'degraded' || health.status === 'error'
                ? 'status-pill--bad'
                : 'status-pill--ok'
            }`}
          >
            {String(health.status ?? 'ok')}
            {health.instanceId ? ` · ${health.instanceId}` : ''}
          </span>
        )}
      </div>

      {healthLoading && <LoadingState label="Checking health…" />}
      {healthError && <ErrorAlert message={healthError} />}

      {health && !healthLoading && (
        <>
          <div className="metric-grid">
            {Object.entries(checks).map(([name, ok]) => (
              <div className="metric-card" key={name}>
                <span className="metric-card__label">{name}</span>
                <span className="metric-card__value">
                  <span className={`metric-dot ${ok ? 'metric-dot--ok' : 'metric-dot--bad'}`} />
                  {ok ? 'Healthy' : 'Down'}
                </span>
              </div>
            ))}
            {breaker && (
              <div className="metric-card">
                <span className="metric-card__label">Circuit breaker</span>
                <span className="metric-card__value">
                  <span
                    className={`metric-dot ${
                      breaker === 'closed'
                        ? 'metric-dot--ok'
                        : breaker === 'half_open'
                          ? 'metric-dot--warn'
                          : 'metric-dot--bad'
                    }`}
                  />
                  {breaker.replace('_', ' ')}
                </span>
              </div>
            )}
            {Object.entries(cache).map(([name, value]) => (
              <div className="metric-card" key={name}>
                <span className="metric-card__label">Cache {name}</span>
                <span className="metric-card__value">{value}</span>
              </div>
            ))}
          </div>

          <details className="details-block">
            <summary>Raw health response</summary>
            <pre className="code-block" aria-label="Health response">
              {JSON.stringify(health, null, 2)}
            </pre>
          </details>
        </>
      )}

      <div className="two-col" style={{ marginTop: '2.5rem' }}>
        <section>
          <h2 className="section-title" style={{ fontSize: '1.35rem' }}>
            Failure simulation
          </h2>
          <p className="muted">Toggle faults without redeploying. Shared across horizontal API instances.</p>

          <form className="form-stack" onSubmit={handleFailureSubmit}>
            {(
              [
                ['failPayment', 'Fail payment provider'],
                ['failRedis', 'Fail Redis'],
                ['failDatabase', 'Fail database'],
                ['failBrokerPublish', 'Fail broker publish'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(flags[key])}
                  onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
            <div className="field">
              <label htmlFor="latency">Payment latency (ms)</label>
              <input
                id="latency"
                type="number"
                min={0}
                value={flags.paymentLatencyMs ?? 0}
                onChange={(e) =>
                  setFlags((f) => ({ ...f, paymentLatencyMs: Number(e.target.value) || 0 }))
                }
              />
            </div>
            {failureError && <ErrorAlert message={failureError} />}
            {failureResult && <pre className="code-block">{failureResult}</pre>}
            <button type="submit" className="btn" disabled={failureLoading}>
              {failureLoading ? 'Applying…' : 'Apply failures'}
            </button>
          </form>
        </section>

        <section>
          <h2 className="section-title" style={{ fontSize: '1.35rem' }}>
            Active flags
          </h2>
          <p className="muted">Current fault-injection state applied to this environment.</p>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}>
            {(
              [
                ['failPayment', 'Payment'],
                ['failRedis', 'Redis'],
                ['failDatabase', 'Database'],
                ['failBrokerPublish', 'Broker publish'],
              ] as const
            ).map(([key, label]) => {
              const active = Boolean(flags[key]);
              return (
                <div className="metric-card" key={key}>
                  <span className="metric-card__label">{label}</span>
                  <span className="metric-card__value">
                    <span className={`metric-dot ${active ? 'metric-dot--bad' : 'metric-dot--ok'}`} />
                    {active ? 'Failing' : 'Normal'}
                  </span>
                </div>
              );
            })}
            <div className="metric-card">
              <span className="metric-card__label">Payment latency</span>
              <span className="metric-card__value">{flags.paymentLatencyMs ?? 0} ms</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
