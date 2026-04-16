# Changelog

All notable changes to mcprobe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-16

### Added
- **Multi-transport support**: SSE and Streamable HTTP transports in addition to stdio
  - `--transport stdio|sse|http` CLI flag
  - `MCPClient` accepts `{ transport: 'sse' | 'http' }` config
- **Enhanced test framework**
  - Lifecycle hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
  - Suite-based test files with `runSuite()`
  - New assertions: `assertResponse`, `assertSchema` (JSON Schema), `assertPerformance` (response time)
  - JS test files can export functions for dynamic test generation
- **CI integration**
  - `--ci` mode: no colors, exit code reflects test results
  - `--reporter junit|json|tap` for machine-readable output
  - JUnit XML report generation for CI systems
  - GitHub Actions workflow example (`.github/workflows/test-mcp.yml`)
- **Benchmark enhancements**
  - P95/P99 percentile statistics
  - Standard deviation
  - JSON output format (`--json`)
  - Baseline comparison (`--baseline <file>`) with regression detection
- **Code quality**
  - JSDoc comments on all functions
  - `--verbose` and `--quiet` CLI modes
  - `Logger` utility class for consistent output
  - Request timeout handling
  - Friendly error messages (no raw stack traces)
- **Documentation**
  - Architecture diagram (Mermaid)
  - MCP Inspector comparison table
  - Contributing guide
  - CI integration guide
  - Changelog

## [0.1.0] - 2025-01-01

### Added
- Initial release
- `discover` command — list tools, resources, prompts
- `call` command — invoke tools
- `resource` command — read resources
- `prompt` command — get prompt templates
- `test` command — run assertion-based test suites
- `bench` command — basic benchmarking
- `replay` command — replay JSON-RPC sessions
- Stdio transport support
- JSON and JS test file formats
- Mock MCP server for testing
