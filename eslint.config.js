// ESLint flat config: recomendadas do typescript-eslint, ajustadas ao que o
// código já segue. Formatação fica com o Prettier (eslint-config-prettier
// desliga as regras de estilo que brigariam com ele).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'mockups/**', '.claude/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // `_` na frente marca parâmetro ou variável ignorados de propósito.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
)
