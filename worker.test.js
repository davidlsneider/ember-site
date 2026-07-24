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
          if (path === "/hero.js") {
            return new Response("/* animation */", { headers: { "content-type": "text/javascript" } });
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
  assert.equal(res.headers.get("x-robots-tag"), null);
});

test("retired pages and the old whitepaper resolve to the homepage", async () => {
  const { env, assetRequests } = testEnv();
  for (const path of [
    "/briefing/",
    "/compare/",
    "/developers/",
    "/questionnaire/",
    "/whitepaper/",
    "/whitepaper/ember-whitepaper.pdf",
  ]) {
    const res = await worker.fetch(new Request(`https://embersovereignty.com${path}`), env);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://embersovereignty.com/");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  }
  assert.deepEqual(assetRequests, []);
});

test("the animation, workflow, and success page remain public", async () => {
  const { env, assetRequests } = testEnv();
  const animation = await worker.fetch(new Request("https://embersovereignty.com/hero.js"), env);
  const workflow = await worker.fetch(new Request("https://embersovereignty.com/how-it-works/"), env);
  const success = await worker.fetch(new Request("https://embersovereignty.com/briefing/sent/"), env);
  assert.equal(animation.status, 200);
  assert.equal(workflow.status, 200);
  assert.equal(success.status, 200);
  assert.equal(workflow.headers.get("x-robots-tag"), null);
  assert.equal(success.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.deepEqual(assetRequests, ["/hero.js", "/how-it-works/", "/briefing/sent/"]);
});

test("a one-field homepage access request is stored", async () => {
  const { env, leads } = testEnv();
  const res = await worker.fetch(formRequest({
    source: "homepage",
    email: "prospect@example.com",
  }), env);

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "https://embersovereignty.com/briefing/sent/");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].email, "prospect@example.com");
  assert.equal(leads[0].source, "homepage");
  assert.equal(leads[0].name, "");
  assert.equal(leads[0].company, "");
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
