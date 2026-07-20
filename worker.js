// Serves the static site; handles POST /api/briefing.
//
// Every valid submission is stored in the BriefingVault Durable Object,
// so no lead is lost even with no email leg configured. If a send_email
// binding (BRIEFING_EMAIL) is present, a copy is also emailed; storage
// is the source of truth either way. See site/DEPLOY.md for the state
// of the email leg.
//
// GET /api/briefing/export  (Authorization: Bearer <EXPORT_KEY>)
// returns all captured leads as JSON, oldest first.

const FROM = "briefing@embersovereignty.com"; // used only when an email leg exists
const FALLBACK = "david@litprotocol.com";

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
    if (url.pathname === "/api/briefing") {
      if (request.method !== "POST") {
        return Response.redirect(new URL("/briefing/", url).toString(), 303);
      }
      return handleBriefing(request, env, url);
    }
    if (url.pathname === "/api/briefing/export") {
      return handleExport(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

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
    city: request.cf?.city || "",
    country: request.cf?.country || "",
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
  if (env.BRIEFING_EMAIL) {
    try {
      await sendLeadEmail(env, lead);
      emailed = true;
    } catch (e) {
      console.error("briefing send failed:", e && e.message);
    }
  }

  if (!stored && !emailed) {
    return errPage(
      500,
      `We couldn’t record this just now. Nothing was lost on your side. Please send it straight to ${FALLBACK} and we’ll pick it up there.`
    );
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
  const dest = env.BRIEFING_EMAIL_DEST || FALLBACK;
  const when = lead.id.slice(0, 16).replace("T", " ") + " UTC";
  const where = [lead.city, lead.country].filter(Boolean).join(", ");
  const body = [
    `Name:    ${lead.name}`,
    `Email:   ${lead.email}`,
    `Company: ${lead.company}`,
    `Role:    ${lead.role || "—"}`,
    ``,
    `The deal that's stuck:`,
    lead.deal || "—",
    ``,
    `—`,
    `${when}${where ? " · " + where : ""} · embersovereignty.com/briefing`,
  ].join("\n");
  const raw = [
    `From: Ember Briefing <${FROM}>`,
    `Reply-To: <${lead.email}>`,
    `To: <${dest}>`,
    `Subject: ${header2047(`Briefing request — ${lead.company} (${lead.name})`)}`,
    `Message-ID: <${crypto.randomUUID()}@embersovereignty.com>`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64wrap(body),
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.BRIEFING_EMAIL.send(new EmailMessage(FROM, dest, raw));
}

// RFC 2047 encode a header value when it isn't plain ASCII.
function header2047(s) {
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?utf-8?B?${b64(s)}?=`;
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64wrap(s) {
  return b64(s).replace(/(.{76})/g, "$1\r\n");
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
<p><a href="/briefing/">&larr; back to the form</a> · <a href="mailto:${FALLBACK}">${FALLBACK}</a></p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
