const fs = require('fs');

const services = ['auth', 'restaurant', 'utils', 'rider', 'realtime', 'admin'];
let totalLines = 0;
let coveredLines = 0;

console.log("=== Coverage by Service ===");
services.forEach(service => {
  const path = `./services/${service}/coverage/coverage-summary.json`;
  if (fs.existsSync(path)) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    totalLines += data.total.lines.total;
    coveredLines += data.total.lines.covered;
    console.log(`${service.padEnd(10)}: ${data.total.lines.pct}%`);
  } else {
    console.log(`${service.padEnd(10)}: no coverage summary found`);
  }
});

if (totalLines > 0) {
  const mergedCoverage = (coveredLines / totalLines) * 100;
  console.log(`\n=== Merged Line Coverage ===`);
  console.log(`${mergedCoverage.toFixed(2)}% (${coveredLines}/${totalLines} lines)`);
} else {
  console.log("No coverage data available.");
}
