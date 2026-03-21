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
];
