/**
 * mcprobe - Reporter module
 * Supports JUnit XML, JSON, and TAP output formats.
 * @module mcprobe/reporter
 */

/**
 * Generate JUnit XML report from test results.
 * @param {object} suiteResult - Suite result from runSuite()
 * @returns {string} JUnit XML string
 */
function junitXML(suiteResult) {
  const results = suiteResult.results || suiteResult;
  const name = suiteResult.name || 'mcprobe-tests';
  const total = results.length;
  const failures = results.filter(r => r.status === 'fail').length;
  const errors = results.filter(r => r.status === 'error').length;
  const time = (suiteResult.elapsed || 0) / 1000;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites>\n`;
  xml += `  <testsuite name="${esc(name)}" tests="${total}" failures="${failures}" errors="${errors}" time="${time}">\n`;

  for (const r of results) {
    xml += `    <testcase name="${esc(r.name)}" classname="${esc(r.type)}" time="${(r.elapsed || 0) / 1000}">\n`;
    if (r.status === 'fail') {
      const msgs = (r.assertions || []).filter(a => !a.pass).map(a => esc(a.message)).join('; ');
      xml += `      <failure message="Assertion failed">${msgs}</failure>\n`;
    }
    if (r.status === 'error') {
      xml += `      <error message="Error">${esc(r.error || 'Unknown error')}</error>\n`;
    }
    xml += `    </testcase>\n`;
  }

  xml += `  </testsuite>\n</testsuites>`;
  return xml;
}

/**
 * Generate JSON report from test results.
 * @param {object} suiteResult - Suite result
 * @returns {string} JSON string
 */
function jsonReport(suiteResult) {
  return JSON.stringify(suiteResult, null, 2);
}

/**
 * Generate TAP (Test Anything Protocol) report.
 * @param {object} suiteResult - Suite result
 * @returns {string} TAP string
 */
function tapReport(suiteResult) {
  const results = suiteResult.results || suiteResult;
  let lines = [`1..${results.length}`];
  results.forEach((r, i) => {
    const ok = r.status === 'pass' ? 'ok' : 'not ok';
    lines.push(`${ok} ${i + 1} - ${r.name} (${r.type})`);
    if (r.status === 'fail' && r.assertions) {
      for (const a of r.assertions) {
        if (!a.pass) lines.push(`  # ${a.message}`);
      }
    }
    if (r.error) lines.push(`  # Error: ${r.error}`);
  });
  return lines.join('\n');
}

/**
 * Escapes XML special characters.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format benchmark results for display.
 * @param {object} bench - Benchmark result
 * @returns {string[]} Lines of formatted output
 */
function formatBenchmark(bench) {
  const s = bench.statistics;
  const lines = [
    `  Average: ${s.avg}ms`,
    `  Min:     ${s.min}ms`,
    `  Max:     ${s.max}ms`,
    `  P50:     ${s.p50}ms`,
    `  P95:     ${s.p95}ms`,
    `  P99:     ${s.p99}ms`,
    `  StdDev:  ${s.stddev}ms`,
  ];
  if (bench.comparison) {
    const c = bench.comparison;
    lines.push(`  --- Baseline Comparison ---`);
    lines.push(`  Baseline avg: ${c.baselineAvg}ms`);
    lines.push(`  Current avg:  ${c.currentAvg}ms`);
    lines.push(`  Diff:         ${c.diff > 0 ? '+' : ''}${c.diff}ms`);
    if (c.regression) lines.push(`  ⚠️  Regression detected (>20% slower)`);
  }
  return lines;
}

module.exports = { junitXML, jsonReport, tapReport, formatBenchmark };
