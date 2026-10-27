import js from '@eslint/js';
import globals from 'globals';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/**', 'web/dist/**', 'server/.cache/**', 'server/results/**'] },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
  { files: ['server/**/*.js', 'scripts/**/*.js', '*.js'], languageOptions: { globals: globals.node } },
  { files: ['web/src/**/*.{js,vue}'], languageOptions: { globals: globals.browser } },
  {
    files: ['web/src/**/*.vue'],
    rules: { 'vue/no-v-html': 'off', 'vue/require-default-prop': 'off' },
  },
  prettier,
];
