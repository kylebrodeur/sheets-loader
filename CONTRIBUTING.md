# Contributing to @kylebrodeur/sheets-loader

Thank you for your interest in contributing! We welcome contributions from the community.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sheets-loader.git
   cd sheets-loader
   ```
3. **Install dependencies**:
   ```bash
   pnpm install
   ```

## Development Workflow

### Running Tests

```bash
pnpm test                 # Run tests
pnpm test:coverage        # Run tests with coverage report
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Building

```bash
pnpm build
```

### Running the Demo

```bash
pnpm demo
```

## Making Changes

1. **Create a new branch** for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```
2. **Make your changes**, following the code style guidelines below
3. **Add or update tests** for any new behavior
4. **Run the full check suite** before committing:
   ```bash
   pnpm lint && pnpm build && pnpm test
   ```

## Code Style

- TypeScript strict mode — all changes must type-check
- Single quotes for strings
- Semicolons required (enforced by Prettier)
- 2-space indentation
- Trailing commas in multiline structures
- 100-character line width

## Testing Guidelines

- All tests use Vitest
- Tests live in the `tests/` directory
- Mock `getAuthClient` or `fetchValues` to avoid real network calls
- Do not commit credentials or real spreadsheet IDs

## Security Notes

- Never commit credentials, private keys, or refresh tokens
- Use environment variables for sensitive values in examples and tests
- See `docs/oauth.md` for authentication best practices

## Submitting a Pull Request

1. Ensure all checks pass (`pnpm lint && pnpm build && pnpm test`)
2. Update `CHANGELOG.md` under `[Unreleased]` with a summary of your changes
3. Open a PR describing what was changed and why
4. Link any related issues

## Reporting Issues

Please use the GitHub issue templates:
- **Bug report**: For unexpected behavior
- **Feature request**: For new functionality

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
