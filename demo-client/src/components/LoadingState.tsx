// SPDX-License-Identifier: AGPL-3.0-only
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
