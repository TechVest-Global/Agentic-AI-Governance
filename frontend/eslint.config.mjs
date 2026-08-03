import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  globalIgnores([".next/**", "dist/**", "node_modules/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",

      // Hook linting. Several files already carried
      // `eslint-disable-next-line react-hooks/exhaustive-deps` comments, but the
      // plugin was never installed or registered — so the rule did not exist,
      // those suppressions suppressed nothing, and none of the ~186 hook call
      // sites in src/ were ever checked.
      //
      // Only the two classic rules are enabled. v7 of this plugin also ships
      // ~28 React Compiler rules; turning those on wholesale would bury the
      // signal here. Adopt them deliberately as a separate piece of work.
      //
      // rules-of-hooks is an error: a conditional or nested hook call is always
      // a real bug. exhaustive-deps is a warning: it has known false positives
      // and flagging every one as an error would wedge CI on day one — this
      // way it reports without blocking, and the count can be driven down.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  }
);
