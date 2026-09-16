import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/.expo-build/**',
      'jest.config.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Nest resolves constructor tokens from emitted decorator metadata. These imports
    // must remain runtime imports even when TypeScript otherwise sees type-only usage.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
