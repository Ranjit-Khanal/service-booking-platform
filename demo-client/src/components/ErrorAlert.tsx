// SPDX-License-Identifier: AGPL-3.0-only
export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="alert alert--error" role="alert">
      <span className="alert__icon" aria-hidden="true">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}
