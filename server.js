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
  const scopes = 'employee:reports';
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
app.get('/api/weekly-sales', async (req, res) => {
  if (!req.session.token || !req.session.accountID) {
    return res.status(401).send({ error: 'Not authenticated with Lightspeed' });
  }

  const headers = { Authorization: `Bearer ${req.session.token}` };
  const accountID = req.session.accountID;

  try {
    // Build a 7‑day window (UTC is fine; Retail API accepts ISO8601)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 7);

    const startISO = start.toISOString(); // e.g. 2025-08-05T21:53:00.000Z
    const endISO   = end.toISOString();

    let gross = 0;
    let cogs  = 0;

    // --- 1) Pull sales with safe filters + pagination ---
    // Use createTime range and completed=true (avoids quotes/layaways)
    // API supports multiple instances of the same filter key.
    const baseSalesUrl = `https://api.lightspeedapp.com/API/Account/${accountID}/Sale.json`;
    const perPage = 100;
    let offset = 0;
    let more = true;

    const fetchSalesPage = async (off) => {
      const url = `${baseSalesUrl}?completed=true&createTime=>=${encodeURIComponent(startISO)}&createTime=<=${encodeURIComponent(endISO)}&limit=${perPage}&offset=${off}`;
      const r = await fetch(url, { headers });
      return r.json();
    };

    let allSales = [];
    while (more) {
      const page = await fetchSalesPage(offset);

      // The API returns either { Sale: [...] } or { Sale: { ... } } or no Sale.
      let pageSales = [];
      if (page && page.Sale) {
        pageSales = Array.isArray(page.Sale) ? page.Sale : [page.Sale];
      }

      allSales = allSales.concat(pageSales);
      // Stop if fewer than page size were returned
      if (!pageSales.length || pageSales.length < perPage) more = false;
      offset += perPage;

      // Safety stop to avoid runaway
      if (offset > 5000) break;
    }

    if (allSales.length === 0) {
      return res.json({ gross: 0, cogs: 0, profit: 0 });
    }

    // --- 2) Sum Gross and fetch SaleLines for COGS ---
    const saleIDs = allSales.map(s => s.saleID).filter(Boolean);

    // helper to coalesce possible cost fields on a line
    const getLineCost = (line) => {
      // Lightspeed often exposes any of these depending on config
      const candidates = ['unitCost', 'avgCost', 'fifoCost', 'cost'];
      for (const k of candidates) {
        if (line && line[k] != null && line[k] !== '') return parseFloat(line[k]) || 0;
      }
      return 0;
    };

    // sum gross from sale totals
    for (const s of allSales) {
      gross += parseFloat(s.total || 0);
    }

    // fetch lines for each sale (parallel with throttle)
    const pMap = async (items, limit, fn) => {
      const ret = [];
      let i = 0;
      const next = async () => {
        if (i >= items.length) return;
        const idx = i++;
        ret[idx] = await fn(items[idx], idx);
        return next();
      };
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
      return ret;
    };

    await pMap(saleIDs, 6, async (saleID) => {
      const lineUrl = `https://api.lightspeedapp.com/API/Account/${accountID}/Sale/${saleID}/SaleLine.json`;
      const lr = await fetch(lineUrl, { headers });
      const lj = await lr.json();

      const lines = lj && lj.SaleLine
        ? (Array.isArray(lj.SaleLine) ? lj.SaleLine : [lj.SaleLine])
        : [];

      for (const line of lines) {
        const qty = parseFloat(line.quantity || 0) || 0;
        const cost = getLineCost(line);
        cogs += cost * qty;
      }
    });

    const profit = gross - cogs;
    res.json({
      gross: Number(gross.toFixed(2)),
      cogs: Number(cogs.toFixed(2)),
      profit: Number(profit.toFixed(2))
    });
  } catch (err) {
    console.error('Weekly Sales Error:', err);
    res.status(500).send({ error: 'Failed to fetch weekly sales' });
  }
});

app.get('/api/debug-one-sale', async (req, res) => {
  if (!req.session.token || !req.session.accountID) return res.status(401).send({error:'Not authed'});
  const headers = { Authorization: `Bearer ${req.session.token}` };
  const url = `https://api.lightspeedapp.com/API/Account/${req.session.accountID}/Sale.json?limit=1&offset=0&completed=true&order=timeStamp&orderby=desc`;
  const r = await fetch(url, { headers });
  const j = await r.json();
  res.json(j);
});

// =========================
// Start Server
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running at ${REDIRECT_URI.replace('/callback', '')}`);
});
