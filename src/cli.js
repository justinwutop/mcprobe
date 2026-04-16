#!/usr/bin/env node

/**
 * mcprobe - CLI entry point
 * Test, debug, and inspect MCP servers from the command line.
 * @version 0.2.0
 */

const { Command } = require('commander');
const { MCPClient, Logger } = require('./index');
const { junitXML, jsonReport, tapReport, formatBenchmark } = require('./reporter');
const path = require('path');
const fs = require('fs');

const program = new Command();

/** Global options */
let globalOpts = {};

/**
 * Parse server argument into command + args for stdio,
 * or return URL for SSE/HTTP.
 * @param {string} server - Server command or URL
 * @returns {object}
 */
function parseServerArg(server) {
  const parts = server.split(' ');
  return { command: parts[0], args: parts.slice(1) };
}

/**
 * Create and connect an MCPClient.
 * @param {string} server - Server command or URL
 * @param {object} opts - CLI options
 * @param {Logger} log - Logger instance
 * @returns {Promise<{client: MCPClient, init: object}>}
 */
async function connectClient(server, opts, log) {
  const transport = opts.transport || 'stdio';
  const env = {};
  for (const e of (opts.env || [])) {
    const [key, ...rest] = e.split('=');
    env[key] = rest.join('=');
  }

  const client = new MCPClient({ transport, headers: env._headers });
  try {
    let init;
    if (transport === 'stdio') {
      const { command, args } = parseServerArg(server);
      init = await client.connect(command, args, env);
    } else {
      init = await client.connect(server);
    }
    log.debug(`Connected via ${transport} to ${client.serverInfo?.name || 'server'}`);
    return { client, init };
  } catch (err) {
    log.error(`Failed to connect: ${err.message}`);
    process.exit(1);
  }
}

/** Pretty-print JSON */
function pretty(obj) { console.log(JSON.stringify(obj, null, 2)); }

/**
 * Load test file (JSON or JS).
 * @param {string} testfile - Path to test file
 * @returns {object} Test suite (flat array or suite object)
 */
function loadTestFile(testfile) {
  const fp = path.resolve(testfile);
  if (!fs.existsSync(fp)) {
    throw new Error(`Test file not found: ${fp}`);
  }
  if (fp.endsWith('.js')) {
    const loaded = require(fp);
    // JS file can export suite object or flat array
    if (typeof loaded === 'function') return loaded();
    return loaded;
  }
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

program
  .name('mcprobe')
  .description('Test, debug, and inspect MCP servers — like Postman for MCP')
  .version('0.2.0')
  .hook('preAction', (thisCmd) => {
    globalOpts = thisCmd.opts();
  });

// Global options
program
  .option('--verbose', 'Show detailed output')
  .option('--quiet', 'Suppress non-essential output')
  .option('--ci', 'CI mode: no colors, exit code reflects results')
  .option('-t, --transport <type>', 'Transport type: stdio|sse|http', 'stdio');

// --- discover ---
program
  .command('discover')
  .description('Connect to a server and list all capabilities, tools, resources, and prompts')
  .argument('<server>', 'Server command (e.g. "node server.js") or URL')
  .option('-e, --env <key=value...>', 'Environment variables for the server process')
  .action(async (server, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client, init } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);

    console.log('## Server Info');
    pretty(init.serverInfo);
    console.log('\n## Capabilities');
    pretty(init.capabilities);

    if (init.capabilities?.tools) {
      console.log('\n## Tools');
      const tools = await client.listTools();
      for (const tool of tools) {
        console.log(`  📦 ${tool.name}: ${tool.description || '(no description)'}`);
        if (tool.inputSchema?.properties) {
          for (const [k, v] of Object.entries(tool.inputSchema.properties)) {
            console.log(`     - ${k} (${v.type || 'any'}): ${v.description || ''}`);
          }
        }
      }
    }

    if (init.capabilities?.resources) {
      console.log('\n## Resources');
      const resources = await client.listResources();
      for (const r of resources) {
        console.log(`  📄 ${r.uri}: ${r.name || '(unnamed)'}`);
      }
    }

    if (init.capabilities?.prompts) {
      console.log('\n## Prompts');
      const prompts = await client.listPrompts();
      for (const p of prompts) {
        console.log(`  💬 ${p.name}: ${p.description || '(no description)'}`);
      }
    }

    await client.disconnect();
  });

// --- call ---
program
  .command('call')
  .description('Call a tool on the server')
  .argument('<server>', 'Server command or URL')
  .argument('<tool>', 'Tool name')
  .option('-a, --args <json>', 'Tool arguments as JSON', '{}')
  .option('-e, --env <key=value...>', 'Environment variables')
  .action(async (server, tool, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);
    try {
      const args = JSON.parse(opts.args);
      const result = await client.callTool(tool, args);
      pretty(result);
    } catch (err) {
      log.error(`Error: ${err.message}`);
    }
    await client.disconnect();
  });

// --- resource ---
program
  .command('resource')
  .description('Read a resource from the server')
  .argument('<server>', 'Server command or URL')
  .argument('<uri>', 'Resource URI')
  .option('-e, --env <key=value...>', 'Environment variables')
  .action(async (server, uri, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);
    try {
      const result = await client.readResource(uri);
      pretty(result);
    } catch (err) {
      log.error(`Error: ${err.message}`);
    }
    await client.disconnect();
  });

// --- prompt ---
program
  .command('prompt')
  .description('Get a prompt from the server')
  .argument('<server>', 'Server command or URL')
  .argument('<name>', 'Prompt name')
  .option('-a, --args <json>', 'Prompt arguments as JSON', '{}')
  .option('-e, --env <key=value...>', 'Environment variables')
  .action(async (server, name, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);
    try {
      const args = JSON.parse(opts.args);
      const result = await client.getPrompt(name, args);
      pretty(result);
    } catch (err) {
      log.error(`Error: ${err.message}`);
    }
    await client.disconnect();
  });

// --- test ---
program
  .command('test')
  .description('Run a test suite against an MCP server')
  .argument('<server>', 'Server command or URL')
  .argument('<testfile>', 'Test file (JSON or JS)')
  .option('-e, --env <key=value...>', 'Environment variables')
  .option('--reporter <format>', 'Output format: default|junit|json|tap', 'default')
  .action(async (server, testfile, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);

    let suiteOrTests;
    try {
      suiteOrTests = loadTestFile(testfile);
    } catch (err) {
      log.error(`Failed to load test file: ${err.message}`);
      await client.disconnect();
      process.exit(1);
    }

    // Detect suite vs flat array
    const isSuite = suiteOrTests.tests && Array.isArray(suiteOrTests.tests);

    let suiteResult;
    if (isSuite) {
      suiteResult = await client.runSuite(suiteOrTests);
    } else {
      // Flat array - wrap in suite format
      const results = await client.runTests(suiteOrTests);
      const pass = results.filter(r => r.status === 'pass').length;
      const fail = results.filter(r => r.status === 'fail').length;
      const error = results.filter(r => r.status === 'error').length;
      suiteResult = {
        name: path.basename(testfile),
        status: fail + error > 0 ? 'fail' : 'pass',
        results,
        summary: { total: results.length, pass, fail, error },
        elapsed: results.reduce((s, r) => s + (r.elapsed || 0), 0),
      };
    }

    // Output based on reporter
    const reporter = opts.reporter || 'default';
    if (reporter === 'junit') {
      console.log(junitXML(suiteResult));
    } else if (reporter === 'json') {
      console.log(jsonReport(suiteResult));
    } else if (reporter === 'tap') {
      console.log(tapReport(suiteResult));
    } else {
      // Default human-readable
      const results = suiteResult.results;
      console.log(`\n🧪 Running ${results.length} test(s)...\n`);
      for (const r of results) {
        const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '💥';
        log.info(`${icon} ${r.name} (${r.type}) - ${r.elapsed}ms`);
        if (r.status === 'fail' && r.assertions) {
          for (const a of r.assertions) {
            if (!a.pass) log.info(`   → ${a.message}`);
          }
        }
        if (r.error) log.info(`   → Error: ${r.error}`);
        if (globalOpts.verbose && r.result) {
          console.log('   Result:', JSON.stringify(r.result, null, 2).split('\n').map(l => '   ' + l).join('\n'));
        }
      }
      const s = suiteResult.summary;
      console.log(`\n📊 Results: ${s.pass} passed, ${s.fail} failed, ${s.error} errors (${suiteResult.elapsed}ms)`);
    }

    await client.disconnect();
    const failed = suiteResult.summary ? suiteResult.summary.fail + suiteResult.summary.error : 0;
    process.exit(failed > 0 ? 1 : 0);
  });

// --- bench ---
program
  .command('bench')
  .description('Benchmark tool calls against an MCP server')
  .argument('<server>', 'Server command or URL')
  .argument('<tool>', 'Tool name')
  .option('-a, --args <json>', 'Tool arguments as JSON', '{}')
  .option('-n, --iterations <n>', 'Number of iterations', '10')
  .option('--baseline <file>', 'Baseline JSON file to compare against')
  .option('--json', 'Output results as JSON')
  .option('-e, --env <key=value...>', 'Environment variables')
  .action(async (server, tool, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);
    const args = JSON.parse(opts.args);
    const n = parseInt(opts.iterations);

    let baseline = null;
    if (opts.baseline) {
      try {
        baseline = JSON.parse(fs.readFileSync(path.resolve(opts.baseline), 'utf-8'));
      } catch (err) {
        log.warn(`Could not load baseline: ${err.message}`);
      }
    }

    console.log(`⏱️  Benchmarking "${tool}" × ${n} iterations...\n`);
    const result = await client.benchmark(tool, args, { iterations: n, baseline });

    if (opts.json) {
      pretty(result);
    } else {
      formatBenchmark(result).forEach(l => console.log(l));
    }

    await client.disconnect();
  });

// --- replay ---
program
  .command('replay')
  .description('Replay recorded JSON-RPC messages from a log file')
  .argument('<server>', 'Server command or URL')
  .argument('<logfile>', 'JSONL file with recorded requests')
  .option('-e, --env <key=value...>', 'Environment variables')
  .action(async (server, logfile, opts) => {
    const log = new Logger({ verbose: globalOpts.verbose, quiet: globalOpts.quiet, ci: globalOpts.ci });
    const { client } = await connectClient(server, { ...opts, transport: globalOpts.transport }, log);
    const lines = fs.readFileSync(path.resolve(logfile), 'utf-8').split('\n').filter(Boolean);
    console.log(`🔁 Replaying ${lines.length} request(s)...\n`);

    for (const line of lines) {
      try {
        const req = JSON.parse(line);
        console.log(`→ ${req.method}`, req.params ? JSON.stringify(req.params).slice(0, 80) : '');
        const result = await client._send(req.method, req.params || {});
        console.log(`←`, JSON.stringify(result).slice(0, 120));
      } catch (err) {
        console.error(`  ⚠️  Error: ${err.message}`);
      }
    }

    await client.disconnect();
  });

program.parse();
