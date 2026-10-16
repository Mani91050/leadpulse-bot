const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 8080;
const BASE_DIR = __dirname;
const LEADS_FILE = path.join(BASE_DIR, 'leads.json');
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');
const AUTH_DIR = path.join(BASE_DIR, 'wa_auth_info');

// Abdulrehman's 9 Live Vercel Demos
const DEMO_MAP = {
  gym: { name: 'Ember & Oak — Boutique Gym & Fitness', url: 'https://instant-crystal-jrl47xi.vercel.app/' },
  bakery: { name: 'Saffron & Crumb — Luxury Bakery & Cafe', url: 'https://agile-mesa-xz9bwog.vercel.app/' },
  dental: { name: 'Apex Dental — Specialist Dental Clinic', url: 'https://flying-slate-zsosr3m.vercel.app/' },
  tech: { name: 'NovaTech Systems — Computer & Phone Repair', url: 'https://nimble-redwood-oqmd48k.vercel.app/' },
  hvac: { name: 'NorthStar Pro — HVAC & Home Services', url: 'https://fast-marsh-cgkbhxj.vercel.app' },
  travel: { name: 'WeCheaperTours — Daylight Travel & Tour Agency', url: 'https://brisk-pulsar-buin3q6.vercel.app/' },
  auto: { name: 'FMC Auto — Auto Parts & Garage Counter', url: 'https://speedy-scarlet-qid4ny4.vercel.app' },
  electronics: { name: 'Electronics Plus — Home Appliances Showroom', url: 'https://electronics-plus.vercel.app' },
  salon: { name: 'Halcyon — Luxury Salon & Boutique', url: 'https://plinth-demo.vercel.app' }
};

// Global rotation queue for Autonomous Hunting
const GLOBAL_TARGETS = [
  { city: 'Manchester', country: 'United Kingdom', niche: 'gym' },
  { city: 'Birmingham', country: 'United Kingdom', niche: 'tech' },
  { city: 'Leeds', country: 'United Kingdom', niche: 'bakery' },
  { city: 'Toronto', country: 'Canada', niche: 'dental' },
  { city: 'Bristol', country: 'United Kingdom', niche: 'salon' },
  { city: 'Glasgow', country: 'United Kingdom', niche: 'hvac' },
  { city: 'Mississauga', country: 'Canada', niche: 'auto' },
  { city: 'Liverpool', country: 'United Kingdom', niche: 'travel' },
  { city: 'Sheffield', country: 'United Kingdom', niche: 'electronics' },
  { city: 'Dublin', country: 'Ireland', niche: 'gym' },
  { city: 'Vancouver', country: 'Canada', niche: 'bakery' },
  { city: 'Nottingham', country: 'United Kingdom', niche: 'tech' }
];

let targetCursor = 0;
let activityLogs = [];

function addLog(msg, type = 'info') {
  const ts = new Date().toISOString().slice(11, 19);
  const entry = { time: ts, msg, type };
  activityLogs.unshift(entry);
  if (activityLogs.length > 120) activityLogs.pop();
  console.log(`[${ts}] [${type.toUpperCase()}] ${msg}`);
}

function loadConfig() {
  const def = {
    sender_name: 'Abdulrehman',
    gmail_user: '',
    gmail_app_password: '',
    whatsapp_number: '',
    autopilot_enabled: false,
    min_score_to_send: 80,
    delay_seconds: 35,
    sent_email_count: 0,
    sent_wa_count: 0
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {}
  return def;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadLeads() {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ================= WHATSAPP BAILEYS ENGINE =================
let waSocket = null;
let waState = {
  connected: false,
  qrDataUrl: null,
  pairingCode: null,
  statusText: 'Disconnected — Click "Connect WhatsApp QR" to link your phone',
  me: null
};

async function startWhatsApp(forceReset = false) {
  try {
    if (forceReset && fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      waState.qrDataUrl = null;
      waState.pairingCode = null;
      waState.connected = false;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const vInfo = await fetchLatestBaileysVersion();
      if (vInfo && vInfo.version) version = vInfo.version;
    } catch (e) {}

    waState.statusText = 'Generating WhatsApp QR Code...';
    addLog('Starting WhatsApp Web Multi-Device Engine...', 'wa');

    waSocket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['LeadPulse AI Agency Bot', 'Chrome', '122.0.0']
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waState.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
        waState.connected = false;
        waState.statusText = 'Scan this QR Code in WhatsApp → Linked Devices → Link a Device';
        addLog('New WhatsApp QR Code generated. Scan with your phone to connect!', 'wa');
      }

      if (connection === 'open') {
        waState.connected = true;
        waState.qrDataUrl = null;
        waState.pairingCode = null;
        waState.me = waSocket.user ? waSocket.user.id.split(':')[0] : 'Connected';
        waState.statusText = `Connected as +${waState.me}`;
        addLog(`✅ WhatsApp Connected Successfully as +${waState.me}! Bot can now send WhatsApp messages on its own.`, 'success');
      }

      if (connection === 'close') {
        waState.connected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          waState.statusText = 'Reconnecting to WhatsApp...';
          setTimeout(() => startWhatsApp(false), 4000);
        } else {
          waState.statusText = 'Logged out — Click Connect WhatsApp to generate a fresh QR';
          waState.qrDataUrl = null;
        }
      }
    });
  } catch (err) {
    waState.statusText = 'Error starting WhatsApp: ' + err.message;
    addLog('WhatsApp init error: ' + err.message, 'error');
  }
}

// Format phone into international digits for WhatsApp JID
function normalizePhoneForWA(rawPhone, country = '') {
  if (!rawPhone) return '';
  let p = rawPhone.replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!p.startsWith('+')) {
    const c = (country || '').toLowerCase();
    if (c.includes('united kingdom') || c.includes('uk')) {
      if (p.startsWith('0')) p = '44' + p.slice(1);
    } else if (c.includes('canada') || c.includes('usa') || c.includes('united states')) {
      if (p.length === 10) p = '1' + p;
    } else if (c.includes('ireland')) {
      if (p.startsWith('0')) p = '353' + p.slice(1);
    }
  }
  return p.replace(/\D/g, '');
}

// Build personalized pitch for a lead
function buildPitch(lead, cfg) {
  const sender = cfg.sender_name || 'Abdulrehman';
  const broken = (lead.website_status || '').includes('DEAD') || (lead.website_status || '').includes('BROKEN');
  const hook = broken
    ? `I was looking up ${lead.name} in ${lead.city} today and noticed your website (${lead.website}) is currently returning an error / offline.`
    : `I came across ${lead.name} in ${lead.city} today and noticed you don't currently have a dedicated online booking/ordering website linked.`;

  const subject = `Quick question for ${lead.name} (+ live website demo I built for you)`;
  const text = `Hi ${lead.name} Team! 👋\n\n${hook}\n\nTo save you time, I put together a live, mobile-ready website concept tailored for ${lead.name} with instant WhatsApp booking & customer inquiries built in:\n\n🌐 Live Demo: ${lead.demo_url}\n\nIf you like this style, I can customize it 100% with your logo, photos, prices, and domain within 48 hours (we offer either a simple one-time package or a low monthly plan).\n\nTake a 30-second look at the link above and tell me what you think!\n\nBest regards,\n${sender}`;

  return { subject, text };
}

// Send automated Email via Nodemailer
async function sendEmailAuto(lead, cfg) {
  if (!cfg.gmail_user || !cfg.gmail_app_password) {
    return { ok: false, reason: 'Gmail not connected' };
  }
  if (!lead.email || !lead.email.includes('@')) {
    return { ok: false, reason: 'Lead has no email' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: cfg.gmail_user.trim(),
        pass: cfg.gmail_app_password.replace(/\s+/g, '')
      }
    });

    const { subject, text } = buildPitch(lead, cfg);
    await transporter.sendMail({
      from: `"${cfg.sender_name || 'Abdulrehman'}" <${cfg.gmail_user.trim()}>`,
      to: lead.email.trim(),
      subject,
      text
    });

    cfg.sent_email_count = (cfg.sent_email_count || 0) + 1;
    saveConfig(cfg);
    addLog(`📧 AUTO-EMAIL SENT to ${lead.name} (${lead.email}) with demo ${lead.demo_url}`, 'success');
    return { ok: true };
  } catch (err) {
    addLog(`⚠️ Gmail Error for ${lead.name} (${lead.email}): ${err.message}`, 'error');
    return { ok: false, reason: err.message };
  }
}

// Send automated WhatsApp via Baileys
async function sendWhatsAppAuto(lead, cfg) {
  if (!waState.connected || !waSocket) {
    return { ok: false, reason: 'WhatsApp QR not connected yet' };
  }
  const digits = normalizePhoneForWA(lead.phone, lead.country || lead.city);
  if (!digits || digits.length < 9) {
    return { ok: false, reason: 'No valid phone number' };
  }

  try {
    const jid = `${digits}@s.whatsapp.net`;
    const [result] = await waSocket.onWhatsApp(jid);
    if (!result || !result.exists) {
      addLog(`ℹ️ Phone +${digits} (${lead.name}) is a landline / not on WhatsApp. Skipping WA.`, 'info');
      return { ok: false, reason: 'Number not registered on WhatsApp' };
    }

    const { text } = buildPitch(lead, cfg);
    await waSocket.sendMessage(result.jid, { text });

    cfg.sent_wa_count = (cfg.sent_wa_count || 0) + 1;
    saveConfig(cfg);
    addLog(`💬 AUTO-WHATSAPP SENT to ${lead.name} (+${digits}) with demo ${lead.demo_url}!`, 'success');
    return { ok: true };
  } catch (err) {
    addLog(`⚠️ WhatsApp Send Error for ${lead.name}: ${err.message}`, 'error');
    return { ok: false, reason: err.message };
  }
}

// Helper for HTTP GET/POST JSON
function fetchUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'LeadPulseAutopilot/2.0',
          ...(options.headers || {})
        },
        timeout: options.timeout || 10000,
        rejectUnauthorized: false
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Check website & scrape email if present on homepage
async function auditWebsiteAndExtractEmail(siteUrl) {
  if (!siteUrl || siteUrl === 'None') {
    return { status: 'NO_WEBSITE (High-Priority Target)', pts: 50, extractedEmail: '' };
  }
  const fullUrl = siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl;
  try {
    const res = await fetchUrl(fullUrl, { timeout: 6000 });
    if (res.statusCode >= 400) {
      return { status: `BROKEN_SITE (HTTP ${res.statusCode})`, pts: 48, extractedEmail: '' };
    }
    const emailMatch = (res.body || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|co\.uk|ca|org|net|ie|de)/i);
    const foundEmail = emailMatch ? emailMatch[0] : '';
    return { status: 'LIVE_SITE (Needs WhatsApp Funnel)', pts: 26, extractedEmail: foundEmail };
  } catch (e) {
    return { status: 'DEAD_DOMAIN (Offline / Connection Refused)', pts: 52, extractedEmail: '' };
  }
}

// Hunt real leads in a City/Country/Niche via OpenStreetMap Overpass
async function huntCityNiche(city, country, niche) {
  const tagMap = {
    gym: '[leisure=fitness_centre]',
    bakery: '[shop=bakery]',
    dental: '[amenity=dentist]',
    tech: '[shop=computer]',
    hvac: '[craft=hvac]',
    travel: '[shop=travel_agency]',
    auto: '[shop=car_parts]',
    electronics: '[shop=electronics]',
    salon: '[shop=beauty]'
  };
  const osmFilter = tagMap[niche] || '[shop=computer]';
  addLog(`🔍 Hunting ${niche.toUpperCase()} leads in ${city}, ${country}...`, 'info');

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ', ' + country)}&format=json&limit=1`;
    const geoRes = await fetchUrl(nomUrl, { timeout: 8000 });
    const geo = JSON.parse(geoRes.body || '[]');
    if (!geo.length) return [];

    const lat = geo[0].lat;
    const lon = geo[0].lon;
    const query = `[out:json][timeout:12];(node${osmFilter}(around:18000,${lat},${lon});way${osmFilter}(around:18000,${lat},${lon}););out body 14;`;
    const ovRes = await fetchUrl('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      timeout: 14000
    });
    const ovData = JSON.parse(ovRes.body || '{}');
    const elements = ovData.elements || [];

    const leads = loadLeads();
    const existingNames = new Set(leads.map((l) => l.name.toLowerCase()));
    let addedCount = 0;

    for (const el of elements) {
      const t = el.tags || {};
      if (!t.name || existingNames.has(t.name.toLowerCase())) continue;

      const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || '';
      let email = t.email || t['contact:email'] || '';
      const website = t.website || t['contact:website'] || 'None';

      // Only keep leads that have at least a phone OR email OR website we can crawl
      if (!phone && !email && website === 'None') continue;

      const audit = await auditWebsiteAndExtractEmail(website);
      if (!email && audit.extractedEmail) email = audit.extractedEmail;

      const demo = DEMO_MAP[niche] || DEMO_MAP.tech;
      let score = audit.pts + (phone ? 25 : 0) + (email ? 16 : 0) + 8;
      score = Math.min(99, Math.max(50, score));

      const newLead = {
        id: 'auto-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        name: t.name,
        niche,
        city: `${city}, ${country}`,
        country,
        phone,
        email,
        website,
        website_status: audit.status,
        score,
        tier: score >= 85 ? 'HOT' : 'WARM',
        reasons: [
          `${audit.status} (+${audit.pts})`,
          phone ? 'Phone Verified (+25)' : 'No phone (+0)',
          email ? `Email Verified (${email}) (+16)` : 'No email (+0)',
          `Matched Demo: ${demo.name}`
        ],
        demo_url: demo.url,
        status: 'New Lead'
      };

      leads.unshift(newLead);
      existingNames.add(t.name.toLowerCase());
      addedCount++;
      if (addedCount >= 6) break;
    }

    leads.sort((a, b) => b.score - a.score);
    saveLeads(leads);
    addLog(`✅ Audited & rated ${addedCount} new ${niche.toUpperCase()} leads in ${city} (${country}).`, 'success');
    return leads;
  } catch (err) {
    addLog(`Search warning for ${city}: ${err.message}`, 'error');
    return loadLeads();
  }
}

// ================= 100% AUTONOMOUS BACKGROUND WORKER =================
let isWorkerBusy = false;

async function autopilotTick() {
  const cfg = loadConfig();
  if (!cfg.autopilot_enabled || isWorkerBusy) return;
  isWorkerBusy = true;

  try {
    let leads = loadLeads();
    const minScore = Number(cfg.min_score_to_send || 80);

    // Find next uncontacted qualified lead
    let candidate = leads.find(
      (l) =>
        l.score >= minScore &&
        l.status === 'New Lead' &&
        ((cfg.gmail_user && cfg.gmail_app_password && l.email) || (waState.connected && l.phone))
    );

    // If no uncontacted candidate is ready, automatically hunt the next city in the world!
    if (!candidate) {
      const target = GLOBAL_TARGETS[targetCursor % GLOBAL_TARGETS.length];
      targetCursor++;
      await huntCityNiche(target.city, target.country, target.niche);
      leads = loadLeads();
      candidate = leads.find(
        (l) =>
          l.score >= minScore &&
          l.status === 'New Lead' &&
          ((cfg.gmail_user && cfg.gmail_app_password && l.email) || (waState.connected && l.phone))
      );
    }

    if (candidate) {
      addLog(`🤖 Autopilot processing [${candidate.score}/100] ${candidate.name} (${candidate.city})...`, 'info');
      let actionsDone = [];

      if (cfg.gmail_user && cfg.gmail_app_password && candidate.email) {
        const emRes = await sendEmailAuto(candidate, cfg);
        if (emRes.ok) actionsDone.push('Email Sent');
      }

      if (waState.connected && candidate.phone) {
        const waRes = await sendWhatsAppAuto(candidate, cfg);
        if (waRes.ok) actionsDone.push('WhatsApp Sent');
      }

      candidate.status = actionsDone.length ? actionsDone.join(' + ') + ' ✅' : 'Checked (Skipped/No WA)';
      saveLeads(leads);
    } else {
      addLog(
        '⏳ Autopilot is hunting leads... Connect your Gmail App Password or Scan WhatsApp QR so the bot can auto-dispatch messages!',
        'info'
      );
    }
  } catch (e) {
    addLog('Autopilot cycle error: ' + e.message, 'error');
  } finally {
    isWorkerBusy = false;
  }
}

setInterval(autopilotTick, 20000);

// ================= HTTP SERVER =================
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  const sendJson = (data, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'GET' && parsed.pathname === '/api/state') {
    const cfg = loadConfig();
    const leads = loadLeads();
    return sendJson({
      config: {
        sender_name: cfg.sender_name,
        gmail_user: cfg.gmail_user,
        gmail_connected: Boolean(cfg.gmail_user && cfg.gmail_app_password),
        whatsapp_number: cfg.whatsapp_number,
        autopilot_enabled: cfg.autopilot_enabled,
        min_score_to_send: cfg.min_score_to_send,
        sent_email_count: cfg.sent_email_count || 0,
        sent_wa_count: cfg.sent_wa_count || 0
      },
      whatsapp: waState,
      logs: activityLogs,
      leads
    });
  }

  if (req.method === 'POST') {
    let bodyStr = '';
    req.on('data', (chunk) => (bodyStr += chunk));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(bodyStr || '{}');
      } catch (e) {}

      if (parsed.pathname === '/api/config') {
        const cfg = loadConfig();
        if (body.sender_name !== undefined) cfg.sender_name = body.sender_name.trim();
        if (body.gmail_user !== undefined) cfg.gmail_user = body.gmail_user.trim();
        if (body.gmail_app_password && body.gmail_app_password.trim() !== '') {
          cfg.gmail_app_password = body.gmail_app_password.trim();
        }
        if (body.whatsapp_number !== undefined) cfg.whatsapp_number = body.whatsapp_number.trim();
        if (body.min_score_to_send !== undefined) cfg.min_score_to_send = Number(body.min_score_to_send);
        saveConfig(cfg);
        addLog(`✅ Saved account settings for ${cfg.gmail_user || cfg.sender_name}`, 'success');
        return sendJson({ ok: true });
      }

      if (parsed.pathname === '/api/toggle-autopilot') {
        const cfg = loadConfig();
        cfg.autopilot_enabled = Boolean(body.enabled);
        saveConfig(cfg);
        addLog(
          cfg.autopilot_enabled
            ? '🚀 FULL AUTOPILOT ENABLED! Bot is now hunting, rating & messaging clients automatically.'
            : '⏸️ Autopilot paused by user.',
          cfg.autopilot_enabled ? 'success' : 'info'
        );
        if (cfg.autopilot_enabled) setTimeout(autopilotTick, 500);
        return sendJson({ ok: true, autopilot_enabled: cfg.autopilot_enabled });
      }

      if (parsed.pathname === '/api/wa-connect') {
        await startWhatsApp(Boolean(body.reset));
        return sendJson({ ok: true, whatsapp: waState });
      }

      if (parsed.pathname === '/api/wa-pair-code') {
        try {
          const rawNum = (body.phone || '').replace(/\D/g, '');
          if (!rawNum || rawNum.length < 9) {
            return sendJson({ ok: false, error: 'Enter your full WhatsApp number with country code (e.g. 923149944444)' }, 400);
          }
          if (!waSocket) await startWhatsApp(true);
          const code = await waSocket.requestPairingCode(rawNum);
          waState.pairingCode = code;
          waState.statusText = `Enter Pairing Code on your phone: ${code}`;
          addLog(`🔑 Generated WhatsApp 8-Digit Pairing Code for +${rawNum}: ${code}`, 'wa');
          return sendJson({ ok: true, code });
        } catch (err) {
          return sendJson({ ok: false, error: err.message }, 500);
        }
      }

      if (parsed.pathname === '/api/search') {
        const leads = await huntCityNiche(body.city || 'London', body.country || 'United Kingdom', body.niche || 'gym');
        return sendJson({ ok: true, leads });
      }

      if (parsed.pathname === '/api/send-one') {
        const cfg = loadConfig();
        const leads = loadLeads();
        const lead = leads.find((l) => l.id === body.id);
        if (!lead) return sendJson({ ok: false, error: 'Lead not found' }, 404);

        let results = [];
        if (body.channel === 'email' || body.channel === 'both') {
          const r = await sendEmailAuto(lead, cfg);
          results.push(r.ok ? 'Email Sent ✅' : `Email failed (${r.reason})`);
        }
        if (body.channel === 'wa' || body.channel === 'both') {
          const r = await sendWhatsAppAuto(lead, cfg);
          results.push(r.ok ? 'WhatsApp Sent ✅' : `WhatsApp skipped (${r.reason})`);
        }
        lead.status = results.join(' · ');
        saveLeads(leads);
        return sendJson({ ok: true, result: lead.status });
      }

      return sendJson({ error: 'Not found' }, 404);
    });
    return;
  }

  // Static files
  let filePath = path.join(BASE_DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  addLog(`LeadPulse AI Autonomous Server online on port ${PORT}`, 'success');
  startWhatsApp(false);
});
