export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', '.tools/**', 'storybook-static/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: Object.fromEntries(['window', 'document', 'navigator', 'performance', 'Worker', 'URL', 'URLSearchParams', 'Blob', 'indexedDB', 'crypto', 'requestAnimationFrame', 'cancelAnimationFrame', 'createImageBitmap', 'getComputedStyle', 'DOMException', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', 'self', 'fetch', 'process', 'Buffer', 'TextDecoder'].map(name => [name, 'readonly']))
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }], 'no-unreachable': 'error', 'eqeqeq': 'error' }
  }
];
