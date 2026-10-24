// Runs one small web task through each agent CLI against a running workbench (npm start first).
import { AGENTS, runAgent } from '../src/agents.js';
const port = process.env.WORKBENCH_PORT || 7788;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(AGENTS);
const task = 'Open https://news.ycombinator.com and tell me the title of the #1 story and its URL. Use only the wb browser tools.';
await Promise.all(ids.map(id => new Promise(done => {
  let out = '';
  const t0 = Date.now();
  runAgent(id, `http://127.0.0.1:${port}/mcp/${id}`, task, {
    onOut: s => { out += s; },
    onExit: code => { console.log(`\n===== ${id} exit=${code} ${(Date.now() - t0) / 1000}s =====\n${out.slice(-1500)}`); done(); }
  });
})));
