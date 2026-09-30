# Contributing to this project

Thank you for your interest in contributing to this project! We welcome contributions from the community.

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:

- A clear description of the problem
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (OS, Node version, etc.)

### Suggesting Features

We welcome feature suggestions! Please open an issue with:

- A clear description of the feature
- Use cases and benefits
- Any implementation ideas you have

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following our coding standards
4. **Add tests** for any new functionality
5. **Run tests**: `npm test`
6. **Run linting**: `npm run lint`
7. **Format code**: `npm run format`
8. **Commit your changes** with clear commit messages
9. **Push to your fork** and submit a pull request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/alazaroc/serverless-monorepo-aws-starter.git
cd serverless-monorepo-aws-starter

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run linting
npm run lint
```

### Coding Standards

- **TypeScript**: All code must be written in TypeScript
- **ESLint**: Follow the ESLint configuration
- **Prettier**: Format code with Prettier
- **Tests**: Write unit tests for business logic
- **Property-based tests**: Use fast-check for correctness properties
- **Comments**: Add JSDoc comments for public APIs

### Project Structure

- `frontend/` - React application
- `backend/` - Lambda functions organized by domain
- `infra/cdk/` - AWS CDK infrastructure

### Backend Domain Structure

Each backend domain follows this pattern:

```
backend/services/<domain>/
├── handlers/        # Lambda entrypoints (thin)
├── services/        # Business logic
├── models/          # TypeScript interfaces
└── __tests__/       # Unit tests
```

### Commit Messages

Follow conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Build/tooling changes

Example: `feat: add semantic search to chatbot`

### Testing

- **Unit tests**: Test business logic in isolation
- **Property-based tests**: Verify correctness properties
- **E2E tests**: Test complete user flows with Playwright
- **Coverage**: Maintain >80% code coverage

### Pull Request Process

1. Update documentation if needed
2. Add tests for new functionality
3. Ensure all tests pass
4. Update CHANGELOG.md if applicable
5. Request review from maintainers
6. Address review feedback
7. Squash commits before merge

### Questions?

Feel free to open an issue for any questions or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
