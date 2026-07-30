import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

const projectFile = (name: string) => path.join(process.cwd(), name);
const bytes = (name: string) => fs.statSync(projectFile(name)).size;
const gzipBytes = (name: string) => gzipSync(fs.readFileSync(projectFile(name))).length;

test("the lightweight shell stays inside its delivery budgets", () => {
  assert.ok(bytes("templates/index.html") <= 6_000, "HTML shell exceeded 6 KB");
  assert.ok(gzipBytes("static/css/style.css") <= 9_000, "compressed CSS exceeded 9 KB");
  assert.ok(gzipBytes("static/js/app.js") <= 36_000, "compressed core JavaScript exceeded 36 KB");
});

test("graph behavior remains a separately loaded route module", () => {
  const application = fs.readFileSync(projectFile("static/js/app.js"), "utf8");
  assert.match(application, /import\("\/js\/graph\.js\?v=1"\)/);
  assert.ok(bytes("static/js/graph.js") <= 10_000, "graph route module exceeded 10 KB");
});

test("live scans use one cancellable event stream instead of rapid polling", () => {
  const application = fs.readFileSync(projectFile("static/js/app.js"), "utf8");
  assert.match(application, /new EventSource/);
  assert.doesNotMatch(application, /setTimeout\(\(\) => pollJob\(jobId\), 700\)/);
});
