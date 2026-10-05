module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testRegex: '\\.e2e-spec\\.ts$',
  globalSetup: '<rootDir>/test/global-setup.js',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 60000,
};
