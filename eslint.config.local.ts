export default [
  {
    ignores: ["services/**"],
  },
  {
    files: ["tests/**/*.test.ts"],
    rules: {
      "jsdoc/require-param-description": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-jsdoc": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/publicly-writable-directories": "off",
      "max-lines": "off",
    },
  },
  {
    rules: {
      // Pre-existing awaited and nested-function side effects predate Lisa
      // 2.189.18's tightened statement-order checks. Keep the published rule
      // stricter by default while this repo carries that cleanup as separate
      // follow-up work (mirrors the Lisa repo's own opt-out).
      "code-organization/enforce-statement-order": [
        "error",
        { checkAllFunctionBodies: false, checkAwaitedCalls: false },
      ],
    },
  },
];
