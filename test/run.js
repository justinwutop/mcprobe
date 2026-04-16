/**
 * Enhanced test runner for mcprobe v0.2.0
 * Tests: discover → call → test → bench full chain
 */

const { MCPClient, Logger } = require('../src/index');
const { junitXML, jsonReport, tapReport } = require('../src/reporter');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function main() {
  const client = new MCPClient();
  console.log('🧪 mcprobe v0.2.0 self-tests\n');

  // ========== 1. Connect & Discover ==========
  console.log('📦 Test Group 1: Connect & Discover');
  const init = await client.connect('node', ['examples/mock-server.js']);
  assert(init.serverInfo.name === 'mock-mcp-server', 'Connected to mock server');
  assert(init.capabilities.tools !== undefined, 'Server supports tools');
  assert(init.capabilities.resources !== undefined, 'Server supports resources');
  assert(init.capabilities.prompts !== undefined, 'Server supports prompts');

  // ========== 2. Tools ==========
  console.log('\n📦 Test Group 2: Tools');
  const tools = await client.listTools();
  assert(tools.length === 3, `listTools returns 3 tools (got ${tools.length})`);

  const echo = await client.callTool('echo', { message: 'hello' });
  assert(echo.content[0].text === 'hello', 'echo returns input message');

  const add = await client.callTool('add', { a: 3, b: 7 });
  assert(add.content[0].text === '10', 'add(3,7) returns 10');

  const search = await client.callTool('search', { query: 'test', limit: 5 });
  assert(search.content[0].text.includes('test'), 'search returns results containing query');

  // ========== 3. Resources ==========
  console.log('\n📦 Test Group 3: Resources');
  const resources = await client.listResources();
  assert(resources.length === 2, `listResources returns 2 resources`);

  const readme = await client.readResource('file:///docs/readme.md');
  assert(readme.contents[0].text.includes('README'), 'readResource returns content');

  // ========== 4. Prompts ==========
  console.log('\n📦 Test Group 4: Prompts');
  const prompts = await client.listPrompts();
  assert(prompts.length === 1, 'listPrompts returns 1 prompt');

  const summary = await client.getPrompt('summarize', { document: 'Test doc' });
  assert(summary.messages.length === 1, 'getPrompt returns messages');

  // ========== 5. Test Framework (flat) ==========
  console.log('\n📦 Test Group 5: Test Framework (flat array)');
  const flatTests = [
    { name: 'echo', type: 'tool', args: { message: 'test' }, assert: [{ type: 'exists', path: 'content' }] },
    { name: 'add', type: 'tool', args: { a: 1, b: 2 }, assert: [{ type: 'equals', path: 'content.0.text', expected: '3' }] },
    { name: 'search', type: 'tool', args: { query: 'hello' }, assert: [{ type: 'contains', path: 'content.0.text', expected: 'hello' }] },
  ];
  const flatResults = await client.runTests(flatTests);
  assert(flatResults.length === 3, 'runTests returns 3 results');
  assert(flatResults.every(r => r.status === 'pass'), 'All flat tests pass');

  // ========== 6. Test Framework (suite with lifecycle) ==========
  console.log('\n📦 Test Group 6: Test Suite with Lifecycle Hooks');
  let beforeAllRan = false, afterAllRan = false, beforeEachCount = 0, afterEachCount = 0;

  const suite = {
    name: 'Lifecycle Test Suite',
    beforeAll: async () => { beforeAllRan = true; },
    afterAll: async () => { afterAllRan = true; },
    beforeEach: async () => { beforeEachCount++; },
    afterEach: async () => { afterEachCount++; },
    tests: [
      { name: 'echo', type: 'tool', args: { message: 'hook' }, assert: [{ type: 'exists', path: 'content' }] },
      { name: 'add', type: 'tool', args: { a: 5, b: 5 }, assert: [{ type: 'exists', path: 'content' }] },
    ],
  };
  const suiteResult = await client.runSuite(suite);
  assert(beforeAllRan, 'beforeAll hook ran');
  assert(afterAllRan, 'afterAll hook ran');
  assert(beforeEachCount === 2, `beforeEach ran 2 times (got ${beforeEachCount})`);
  assert(afterEachCount === 2, `afterEach ran 2 times (got ${afterEachCount})`);
  assert(suiteResult.status === 'pass', 'Suite passed');
  assert(suiteResult.summary.total === 2, 'Suite has 2 test results');

  // ========== 7. New Assertions ==========
  console.log('\n📦 Test Group 7: Advanced Assertions');
  const advTests = [
    { name: 'echo', type: 'tool', args: { message: 'schema test' }, assert: [
      { type: 'assertPerformance', maxMs: 5000 },
    ]},
    { name: 'echo', type: 'tool', args: { message: 'schema' }, assert: [
      { type: 'assertSchema', path: '', schema: { type: 'object', required: ['content'] } },
    ]},
  ];
  const advResults = await client.runTests(advTests);
  assert(advResults[0].status === 'pass', 'assertPerformance passes');
  assert(advResults[1].status === 'pass', 'assertSchema passes');

  // ========== 8. Benchmark ==========
  console.log('\n📦 Test Group 8: Benchmark');
  const bench = await client.benchmark('echo', { message: 'bench' }, { iterations: 5 });
  assert(bench.iterations === 5, 'Benchmark ran 5 iterations');
  assert(typeof bench.statistics.avg === 'number', 'Benchmark has avg');
  assert(typeof bench.statistics.p95 === 'number', 'Benchmark has p95');
  assert(typeof bench.statistics.p99 === 'number', 'Benchmark has p99');
  assert(bench.statistics.min <= bench.statistics.max, 'min ≤ max');

  // Benchmark with baseline comparison
  const baseline = { statistics: { avg: bench.statistics.avg * 2 } };
  const benchCmp = await client.benchmark('echo', { message: 'cmp' }, { iterations: 3, baseline });
  assert(benchCmp.comparison !== undefined, 'Baseline comparison present');
  assert(typeof benchCmp.comparison.diff === 'number', 'Comparison has diff');

  // ========== 9. Reporters ==========
  console.log('\n📦 Test Group 9: Reporters');
  const junit = junitXML(suiteResult);
  assert(junit.includes('<?xml'), 'JUnit report has XML header');
  assert(junit.includes('<testsuite'), 'JUnit report has testsuite');
  assert(junit.includes('<testcase'), 'JUnit report has testcases');

  const json = jsonReport(suiteResult);
  const parsed = JSON.parse(json);
  assert(parsed.name === 'Lifecycle Test Suite', 'JSON reporter works');

  const tap = tapReport(suiteResult);
  assert(tap.startsWith('1..2'), 'TAP reporter starts with plan');
  assert(tap.includes('ok'), 'TAP has ok results');

  // ========== 10. Error Handling ==========
  console.log('\n📦 Test Group 10: Error Handling');
  try {
    await client.callTool('nonexistent_tool', {});
    assert(false, 'Should have thrown for unknown tool');
  } catch (err) {
    assert(err.message.includes('Unknown tool'), 'Unknown tool gives friendly error');
  }

  // ========== 11. Logger ==========
  console.log('\n📦 Test Group 11: Logger');
  const logger = new Logger({ verbose: true, ci: true });
  assert(logger.verbose === true, 'Logger verbose mode');
  assert(logger.ci === true, 'Logger CI mode');
  assert(logger._c(92, 'test') === 'test', 'CI mode strips colors');

  const quietLogger = new Logger({ quiet: true });
  assert(quietLogger.quiet === true, 'Logger quiet mode');

  await client.disconnect();

  // ========== Summary ==========
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Total: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('🎉 ALL TESTS PASSED!');
  }
}

main().catch((err) => {
  console.error('❌ Test runner failed:', err.message);
  process.exit(1);
});
