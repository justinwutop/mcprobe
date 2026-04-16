# mcprobe 🔍

**Test, debug, and inspect MCP servers — like Postman for MCP.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Version 0.2.0](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/yourname/mcprobe)

![mcprobe demo](docs/demo.gif)

## Why mcprobe?

Building MCP (Model Context Protocol) servers is hot 🔥 — but **testing them sucks**. You either:
- Write raw JSON-RPC messages by hand
- Boot up Claude Desktop just to check if your server works
- Stare at console logs hoping for the best

**mcprobe** gives you a fast, scriptable CLI to connect to any MCP server, discover its capabilities, invoke tools, read resources, run assertions, and benchmark performance — all from your terminal. Built for CI/CD from day one.

```
$ mcprobe discover "node my-server.js"

## Server Info
{ "name": "my-awesome-server", "version": "1.2.0" }

## Tools
  📦 search: Search the knowledge base
     - query (string): Search query
     - limit (number): Max results
  📦 summarize: Summarize a document
     - document_id (string): Document ID

## Resources
  📄 file:///docs/readme.md: README
  📄 file:///docs/api.md: API Docs

## Prompts
  💬 summarize: Summarize a document
```

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Discover** | Connect to any MCP server and see all tools, resources, prompts |
| 📞 **Call** | Invoke tools with JSON arguments |
| 📄 **Read** | Fetch resources by URI |
| 💬 **Prompt** | Get prompt templates with arguments |
| 🧪 **Test** | Assertion-based test suites with lifecycle hooks |
| ⏱️ **Bench** | Benchmark with P95/P99, baseline comparison |
| 🔁 **Replay** | Replay recorded JSON-RPC sessions |
| 🌐 **Multi-transport** | stdio · SSE · Streamable HTTP |
| 📊 **CI/CD** | JUnit XML, JSON, TAP reporters, `--ci` mode |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    mcprobe CLI                        │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐  │
│  │discover │ │   call   │ │  test   │ │  bench   │  │
│  └────┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘  │
│       └───────────┬┴────────────┘──────────┘         │
│              MCPClient (Core)                        │
│  ┌────────────┬─────────────┬──────────────────┐     │
│  │   stdio    │     SSE     │ Streamable HTTP  │     │
│  │ (subprocess)│ (EventSource)│   (HTTP POST)   │     │
│  └─────┬──────┴──────┬──────┴────────┬─────────┘     │
└────────┼─────────────┼───────────────┼───────────────┘
         │             │               │
    ┌────▼────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │ MCP     │  │ MCP       │  │ MCP       │
    │ Server  │  │ Server    │  │ Server    │
    │ (stdio) │  │ (SSE)     │  │ (HTTP)    │
    └─────────┘  └───────────┘  └───────────┘
```

## Install

```bash
git clone https://github.com/yourname/mcprobe.git
cd mcprobe
npm install
```

## Quick Start

```bash
# Discover everything a server offers
mcprobe discover "node my-mcp-server.js"

# Call a specific tool
mcprobe call "node my-mcp-server.js" search -a '{"query": "hello"}'

# Run a test suite
mcprobe test "node my-mcp-server.js" tests/example.json

# Run with JUnit XML output (for CI)
mcprobe test "node my-mcp-server.js" tests/example.json --ci --reporter junit

# Benchmark a tool
mcprobe bench "node my-mcp-server.js" search -a '{"query": "test"}' -n 50

# Connect via SSE
mcprobe discover http://localhost:3000/sse --transport sse

# Connect via Streamable HTTP
mcprobe discover http://localhost:3000/mcp --transport http
```

## Transport Support

| Transport | Flag | Use Case |
|-----------|------|----------|
| **stdio** | `--transport stdio` (default) | Local subprocess servers |
| **SSE** | `--transport sse` | HTTP servers with Server-Sent Events |
| **HTTP** | `--transport http` | Streamable HTTP servers |

```bash
# Stdio (default) — pass server command
mcprobe discover "node server.js"

# SSE — pass URL
mcprobe discover http://localhost:3000/sse --transport sse

# HTTP — pass URL
mcprobe discover http://localhost:3000/mcp --transport http
```

## Testing

### Test File Format (JSON)

```json
[
  {
    "name": "search",
    "type": "tool",
    "args": { "query": "test" },
    "assert": [
      { "type": "exists", "path": "content" },
      { "type": "assertPerformance", "maxMs": 1000 }
    ]
  }
]
```

### Test File Format (JS with Suite & Lifecycle)

```javascript
module.exports = {
  name: 'My Test Suite',
  async beforeAll(client) {
    console.log('Setting up...');
  },
  async afterAll(client, results) {
    console.log('Tearing down...');
  },
  async beforeEach(client, test) {
    // Reset state before each test
  },
  async afterEach(client, test, result) {
    // Cleanup after each test
  },
  tests: [
    {
      name: 'echo',
      type: 'tool',
      args: { message: 'hello' },
      assert: [
        { type: 'exists', path: 'content' },
        { type: 'assertSchema', schema: { type: 'object', required: ['content'] } },
        { type: 'assertPerformance', maxMs: 500 },
      ],
    },
  ],
};
```

### Assertion Types

| Type | Description | Fields |
|------|-------------|--------|
| `exists` | Value is not null/undefined | `path` |
| `equals` | Value equals expected | `path`, `expected` |
| `contains` | String contains substring | `path`, `expected` |
| `type` | Value has expected JS type | `path`, `expected` |
| `assertResponse` | Full response matches expected | `expected` |
| `assertSchema` | Validate against JSON Schema | `schema` |
| `assertPerformance` | Response time ≤ threshold (ms) | `maxMs` |
| `custom` | Custom function | `fn: (result) => { pass, message }` |

## Benchmark

```bash
# Basic benchmark
mcprobe bench "node server.js" echo -a '{"message":"hi"}' -n 100

# JSON output
mcprobe bench "node server.js" echo -n 50 --json

# Compare with baseline
mcprobe bench "node server.js" echo -n 50 --baseline previous-result.json
```

Output:
```
⏱️  Benchmarking "echo" × 100 iterations...

  Average: 12.3ms
  Min:     5ms
  Max:     89ms
  P50:     10ms
  P95:     35ms
  P99:     72ms
  StdDev:  8.5ms
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Test MCP Server
  run: |
    npx mcprobe test "node dist/server.js" tests/smoke.json --ci --reporter junit > results.xml

- name: Benchmark
  run: |
    npx mcprobe bench "node dist/server.js" search -n 20 --json > bench.json
```

See [`.github/workflows/test-mcp.yml`](.github/workflows/test-mcp.yml) for a complete example.

### CLI Flags for CI

| Flag | Description |
|------|-------------|
| `--ci` | No colors, clean output |
| `--reporter junit` | JUnit XML (Jenkins, GitHub, etc.) |
| `--reporter json` | JSON output |
| `--reporter tap` | TAP (Test Anything Protocol) |
| `--quiet` | Suppress non-essential output |
| `--verbose` | Show detailed result data |

Exit code is `1` if any test fails or errors, `0` on success.

## Comparison with MCP Inspector

| Feature | mcprobe | MCP Inspector |
|---------|---------|---------------|
| Interface | CLI | Web UI |
| Scriptable | ✅ | ❌ |
| CI/CD integration | ✅ JUnit, JSON, TAP | ❌ |
| Automated testing | ✅ Assertions, lifecycle hooks | ❌ |
| Benchmarking | ✅ P50/P95/P99, baselines | ❌ |
| Multi-transport | ✅ stdio, SSE, HTTP | ✅ stdio, SSE |
| Replay sessions | ✅ | ❌ |
| No browser needed | ✅ | ❌ (needs browser) |
| Session replay | ✅ JSONL replay | ❌ |
| Perf regression detection | ✅ Baseline comparison | ❌ |

## Programmatic API

```javascript
const { MCPClient } = require('mcprobe');

const client = new MCPClient({ transport: 'stdio' });

async function main() {
  const info = await client.connect('node', ['server.js']);
  console.log('Connected to:', info.serverInfo.name);

  const tools = await client.listTools();
  const result = await client.callTool('search', { query: 'hello' });

  // Run a benchmark
  const bench = await client.benchmark('search', { query: 'test' }, { iterations: 20 });
  console.log(`Average: ${bench.statistics.avg}ms, P95: ${bench.statistics.p95}ms`);

  await client.disconnect();
}

main();
```

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repo
2. **Create** a feature branch: `git checkout -b feature/amazing`
3. **Code** your changes with tests
4. **Test**: `npm test` — all tests must pass
5. **Commit**: `git commit -m 'Add amazing feature'`
6. **Push**: `git push origin feature/amazing`
7. **Open** a Pull Request

### Guidelines
- Add JSDoc comments to all functions
- Keep error messages user-friendly
- Run `npm test` before pushing
- Follow existing code style

## Project Structure

```
mcprobe/
├── src/
│   ├── index.js       # MCPClient core + Logger
│   ├── cli.js         # CLI entry point (commander)
│   └── reporter.js    # JUnit, JSON, TAP reporters
├── test/
│   └── run.js         # Full test suite
├── examples/
│   ├── mock-server.js # Mock MCP server
│   └── basic-test.json
├── .github/workflows/
│   └── test-mcp.yml   # CI workflow
├── docs/
│   └── api.md         # API documentation
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md
```

## License

MIT © Justin Wu
