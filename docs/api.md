# API Reference

## `MCPClient`

Main class for connecting to and interacting with MCP servers.

### Constructor

```javascript
const client = new MCPClient({ transport: 'stdio', timeout: 30000, headers: {} });
```

**Options:**
- `transport` (`'stdio'|'sse'|'http'`) — Transport type (default: `'stdio'`)
- `timeout` (number) — Request timeout in ms (default: `30000`)
- `headers` (object) — Custom HTTP headers for SSE/HTTP

### Methods

#### `connect(commandOrUrl, args?, env?)`

Connect to an MCP server.

- For **stdio**: `commandOrUrl` is the executable, `args` are CLI args, `env` are extra env vars
- For **SSE/HTTP**: `commandOrUrl` is the URL string
- Returns: `Promise<InitializeResult>`

#### `listTools()`

List all available tools. Returns: `Promise<Tool[]>`

#### `callTool(name, args?)`

Invoke a tool. Returns: `Promise<CallToolResult>`

#### `listResources()`

List all resources. Returns: `Promise<Resource[]>`

#### `readResource(uri)`

Read a resource by URI. Returns: `Promise<ReadResourceResult>`

#### `listPrompts()`

List all prompts. Returns: `Promise<Prompt[]>`

#### `getPrompt(name, args?)`

Get a rendered prompt. Returns: `Promise<GetPromptResult>`

#### `runSuite(suite)`

Run a test suite with lifecycle hooks.

```javascript
const result = await client.runSuite({
  name: 'My Suite',
  async beforeAll(client) { /* setup */ },
  async afterAll(client, results) { /* teardown */ },
  async beforeEach(client, test) { /* per-test setup */ },
  async afterEach(client, test, result) { /* per-test cleanup */ },
  tests: [
    { name: 'test1', type: 'tool', args: {}, assert: [...] }
  ]
});
```

Returns: `Promise<SuiteResult>`

#### `runTests(tests)`

Run a flat array of tests (backward compatible). Returns: `Promise<TestResult[]>`

#### `benchmark(name, args?, opts?)`

Benchmark a tool call.

- `opts.iterations` (number) — Number of iterations (default: 10)
- `opts.baseline` (object|string) — Baseline to compare against

Returns: `Promise<BenchmarkResult>` with `statistics.avg`, `.min`, `.max`, `.p50`, `.p95`, `.p99`, `.stddev`

#### `disconnect()`

Disconnect and clean up.

### Events

- `stderr` — Server stderr output (stdio only)
- `notification` — JSON-RPC notifications
- `exit` — Server process exited (stdio only)

## `Logger`

Utility for consistent CLI output.

```javascript
const { Logger } = require('mcprobe');
const log = new Logger({ verbose: true, quiet: false, ci: false });
log.info('message');
log.debug('verbose only');
log.error('error');
log.success('success');
log.warn('warning');
```

## Assertion Types

| Type | Fields | Description |
|------|--------|-------------|
| `exists` | `path` | Value is not null/undefined |
| `equals` | `path`, `expected` | Strict equality |
| `contains` | `path`, `expected` | String contains substring |
| `type` | `path`, `expected` | typeof check |
| `assertResponse` | `expected` | Full response match |
| `assertSchema` | `schema` | JSON Schema validation |
| `assertPerformance` | `maxMs` | Response time threshold |
| `custom` | `fn` | Custom function `(result) => { pass, message }` |

## Reporters

```javascript
const { junitXML, jsonReport, tapReport } = require('mcprobe/src/reporter');
```

### `junitXML(suiteResult)` → JUnit XML string
### `jsonReport(suiteResult)` → JSON string
### `tapReport(suiteResult)` → TAP string
### `formatBenchmark(bench)` → string[] of formatted lines

## Test Result Types

```typescript
interface SuiteResult {
  name: string;
  status: 'pass' | 'fail';
  results: TestResult[];
  summary: { total: number; pass: number; fail: number; error: number };
  elapsed: number;
}

interface TestResult {
  name: string;
  type: 'tool' | 'resource' | 'prompt';
  status: 'pass' | 'fail' | 'error';
  elapsed: number;
  assertions?: AssertionResult[];
  error?: string;
  result?: any;
}

interface BenchmarkResult {
  tool: string;
  iterations: number;
  statistics: {
    avg: number; min: number; max: number;
    p50: number; p95: number; p99: number;
    stddev: number;
  };
  times: number[];
  comparison?: {
    baselineAvg: number; currentAvg: number;
    diff: number; regression: boolean;
  };
}
```
