import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import preferArrow from "eslint-plugin-prefer-arrow";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "tmp/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "simple-import-sort": simpleImportSort,
      "prefer-arrow": preferArrow,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: [
            "BinaryExpression[operator='==='][left.type='Literal'][left.raw='null']",
            "BinaryExpression[operator='==='][right.type='Literal'][right.raw='null']",
            "BinaryExpression[operator='!=='][left.type='Literal'][left.raw='null']",
            "BinaryExpression[operator='!=='][right.type='Literal'][right.raw='null']",
            "BinaryExpression[operator='==='][left.type='Identifier'][left.name='undefined']",
            "BinaryExpression[operator='==='][right.type='Identifier'][right.name='undefined']",
            "BinaryExpression[operator='!=='][left.type='Identifier'][left.name='undefined']",
            "BinaryExpression[operator='!=='][right.type='Identifier'][right.name='undefined']",
          ].join(", "),
          message: "Use == null or != null for nullish comparisons.",
        },
      ],
      "prefer-arrow/prefer-arrow-functions": [
        "error",
        {
          disallowPrototype: true,
          singleReturnOnly: false,
          classPropertiesAllowed: false,
        },
      ],
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  prettier,
];
