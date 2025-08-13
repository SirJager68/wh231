// server.js
const express = require('express');
const fetch = require('node-fetch'); // v2: npm install node-fetch@2
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.static('public'));
app.use(session({
  secret: 'lightspeedsecret',
  resave: false,
  saveUninitialized: true
}));

// Environment variables from Heroku
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // e.g. https://warehouse231-08109bdfee31.herokuapp.com/callback

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('❌ Missing CLIENT_ID, CLIENT_SECRET, or REDIRECT_URI in environment.');
  process.exit(1);
}

// =========================
// Login with Lightspeed
// =========================
app.get('/login', (req, res) => {
  const scopes = 'employee:all';
  const authURL =
    `https://cloud.lightspeedapp.com/oauth/authorize.php` +
    `?response_type=code` +
    `&client_id=${CLIENT_ID}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  console.log("OAuth Login URL:", authURL);
  res.redirect(authURL);
});



// =========================
// OAuth Callback
// =========================
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code from Lightspeed');

  try {
    const tokenRes = await fetch('https://cloud.lightspeedapp.com/oauth/access_token.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('Token Error:', tokenData);
      return res.status(400).json(tokenData);
    }

    // Store token
    req.session.token = tokenData.access_token;

    // Always fetch account ID if not provided
    let accountID = tokenData.account_id;
    if (!accountID) {
      try {
        const acctRes = await fetch('https://api.lightspeedapp.com/API/Account.json', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const acctData = await acctRes.json();

        if (acctData.Account && acctData.Account.accountID) {
          accountID = acctData.Account.accountID;
        } else if (Array.isArray(acctData.Account) && acctData.Account.length > 0) {
          accountID = acctData.Account[0].accountID;
        }
      } catch (err) {
        console.error('Failed to fetch account ID:', err);
      }
    }

    req.session.accountID = accountID;
    console.log('✅ Authenticated with Lightspeed for account:', accountID);

    res.redirect('/');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('OAuth callback failed');
  }
});







// =========================
// Weekly Sales with pagination + real COGS
// =========================
app.get('/api/yesterday-raw', async (req, res) => {
  try {
    if (!req.session.token || !req.session.accountID) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const offset = "-0500"; // store timezone offset
    function pad(n) { return n < 10 ? '0' + n : n; }

    const now = new Date();
    now.setDate(now.getDate() - 1);
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());

    const start = `${year}-${month}-${day}T00:00:00${offset}`;
    const end   = `${year}-${month}-${day}T23:59:59${offset}`;

    const url = `https://api.lightspeedapp.com/API/V3/Account/${req.session.accountID}/Sale.json` +
      `?completeTime=%3E%3C,${encodeURIComponent(start)},${encodeURIComponent(end)}` +
      `&completed=true&archived=false&voided=false&limit=100`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${req.session.token}`,
        Accept: 'application/json'
      }
    });

    const j = await r.json();
    console.log("Full Lightspeed JSON:", JSON.stringify(j, null, 2)); // server logs
    res.json(j); // send raw to browser

  } catch (err) {
    console.error('Error fetching raw sales:', err);
    res.status(500).json({ error: 'Failed to fetch raw sales' });
  }
});

// =========================
// Yesterday total (sum of calcTotal) — V3, Chicago local day
// =========================
app.get('/api/yesterday-total', async (req, res) => {
  try {
    if (!req.session.token || !req.session.accountID) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // ---- figure out Chicago offset (CDT = -0500, CST = -0600)
    const nowUTC = new Date();
    const m = nowUTC.getUTCMonth(); // 0..11
    const isDST = (m >= 2 && m <= 10); // rough DST window (Mar–Nov)
    const offset = isDST ? '-0500' : '-0600';

    // build yesterday's local (Chicago) YYYY-MM-DD
    const chicagoNow = new Date(nowUTC.getTime()); // copy
    // shift to Chicago calendar day by applying offset sign (+hours to go from UTC to local)
    const offsH = parseInt(offset.slice(1,3), 10);
    const offsM = parseInt(offset.slice(3,5), 10);
    const offsMs = ((offset.startsWith('-') ? -1 : 1) * (offsH * 60 + offsM)) * 60 * 1000;
    const chicagoLocalNow = new Date(nowUTC.getTime() + offsMs);
    const y = chicagoLocalNow.getFullYear();
    const mo = chicagoLocalNow.getMonth(); // 0-based
    const d = chicagoLocalNow.getDate() - 1; // yesterday

    const pad = n => (n < 10 ? '0' + n : '' + n);
    const yDate = new Date(y, mo, d); // local date object for Chicago calendar
    const Y = yDate.getFullYear();
    const M = pad(yDate.getMonth() + 1);
    const D = pad(yDate.getDate());

    const startStr = `${Y}-${M}-${D}T00:00:00${offset}`;
    const endStr   = `${Y}-${M}-${D}T23:59:59${offset}`;

    // ---- pull sales with pagination (limit up to 100 per page)
    const base = `https://api.lightspeedapp.com/API/V3/Account/${req.session.accountID}/Sale.json`;
    const params = `completeTime=%3E%3C,${encodeURIComponent(startStr)},${encodeURIComponent(endStr)}&completed=true&archived=false&voided=false&sort=-completeTime&limit=100`;

    let url = `${base}?${params}`;
    let total = 0;
    let count = 0;

    // loop pages via @attributes.next (if provided)
    // V3 returns either Sale: [] and "@attributes".next to page forward
    for (let i = 0; i < 100; i++) { // hard stop after 100 pages
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${req.session.token}`, Accept: 'application/json' }
      });
      const j = await r.json();

      const list = Array.isArray(j.Sale) ? j.Sale : (j.Sale ? [j.Sale] : []);
      for (const s of list) {
        total += parseFloat(s.calcTotal || s.total || 0);
      }
      count += list.length;

      const next = j['@attributes'] && j['@attributes'].next;
      if (!next) break;
      url = next; // next is a fully-formed URL
    }

    res.json({
      date: `${Y}-${M}-${D}`,
      totalSales: Number(total.toFixed(2)),
      saleCount: count,
      window: { start: startStr, end: endStr }
    });
  } catch (err) {
    console.error('Yesterday total error:', err);
    res.status(500).json({ error: 'Failed to fetch yesterday total' });
  }
});



// =========================
// Start Server
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running at ${REDIRECT_URI.replace('/callback', '')}`);
});
