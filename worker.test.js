import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

function testEnv() {
  const leads = [];
  const assetRequests = [];
  const vault = {
    async fetch(_url, init) {
      if (init?.method === "POST") leads.push(JSON.parse(init.body));
      return new Response("ok");
    },
  };
  return {
    leads,
    assetRequests,
    env: {
      ASSETS: {
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          assetRequests.push(path);
          if (path === "/whitepaper/ember-whitepaper.pdf") {
            return new Response("%PDF-test", { headers: { "content-type": "application/pdf" } });
          }
          return new Response("<h1>Ember</h1>", { headers: { "content-type": "text/html" } });
        },
      },
      BRIEFING_VAULT: {
        idFromName: (name) => name,
        get: () => vault,
      },
    },
  };
}

function formRequest(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request("https://embersovereignty.com/api/briefing", { method: "POST", body: form });
}

test("static responses receive the security baseline", async () => {
  const { env } = testEnv();
  const res = await worker.fetch(new Request("https://embersovereignty.com/"), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});

test("the canonical whitepaper URL serves the PDF inline", async () => {
  const { env, assetRequests } = testEnv();
  for (const path of ["/whitepaper", "/whitepaper/"]) {
    const res = await worker.fetch(new Request(`https://embersovereignty.com${path}`), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-disposition"), 'inline; filename="ember-sovereignty-whitepaper.pdf"');
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
  assert.deepEqual(assetRequests, [
    "/whitepaper/ember-whitepaper.pdf",
    "/whitepaper/ember-whitepaper.pdf",
  ]);
});

test("a valid pilot request is stored without inferred location", async () => {
  const { env, leads } = testEnv();
  const res = await worker.fetch(formRequest({
    name: "Pilot User",
    email: "pilot@example.com",
    company: "Example",
    role: "Engineer",
    deal: "An agent workload",
  }), env);

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "https://embersovereignty.com/briefing/sent/");
  assert.equal(leads.length, 1);
  assert.equal("city" in leads[0], false);
  assert.equal("country" in leads[0], false);
});

test("missing required fields are rejected", async () => {
  const { env, leads } = testEnv();
  const res = await worker.fetch(formRequest({
    name: "Pilot User",
    email: "pilot@example.com",
    company: "",
  }), env);

  assert.equal(res.status, 400);
  assert.equal(leads.length, 0);
});

test("the honeypot does not persist a lead", async () => {
  const { env, leads } = testEnv();
  const res = await worker.fetch(formRequest({ website: "https://spam.example" }), env);
  assert.equal(res.status, 303);
  assert.equal(leads.length, 0);
});
