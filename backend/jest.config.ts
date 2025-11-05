import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      useESM: true,
      tsconfig: "./tsconfig.jest.json",
    }],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^bun$": "<rootDir>/__tests__/__mocks__/bun.ts",
    "^@openai/agents-core/extensions$": "@openai/agents-core/dist/extensions/index.mjs",
  },
  extensionsToTreatAsEsm: [".ts"],
  testTimeout: 60000,
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.ts"],
};

export default config;
