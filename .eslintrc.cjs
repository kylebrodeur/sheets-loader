module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended'],
  parserOptions: {
    project: './tsconfig.json',
  },
  rules: {
    // keep this package lint rules minimal to avoid depending on root workspace plugins
  },
};
