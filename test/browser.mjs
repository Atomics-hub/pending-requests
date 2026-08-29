import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const modulePath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const html = `<!doctype html><meta charset="utf-8"><pre id="result">running</pre><script type="module">
import { PendingRequests, DuplicatePendingRequestError, PendingRequestTimeoutError } from "/index.js";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const outcome = (promise) => promise.then(value => ({ok:true,value}), value => ({ok:false,value}));
const orphans = [];
const registry = new PendingRequests({onOrphan:event => orphans.push(event)});
assert(await registry.request("sync", () => registry.resolve("sync", 42)) === 42, "sync");
const controller = new AbortController();
const add = controller.signal.addEventListener.bind(controller.signal);
const remove = controller.signal.removeEventListener.bind(controller.signal);
let listeners = 0;
controller.signal.addEventListener = (type, listener, options) => { if (type === "abort") listeners++; return add(type, listener, options); };
controller.signal.removeEventListener = (type, listener, options) => { if (type === "abort") listeners--; return remove(type, listener, options); };
const pending = Array.from({length:10_000}, (_, id) => outcome(registry.register(id, {signal:controller.signal})));
assert(listeners === 1, "one listener");
controller.abort(new Error("transport"));
assert((await Promise.all(pending)).every(result => !result.ok), "abort all");
assert(listeners === 0 && registry.size === 0, "abort cleanup");
const timed = await outcome(registry.register("timeout", {timeout:0}));
assert(timed.value instanceof PendingRequestTimeoutError, "timeout");
const first = registry.register("same");
let duplicate = false;
try { registry.register("same"); } catch (error) { duplicate = error instanceof DuplicatePendingRequestError; }
assert(duplicate, "duplicate"); registry.resolve("same", 1); await first;
assert(registry.resolve("late", 1) === false && orphans.length === 1, "orphan");
const throwing = new PendingRequests({onOrphan: () => { throw new Error("diagnostic"); }});
assert(throwing.resolve("unknown", 1) === false, "diagnostic isolation");
document.querySelector("#result").textContent = JSON.stringify({passed:true, requests:10007, remaining:registry.size});
</script>`;

const server = createServer((request, response) => {
  if (request.url === "/index.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    createReadStream(modulePath).pipe(response);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Unable to bind browser test server");

let browser;
try {
  const launchOptions =
    process.platform === "darwin" && !process.env.CI
      ? { channel: "chrome" }
      : {};
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() =>
    document.querySelector("#result")?.textContent?.includes('"passed":true'),
  );
  const result = JSON.parse(await page.locator("#result").textContent());
  if (errors.length > 0) throw errors[0];
  if (!result.passed || result.remaining !== 0)
    throw new Error(`Browser result failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ browser: await browser.version(), ...result }));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
