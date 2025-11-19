import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import headersPlugin from 'eslint-plugin-headers';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      headers: headersPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content: '/**\n * Copyright (c) 2025 Elara AI Pty. Ltd. All rights reserved.\n * Proprietary and confidential.\n */',
        },
      ],
    },
  },
];
