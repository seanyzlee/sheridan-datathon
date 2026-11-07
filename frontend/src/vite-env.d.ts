/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'live';
  readonly VITE_MOCK_ENGINE?: 'js' | 'cpp' | 'numpy';
  readonly VITE_DISABLED_FEATURES?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
