/**
 * mcprobe - MCP Server Inspector & Tester
 * Core library for connecting to and testing MCP servers via stdio/SSE/HTTP transport.
 * @module mcprobe
 * @version 0.2.0
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

/**
 * MCPClient - Connect to and interact with MCP servers.
 * Supports stdio, SSE, and Streamable HTTP transports.
 * @extends EventEmitter
 */
class MCPClient extends EventEmitter {
  /**
   * Create a new MCPClient.
   * @param {object} [config={}] - Client configuration
   * @param {'stdio'|'sse'|'http'} [config.transport='stdio'] - Transport type
   * @param {object} [config.headers] - Custom HTTP headers (for SSE/HTTP)
   * @param {number} [config.timeout=30000] - Request timeout in ms
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.transport = config.transport || 'stdio';
    this.timeout = config.timeout || 30000;
    this.headers = config.headers || {};
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.capabilities = null;
    this.serverInfo = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    /** @type {string|null} SSE session endpoint */
    this._sseEndpoint = null;
    /** @type {string|null} HTTP base URL */
    this._httpBase = null;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connect to an MCP server.
   * For stdio: pass command + args. For SSE/HTTP: pass a URL string.
   * @param {string} commandOrUrl - Server command (stdio) or URL (SSE/HTTP)
   * @param {string[]} [args=[]] - Arguments (stdio only)
   * @param {object} [env={}] - Additional env vars (stdio only)
   * @returns {Promise<object>} Initialize result
   */
  async connect(commandOrUrl, args = [], env = {}) {
    switch (this.transport) {
      case 'stdio':
        return this._connectStdio(commandOrUrl, args, env);
      case 'sse':
        return this._connectSSE(commandOrUrl);
      case 'http':
        return this._connectHTTP(commandOrUrl);
      default:
        throw new Error(`Unknown transport: ${this.transport}. Use stdio, sse, or http.`);
    }
  }

  /**
   * Connect via stdio transport (subprocess).
   * @param {string} command - Command to start the server
   * @param {string[]} args - Command arguments
   * @param {object} env - Extra environment variables
   * @returns {Promise<object>}
   * @private
   */
  _connectStdio(command, args, env) {
    return new Promise((resolve, reject) => {
      const fullEnv = { ...process.env, ...env };
      this.process = spawn(command, args, {
        env: fullEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (data) => this._handleData(data));
      this.process.stderr.on('data', (data) => {
        this.emit('stderr', data.toString());
      });
      this.process.on('error', (err) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });
      this.process.on('exit', (code) => {
        this.emit('exit', code);
      });

      this._sendInitialize().then(resolve).catch(reject);
    });
  }

  /**
   * Connect via SSE transport (Server-Sent Events over HTTP).
   * Discovers the message endpoint from the SSE stream.
   * @param {string} url - SSE endpoint URL (e.g. http://localhost:3000/sse)
   * @returns {Promise<object>}
   * @private
   */
  _connectSSE(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      this._httpBase = `${urlObj.protocol}//${urlObj.host}`;

      /** @type {http.ClientRequest} */
      let req;
      const mod = urlObj.protocol === 'https:' ? https : http;

      const onEvent = (event, data) => {
        if (event === 'endpoint') {
          this._sseEndpoint = data.startsWith('/') ? this._httpBase + data : data;
        }
      };

      req = mod.get(url, { headers: { ...this.headers, Accept: 'text/event-stream' } }, (res) => {
        let buf = '';
        let currentEvent = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              onEvent(currentEvent || 'message', data);
              currentEvent = '';
            } else if (line.trim() === '') {
              currentEvent = '';
            }
          }
        });
        res.on('error', reject);

        // Wait a bit for endpoint discovery, then initialize
        setTimeout(() => {
          if (!this._sseEndpoint) {
            // Fallback: use URL path as POST endpoint
            this._sseEndpoint = url;
          }
          this._sendInitialize().then(resolve).catch(reject);
        }, 500);
      });

      req.on('error', reject);
      this._sseReq = req;
    });
  }

  /**
   * Connect via Streamable HTTP transport.
   * @param {string} url - HTTP endpoint URL (e.g. http://localhost:3000/mcp)
   * @returns {Promise<object>}
   * @private
   */
  _connectHTTP(url) {
    this._httpBase = url;
    this._httpEndpoint = url;
    return this._sendInitialize();
  }

  // ---------------------------------------------------------------------------
  // MCP Operations
  // ---------------------------------------------------------------------------

  /**
   * List available tools from the server.
   * @returns {Promise<object[]>}
   */
  async listTools() {
    const result = await this._send('tools/list', {});
    this.tools = result.tools || [];
    return this.tools;
  }

  /**
   * Call a tool on the server.
   * @param {string} name - Tool name
   * @param {object} [args={}] - Tool arguments
   * @returns {Promise<object>}
   */
  async callTool(name, args = {}) {
    return this._send('tools/call', { name, arguments: args });
  }

  /**
   * List available resources from the server.
   * @returns {Promise<object[]>}
   */
  async listResources() {
    const result = await this._send('resources/list', {});
    this.resources = result.resources || [];
    return this.resources;
  }

  /**
   * Read a resource from the server.
   * @param {string} uri - Resource URI
   * @returns {Promise<object>}
   */
  async readResource(uri) {
    return this._send('resources/read', { uri });
  }

  /**
   * List available prompts from the server.
   * @returns {Promise<object[]>}
   */
  async listPrompts() {
    const result = await this._send('prompts/list', {});
    this.prompts = result.prompts || [];
    return this.prompts;
  }

  /**
   * Get a prompt from the server.
   * @param {string} name - Prompt name
   * @param {object} [args={}] - Prompt arguments
   * @returns {Promise<object>}
   */
  async getPrompt(name, args = {}) {
    return this._send('prompts/get', { name, arguments: args });
  }

  /**
   * Send a completion request for a prompt argument.
   * @param {string} ref - Prompt name
   * @param {string} argumentName - Argument name
   * @param {string} value - Current value
   * @returns {Promise<object>}
   */
  async completePrompt(ref, argumentName, value) {
    return this._send('completion/complete', {
      ref: { type: 'ref/prompt', name: ref },
      argument: { name: argumentName, value },
    });
  }

  // ---------------------------------------------------------------------------
  // Test Framework
  // ---------------------------------------------------------------------------

  /**
   * Run a test suite against the server.
   * Supports lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach).
   * @param {object} suite - Test suite definition
   * @param {string} [suite.name] - Suite name
   * @param {Function} [suite.beforeAll] - Before all tests
   * @param {Function} [suite.afterAll] - After all tests
   * @param {Function} [suite.beforeEach] - Before each test
   * @param {Function} [suite.afterEach] - After each test
   * @param {object[]} suite.tests - Array of test definitions
   * @returns {Promise<object>} Suite result
   */
  async runSuite(suite) {
    const startTime = Date.now();
    const results = [];

    // Run beforeAll
    if (suite.beforeAll) {
      try { await suite.beforeAll(this); } catch (err) {
        return { name: suite.name, status: 'error', error: `beforeAll failed: ${err.message}`, results: [], elapsed: Date.now() - startTime };
      }
    }

    for (const test of suite.tests) {
      // Run beforeEach
      if (suite.beforeEach) {
        try { await suite.beforeEach(this, test); } catch (err) {
          results.push({ name: test.name || test.uri, status: 'error', error: `beforeEach failed: ${err.message}`, elapsed: 0 });
          continue;
        }
      }

      const result = await this._runSingleTest(test);
      results.push(result);

      // Run afterEach
      if (suite.afterEach) {
        try { await suite.afterEach(this, test, result); } catch (err) {
          // Log but don't fail
          result.afterEachError = err.message;
        }
      }
    }

    // Run afterAll
    if (suite.afterAll) {
      try { await suite.afterAll(this, results); } catch (err) {
        // Log but don't fail suite
      }
    }

    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const error = results.filter(r => r.status === 'error').length;

    return {
      name: suite.name || 'Test Suite',
      status: fail + error > 0 ? 'fail' : 'pass',
      results,
      summary: { total: results.length, pass, fail, error },
      elapsed: Date.now() - startTime,
    };
  }

  /**
   * Run tests (backward-compatible flat array format).
   * @param {object[]} tests - Array of test definitions
   * @returns {Promise<object[]>}
   */
  async runTests(tests) {
    const results = [];
    for (const test of tests) {
      results.push(await this._runSingleTest(test));
    }
    return results;
  }

  /**
   * Run a single test.
   * @param {object} test - Test definition
   * @returns {Promise<object>}
   * @private
   */
  async _runSingleTest(test) {
    const start = Date.now();
    try {
      let result;
      switch (test.type || 'tool') {
        case 'tool':
          result = await this.callTool(test.name, test.args || {});
          break;
        case 'resource':
          result = await this.readResource(test.uri);
          break;
        case 'prompt':
          result = await this.getPrompt(test.name, test.args || {});
          break;
        default:
          throw new Error(`Unknown test type: ${test.type}`);
      }
      const elapsed = Date.now() - start;

      // Run assertions
      const assertionResults = (test.assert || []).map((assertion) => {
        return this._runAssertion(assertion, result, elapsed);
      });

      return {
        name: test.name || test.uri,
        type: test.type || 'tool',
        status: assertionResults.every(a => a.pass) ? 'pass' : 'fail',
        elapsed,
        assertions: assertionResults,
        result: test.showResult ? result : undefined,
      };
    } catch (err) {
      return {
        name: test.name || test.uri,
        type: test.type || 'tool',
        status: 'error',
        elapsed: Date.now() - start,
        error: err.message,
      };
    }
  }

  /**
   * Run a single assertion against a result.
   * @param {object} assertion - Assertion definition
   * @param {object} result - MCP response result
   * @param {number} elapsed - Response time in ms
   * @returns {object} Assertion result { pass, message }
   * @private
   */
  _runAssertion(assertion, result, elapsed) {
    const { type, expected, path } = assertion;
    let actual = result;
    if (path) {
      for (const key of path.split('.')) {
        actual = actual?.[key];
      }
    }

    switch (type) {
      case 'exists':
        return { pass: actual != null, message: actual != null ? 'Value exists' : 'Value is null/undefined' };
      case 'equals':
        return { pass: actual === expected, message: `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
      case 'contains':
        return { pass: typeof actual === 'string' && actual.includes(expected), message: `String contains "${expected}"` };
      case 'type':
        return { pass: typeof actual === expected, message: `Expected type ${expected}, got ${typeof actual}` };
      case 'custom':
        return assertion.fn(result);
      /** Assert the full response matches expected object */
      case 'assertResponse':
        return { pass: JSON.stringify(result) === JSON.stringify(expected), message: 'Response matches expected' };
      /** Validate response against a JSON Schema */
      case 'assertSchema': {
        const schema = assertion.schema || expected;
        const valid = this._validateSchema(result, schema);
        return { pass: valid, message: valid ? 'Schema valid' : 'Schema validation failed' };
      }
      /** Assert response time is below a threshold */
      case 'assertPerformance': {
        const maxMs = assertion.maxMs || expected;
        return { pass: elapsed <= maxMs, message: elapsed <= maxMs ? `Response ${elapsed}ms ≤ ${maxMs}ms` : `Response ${elapsed}ms > ${maxMs}ms` };
      }
      default:
        return { pass: false, message: `Unknown assertion type: ${type}` };
    }
  }

  /**
   * Minimal JSON Schema validator (supports type, required, properties, items).
   * @param {*} value - Value to validate
   * @param {object} schema - JSON Schema
   * @returns {boolean}
   * @private
   */
  _validateSchema(value, schema) {
    if (!schema) return true;
    if (schema.type) {
      const t = schema.type;
      if (t === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) return false;
      if (t === 'array' && !Array.isArray(value)) return false;
      if (t === 'string' && typeof value !== 'string') return false;
      if (t === 'number' && typeof value !== 'number') return false;
      if (t === 'boolean' && typeof value !== 'boolean') return false;
    }
    if (schema.required && schema.required.length) {
      for (const key of schema.required) {
        if (value?.[key] === undefined) return false;
      }
    }
    if (schema.properties && typeof value === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (value[key] !== undefined && !this._validateSchema(value[key], propSchema)) return false;
      }
    }
    if (schema.items && Array.isArray(value)) {
      for (const item of value) {
        if (!this._validateSchema(item, schema.items)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Benchmark
  // ---------------------------------------------------------------------------

  /**
   * Benchmark a tool call with multiple iterations and percentile stats.
   * @param {string} name - Tool name
   * @param {object} [args={}] - Tool arguments
   * @param {object} [opts={}] - Options
   * @param {number} [opts.iterations=10] - Number of iterations
   * @param {string|null} [opts.baseline=null] - Baseline JSON to compare against
   * @returns {Promise<object>} Benchmark results with avg/min/max/p50/p95/p99
   */
  async benchmark(name, args = {}, opts = {}) {
    const n = opts.iterations || 10;
    const times = [];

    for (let i = 0; i < n; i++) {
      const start = Date.now();
      await this.callTool(name, args);
      times.push(Date.now() - start);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / n;
    const p = (pct) => sorted[Math.min(Math.floor(n * pct), n - 1)];

    const result = {
      tool: name,
      args,
      iterations: n,
      statistics: {
        avg: +avg.toFixed(2),
        min: sorted[0],
        max: sorted[n - 1],
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        stddev: +Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / n).toFixed(2),
      },
      times: sorted,
    };

    // Compare with baseline if provided
    if (opts.baseline) {
      const bl = typeof opts.baseline === 'string' ? JSON.parse(opts.baseline) : opts.baseline;
      result.comparison = {
        baselineAvg: bl.statistics?.avg || bl.avg,
        currentAvg: result.statistics.avg,
        diff: +(result.statistics.avg - (bl.statistics?.avg || bl.avg)).toFixed(2),
        regression: result.statistics.avg > (bl.statistics?.avg || bl.avg) * 1.2,
      };
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Disconnect
  // ---------------------------------------------------------------------------

  /**
   * Disconnect from the server.
   */
  async disconnect() {
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process.stdin?.destroy();
      this.process.stdout?.destroy();
      this.process.stderr?.destroy();
      this.process = null;
    }
    if (this._sseReq) {
      this._sseReq.destroy();
      this._sseReq = null;
    }
    this.pending.clear();
  }

  // ---------------------------------------------------------------------------
  // JSON-RPC internals
  // ---------------------------------------------------------------------------

  /**
   * Send initialize request.
   * @returns {Promise<object>}
   * @private
   */
  _sendInitialize() {
    return this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcprobe', version: '0.2.0' },
    }).then((result) => {
      this.serverInfo = result.serverInfo;
      this.capabilities = result.capabilities;
      this._notify('notifications/initialized', {});
      return result;
    });
  }

  /**
   * Send a JSON-RPC request.
   * @param {string} method - RPC method
   * @param {object} params - RPC params
   * @returns {Promise<object>}
   * @private
   */
  _send(method, params) {
    switch (this.transport) {
      case 'stdio':
        return this._sendStdio(method, params);
      case 'sse':
        return this._sendHTTP(this._sseEndpoint || this._httpBase, method, params);
      case 'http':
        return this._sendHTTP(this._httpEndpoint, method, params);
      default:
        return Promise.reject(new Error(`No transport connected`));
    }
  }

  /**
   * Send via stdio.
   * @private
   */
  _sendStdio(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.pending.set(id, { resolve, reject });
      if (!this.process?.stdin) {
        return reject(new Error('Server process not connected'));
      }
      this.process.stdin.write(message + '\n');

      // Timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method} (${this.timeout}ms)`));
        }
      }, this.timeout);
    });
  }

  /**
   * Send via HTTP POST.
   * @param {string} url - Target URL
   * @param {string} method - RPC method
   * @param {object} params - RPC params
   * @returns {Promise<object>}
   * @private
   */
  _sendHTTP(url, method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const urlObj = new URL(url);
      const mod = urlObj.protocol === 'https:' ? https : http;

      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...this.headers,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const msg = JSON.parse(data);
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          } catch (err) {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();

      setTimeout(() => {
        req.destroy();
        reject(new Error(`Request timeout: ${method} (${this.timeout}ms)`));
      }, this.timeout);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * @param {string} method - RPC method
   * @param {object} params - RPC params
   * @private
   */
  _notify(method, params) {
    if (this.transport === 'stdio') {
      const message = JSON.stringify({ jsonrpc: '2.0', method, params });
      this.process?.stdin?.write(message + '\n');
    }
    // For SSE/HTTP, notifications are typically not needed after init
  }

  /**
   * Handle incoming data from stdio.
   * @param {Buffer} data
   * @private
   */
  _handleData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          this.emit('notification', msg);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }
}

/**
 * Logger utility for verbose/quiet/ci modes.
 */
class Logger {
  /**
   * @param {object} [opts={}] - Options
   * @param {boolean} [opts.verbose=false] - Verbose mode
   * @param {boolean} [opts.quiet=false] - Quiet mode
   * @param {boolean} [opts.ci=false] - CI mode (no colors)
   */
  constructor(opts = {}) {
    this.verbose = opts.verbose || false;
    this.quiet = opts.quiet || false;
    this.ci = opts.ci || false;
  }

  /** Color helper */
  _c(code, text) {
    if (this.ci) return text;
    return `\x1b[${code}m${text}\x1b[0m`;
  }

  /** Log info message */
  info(msg) { if (!this.quiet) console.log(msg); }
  /** Log verbose message */
  debug(msg) { if (this.verbose && !this.quiet) console.log(this._c(90, msg)); }
  /** Log error */
  error(msg) { console.error(this._c(91, msg)); }
  /** Log success */
  success(msg) { if (!this.quiet) console.log(this._c(92, msg)); }
  /** Log warning */
  warn(msg) { if (!this.quiet) console.log(this._c(93, msg)); }
}

module.exports = { MCPClient, Logger };
