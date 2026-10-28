import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [...nextVitals, ...nextTypescript, { ignores: [".next/**", "next-env.d.ts", "node_modules/**"] }];

export default config;
