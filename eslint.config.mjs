import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15.5.x ships legacy (eslintrc) configs rather than the
// flat-config arrays Next 16 exports, so wrap them with FlatCompat. This is
// the setup create-next-app generates on Next 15.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "build/**", ".open-next/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
