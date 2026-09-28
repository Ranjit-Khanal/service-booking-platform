// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_ADMIN_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
