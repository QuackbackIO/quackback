import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

// Files that ARE the re-export layer or standalone scripts — they must import @quackback/db directly
const dbReexportFiles = [
  "**/src/lib/server/db.ts",
  "**/src/lib/shared/db-types.ts",
  "**/scripts/**",
];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.output/**",
      "**/dist/**",
      "**/build/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: dbReexportFiles,
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@quackback/db", "@quackback/db/*"],
              message:
                "Import from '@/lib/server/db' (server) or '@/lib/shared/db-types' (client) instead.",
            },
          ],
        },
      ],
    },
  },
  // The exempted files still need the base TS rules, just without the import restriction
  {
    files: dbReexportFiles,
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // lib/ must not import from components/
  {
    files: ["**/src/lib/**/*.{ts,tsx}"],
    ignores: dbReexportFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@quackback/db", "@quackback/db/*"],
              message:
                "Import from '@/lib/server/db' (server) or '@/lib/shared/db-types' (client) instead.",
            },
            {
              group: ["@/components/*", "@/components/**"],
              message: "lib/ must not import from components/.",
            },
          ],
        },
      ],
    },
  },
  // Service file size limits
  {
    files: ["**/server/domains/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["**/client/hooks/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  }
);
