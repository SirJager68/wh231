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
// Weekly Sales with COGS + Profit
// =========================
app.get('/api/weekly-sales', async (req, res) => {
  if (!req.session.token || !req.session.accountID) {
    return res.status(401).send({ error: 'Not authenticated with Lightspeed' });
  }

  try {
    // Date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();

    // 1️⃣ Get sales from the last 7 days
    const salesUrl = `https://api.lightspeedapp.com/API/Account/${req.session.accountID}/Sale.json?timeStamp=>${startStr}&timeStamp=<${endStr}`;
    const salesRes = await fetch(salesUrl, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    const salesData = await salesRes.json();

    if (!salesData.Sale) {
      return res.json({ gross: 0, cogs: 0, profit: 0 });
    }

    let gross = 0;
    let cogs = 0;

    // 2️⃣ Loop sales and fetch COGS
    const salesArray = Array.isArray(salesData.Sale) ? salesData.Sale : [salesData.Sale];

    await Promise.all(salesArray.map(async (sale) => {
      gross += parseFloat(sale.total || 0);

      // Fetch SaleLines for this sale
      const saleLineUrl = `https://api.lightspeedapp.com/API/Account/${req.session.accountID}/Sale/${sale.saleID}/SaleLine.json`;
      const lineRes = await fetch(saleLineUrl, {
        headers: { Authorization: `Bearer ${req.session.token}` }
      });
      const lineData = await lineRes.json();

      const lines = Array.isArray(lineData.SaleLine) ? lineData.SaleLine : [lineData.SaleLine];
      lines.forEach(line => {
        if (line && line.unitCost && line.quantity) {
          cogs += parseFloat(line.unitCost) * parseFloat(line.quantity);
        }
      });
    }));

    // 3️⃣ Calculate profit
    const profit = gross - cogs;

    res.json({
      gross: gross.toFixed(2),
      cogs: cogs.toFixed(2),
      profit: profit.toFixed(2)
    });

  } catch (err) {
    console.error('Weekly Sales Error:', err);
    res.status(500).send({ error: 'Failed to fetch weekly sales' });
  }
});


// =========================
// Start Server
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running at ${REDIRECT_URI.replace('/callback', '')}`);
});
