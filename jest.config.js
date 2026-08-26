/** Jest config — Expo SDK 53 (jest-expo preset handles babel-preset-expo + RN transforms). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // RTK resolves immer's 'react-native' export (legacy ESM) which Jest can't parse; use the CJS build.
    '^immer$': '<rootDir>/node_modules/immer/dist/cjs/index.js',
  },
  clearMocks: true,
};
