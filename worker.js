// Serves the static site; handles POST /api/briefing.
//
// Every valid submission is stored in the BriefingVault Durable Object,
// so no lead is lost even if the email leg fails. When RESEND_API_KEY
// is set, a copy is emailed to DEST via Resend (from the Resend-verified
// updates. subdomain, which leaves the zone's Google MX untouched).
// Storage is the source of truth either way.
//
// GET /api/briefing/export  (Authorization: Bearer <EXPORT_KEY>)
// returns all captured leads as JSON, oldest first.

const FROM = "Ember Briefing <briefing@updates.embersovereignty.com>";
const DEST = "david@litprotocol.com";

export class BriefingVault {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/store") {
      const lead = await request.json();
      await this.state.storage.put(lead.id, lead);
      return new Response("ok");
    }
    if (request.method === "GET" && url.pathname === "/export") {
      const map = await this.state.storage.list();
      return Response.json([...map.values()]);
    }
    return new Response("not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/whitepaper" || url.pathname === "/whitepaper/") {
      return handleWhitepaper(request, env, url);
    }
    if (url.pathname === "/api/briefing") {
      if (request.method !== "POST") {
        return Response.redirect(new URL("/briefing/", url).toString(), 303);
      }
      return handleBriefing(request, env, url);
    }
    if (url.pathname === "/api/briefing/export") {
      return handleExport(request, env);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};

async function handleWhitepaper(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSecurityHeaders(new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    }));
  }

  const assetUrl = new URL("/whitepaper/ember-whitepaper.pdf", url);
  const pdf = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!pdf.ok) return withSecurityHeaders(pdf);

  const headers = new Headers(pdf.headers);
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", 'inline; filename="ember-sovereignty-whitepaper.pdf"');
  headers.set("cache-control", "public, max-age=3600");
  return withSecurityHeaders(new Response(pdf.body, {
    status: pdf.status,
    statusText: pdf.statusText,
    headers,
  }));
}

async function handleBriefing(request, env, url) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return errPage(400, "That didn’t arrive as a form submission.");
  }

  // Header-bound values: collapse CR/LF so nothing can inject mail headers.
  const line = (n) => (form.get(n) ?? "").toString().replace(/[\r\n]+/g, " ").trim();
  const name = line("name").slice(0, 200);
  const email = line("email").slice(0, 254);
  const company = line("company").slice(0, 200);
  const role = line("role").slice(0, 200);
  const deal = (form.get("deal") ?? "").toString().trim().slice(0, 5000);

  // Honeypot filled → a bot. Pretend it worked.
  if (line("website")) {
    return Response.redirect(new URL("/briefing/sent/", url).toString(), 303);
  }
  if (!name || !company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errPage(400, "Name, work email, and company are required.");
  }

  const lead = {
    id: `${new Date().toISOString()}_${crypto.randomUUID().slice(0, 8)}`,
    name,
    email,
    company,
    role,
    deal,
  };

  let stored = false;
  try {
    const vault = env.BRIEFING_VAULT.get(env.BRIEFING_VAULT.idFromName("v1"));
    const res = await vault.fetch("https://vault/store", {
      method: "POST",
      body: JSON.stringify(lead),
    });
    stored = res.ok;
  } catch (e) {
    console.error("briefing store failed:", e && e.message);
  }

  let emailed = false;
  if (env.RESEND_API_KEY) {
    try {
      await sendLeadEmail(env, lead);
      emailed = true;
    } catch (e) {
      console.error("briefing send failed:", e && e.message);
    }
  }

  if (!stored && !emailed) {
    return errPage(500, "We couldn’t record this just now. Please go back and try again in a minute.");
  }
  console.log(`briefing lead captured: ${lead.id} (${lead.company})`);
  return Response.redirect(new URL("/briefing/sent/", url).toString(), 303);
}

async function handleExport(request, env) {
  if (!env.EXPORT_KEY) {
    return new Response("export key not configured", { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(given, env.EXPORT_KEY)) {
    return new Response("unauthorized", { status: 401 });
  }
  const vault = env.BRIEFING_VAULT.get(env.BRIEFING_VAULT.idFromName("v1"));
  return vault.fetch("https://vault/export");
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function sendLeadEmail(env, lead) {
  const when = lead.id.slice(0, 16).replace("T", " ") + " UTC";
  const text = [
    `Name:    ${lead.name}`,
    `Email:   ${lead.email}`,
    `Company: ${lead.company}`,
    `Role:    ${lead.role || "—"}`,
    ``,
    `The deal that's stuck:`,
    lead.deal || "—",
    ``,
    `—`,
    `${when} · embersovereignty.com/briefing`,
  ].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [DEST],
      reply_to: lead.email,
      subject: `Briefing request — ${lead.company} (${lead.name})`,
      text,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const { id } = await res.json();
  console.log(`briefing email sent: ${id}`);
}

function errPage(status, msg) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Ember — Hmm</title><style>
body{background:#0A0E14;color:#8CA0B8;font:400 17px/1.7 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:660px;margin:0 auto;padding:64px 24px}
h1{color:#F2F7FF;font-size:28px;margin:0 0 14px}
a{color:#4D9FFF}</style></head><body><div class="wrap">
<h1>That didn’t go through.</h1>
<p>${msg}</p>
<p><a href="/briefing/">&larr; back to the form</a></p>
</div></body></html>`;
  return withSecurityHeaders(new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  }));
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; upgrade-insecure-requests");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
