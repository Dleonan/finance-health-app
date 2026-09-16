module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'apps/api/tsconfig.json' }],
  },
  roots: ['<rootDir>/apps/api/src', '<rootDir>/apps/api/test'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['apps/api/src/**/*.ts', '!apps/api/src/**/*.module.ts'],
};
