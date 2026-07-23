/* Hero field: cosmic dust and a blue nebula at geological pace — one quiet star
   inside a single thin attested ring. Canvas 2D, no dependencies. External file
   because the Worker CSP forbids inline script. */
(() => {
  "use strict";
  const canvas = document.getElementById("ember-field");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Deterministic RNG so the reduced-motion still frame is reproducible. */
  let seed = 0x9e3779b9;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const GLOW = "159,203,255", WHITE = "242,247,255";

  /* ---- value noise / fbm ---- */
  const perm = new Uint8Array(512);
  {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const s = p[i]; p[i] = p[j]; p[j] = s; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const lat = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
  const sstep = (a) => a * a * a * (a * (a * 6 - 15) + 10);
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = sstep(x - xi), v = sstep(y - yi);
    const a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => {
    let n = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) { n += vnoise(x * f, y * f) * amp; f *= 2; amp *= 0.55; }
    return n / 1.13;
  };

  let W = 0, H = 0, DPR = 1, S = 1, bandA = -0.30, cosA = 1, sinA = 0, halfw = 0.16;
  const star = { x: 0, y: 0 };
  let nebula = [], dust = [], nodes = [];
  let t = 0, last = 0, raf = 0, running = false, revealed = false;

  const sprite = (rgb) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.35, `rgba(${rgb},.45)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return c;
  };
  const spWhite = sprite(WHITE), spGlow = sprite(GLOW), spEmber = sprite("77,159,255");
  const blit = (sp, x, y, r, a) => {
    ctx.globalAlpha = a;
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
  };

  /* One coherent cloud field, three thresholded readings of it: deep indigo
     body, mid-blue structure, pale highlights only in the densest wisps. */
  const renderNebula = () => {
    const rw = Math.min(520, Math.max(160, Math.ceil(W / 3)));
    const rh = Math.max(100, Math.ceil(rw * H / W));
    const aspect = W / H;
    const su = (star.x / W) * aspect, sv = star.y / H;
    const field = new Float32Array(rw * rh);
    const detail = new Float32Array(rw * rh);
    const mask = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const u = (x / rw) * aspect, v = y / rh;
        /* domain warp → wispy filaments instead of blobs */
        const wx = fbm(u * 1.3 + 7.7, v * 1.3 + 3.1) - 0.5;
        const wy = fbm(u * 1.3 + 15.2, v * 1.3 + 9.4) - 0.5;
        const px = u + wx * 0.85, py = v + wy * 0.85;
        const i = y * rw + x;
        field[i] = fbm(px * 3.0, py * 3.0);
        detail[i] = fbm(px * 6.2 + 31.7, py * 6.2 + 11.3);
        /* diagonal band through the star + soft radial pool around it */
        const dx = u - su, dy = v - sv;
        const d = Math.abs(dx * -sinA + dy * cosA);
        const r2 = dx * dx + dy * dy;
        mask[i] = Math.exp(-(d * d) / (halfw * halfw)) + Math.exp(-r2 / 0.12) * 0.5;
      }
    }
    const layer = (tint, alpha, thr, mix) => {
      const c = document.createElement("canvas");
      c.width = rw; c.height = rh;
      const x = c.getContext("2d");
      const img = x.createImageData(rw, rh);
      const D = img.data;
      for (let i = 0; i < rw * rh; i++) {
        const n = field[i] * (1 - mix) + detail[i] * mix;
        let I = (n - thr) / (1 - thr);
        if (I <= 0) continue;
        I = Math.pow(I, 1.6) * Math.min(1.15, mask[i]);
        const o = i * 4;
        D[o] = tint[0]; D[o + 1] = tint[1]; D[o + 2] = tint[2];
        D[o + 3] = Math.max(0, Math.min(255, I * alpha * 255 + (rand() - 0.5) * 5));
      }
      x.putImageData(img, 0, 0);
      return c;
    };
    nebula = [
      { c: layer([22, 46, 98], 1.0, 0.22, 0.0), amp: 10, tau: 63, ph: 0.0, btau: 41, ba: 1.0 },
      { c: layer([52, 104, 196], 0.72, 0.40, 0.25), amp: 14, tau: 47, ph: 2.1, btau: 29, ba: 0.9 },
      { c: layer([139, 182, 244], 0.46, 0.56, 0.55), amp: 18, tau: 37, ph: 4.2, btau: 23, ba: 0.8 },
    ];
  };

  const initDust = () => {
    dust = [];
    const n = Math.min(900, Math.max(300, Math.round(W * H / 2600)));
    for (let i = 0; i < n; i++) {
      const z = rand();                       /* depth: far 0 → near 1 */
      dust.push({
        x: rand() * (W + 40) - 20, y: rand() * (H + 40) - 20, z,
        sz: 0.5 + z * 1.3,
        a: 0.04 + z * 0.20 * (0.4 + 0.6 * rand()),
        sp: (3 + 8 * z) * S * (0.7 + 0.6 * rand()),
        tau: 6 + 9 * rand(), ph: rand() * 6.28,
      });
    }
    nodes = [{ ph: 0 }, { ph: Math.PI }];
  };

  const step = (dt) => {
    t += dt;
    for (const p of dust) {
      p.x += cosA * p.sp * dt;
      p.y += sinA * p.sp * dt;
      if (p.x > W + 20) p.x = -20; else if (p.x < -20) p.x = W + 20;
      if (p.y > H + 20) p.y = -20; else if (p.y < -20) p.y = H + 20;
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    /* nebula: overscanned, floating a few px on long periods */
    for (const L of nebula) {
      const ox = Math.sin(t / L.tau + L.ph) * L.amp;
      const oy = Math.cos(t / (L.tau * 1.4) + L.ph) * L.amp * 0.6;
      ctx.globalAlpha = L.ba * (0.92 + 0.08 * Math.sin(t / L.btau + L.ph));
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(L.c, -W * 0.06 + ox, -H * 0.06 + oy, W * 1.12, H * 1.12);
    }

    /* dust: only the far grains twinkle, slowly */
    for (const p of dust) {
      const tw = p.z < 0.4 ? 0.7 + 0.3 * Math.sin(t / p.tau + p.ph) : 1;
      ctx.globalAlpha = p.a * tw;
      ctx.fillStyle = `rgba(${GLOW},1)`;
      if (p.z > 0.9) blit(spGlow, p.x, p.y, p.sz * 2.4, p.a * tw);
      else ctx.fillRect(p.x, p.y, p.sz, p.sz);
    }

    /* the attested ring: one thin ellipse, two slow nodes */
    ctx.save();
    ctx.translate(star.x, star.y); ctx.rotate(bandA);
    ctx.strokeStyle = `rgba(${GLOW},0.18)`;
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 150 * S, 40 * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    for (let i = 0; i < nodes.length; i++) {
      const th = t * (Math.PI * 2 / 90) + nodes[i].ph;
      const ex = Math.cos(th) * 150 * S, ey = Math.sin(th) * 40 * S;
      const nx = star.x + ex * cosA - ey * sinA;
      const ny = star.y + ex * sinA + ey * cosA;
      blit(spGlow, nx, ny, 4.5 * S, 0.35 + 0.25 * Math.sin(t / 7 + i * 3));
    }

    /* the star: quiet, smolder cadence shared with the brand dot (4.4s) */
    const smolder = 1 + 0.05 * Math.sin(t * (Math.PI * 2) / 4.4) + 0.03 * Math.sin(t * 3.7 + 1.3);
    blit(spEmber, star.x, star.y, 160 * S, 0.26 * smolder);
    blit(spGlow, star.x, star.y, 72 * S, 0.40 * smolder);
    blit(spWhite, star.x, star.y, 11 * S, 0.92);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  const frame = (now) => {
    raf = 0;
    const el = now - last;
    if (el < 15) { if (running) raf = requestAnimationFrame(frame); return; }  /* ~60fps cap */
    const dt = Math.min(0.05, el / 1000 || 0.016);
    last = now;
    step(dt);
    draw();
    if (!revealed) { revealed = true; canvas.classList.add("on"); }
    if (running) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || reduced) return;
    running = true; last = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };

  const fit = () => {
    if (!innerWidth || !innerHeight) return;
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(1.3, Math.max(0.55, Math.min(W, H) / 860));
    const narrow = W < 720;
    bandA = narrow ? -0.52 : -0.30;
    cosA = Math.cos(bandA); sinA = Math.sin(bandA);
    halfw = narrow ? 0.24 : 0.19;
    star.x = narrow ? W * 0.60 : W * 0.68;
    star.y = narrow ? H * 0.80 : H * 0.40;
    renderNebula();
    initDust();
    t = 13;                                  /* pleasing phase for the first frame */
    if (reduced) { draw(); canvas.classList.add("on"); }
  };

  /* the field is fixed to the viewport; ignore mobile URL-bar height jitter */
  let rt = 0, lastW = 0, lastH = 0;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 160) return;
      lastW = innerWidth; lastH = innerHeight;
      fit();
    }, 150);
  };
  addEventListener("resize", onResize);
  lastW = innerWidth; lastH = innerHeight;
  fit();

  if (!reduced) {
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  }
})();
