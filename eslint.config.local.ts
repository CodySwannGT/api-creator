/**
 * ESLint 9 Flat Config - Project-Local Customizations
 *
 * Relaxed rules for initial Lisa onboarding of a pre-existing CLI codebase.
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config.local
 */
export default [
  {
    rules: {
      "functional/no-let": "warn",
      "no-param-reassign": "warn",
      "jsdoc/require-jsdoc": "warn",
      "jsdoc/require-returns": "warn",
      "jsdoc/require-description": "warn",
      "jsdoc/require-param-description": "warn",
      "functional/immutable-data": "warn",
      "code-organization/enforce-statement-order": "warn",
      "sonarjs/cognitive-complexity": "warn",
      "sonarjs/slow-regex": "warn",
      "sonarjs/no-duplicate-string": "warn",
      "sonarjs/no-duplicated-branches": "warn",
      "sonarjs/no-alphabetical-sort": "warn",
      "sonarjs/prefer-regexp-exec": "warn",
      "sonarjs/reduce-initial-value": "warn",
      "sonarjs/no-nested-template-literals": "warn",
    },
  },
];
