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
// =========================
// Weekly Sales Example - Updated for V3
// =========================
app.get('/api/weekly-sales', async (req, res) => {
  if (!req.session.token) {
    return res.status(401).send({ error: 'Not authenticated with Lightspeed' });
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    // Lightspeed expects UTC offset format (-0000)
    const startStr = startDate.toISOString().slice(0, 19) + '-0000';
    const endStr = endDate.toISOString().slice(0, 19) + '-0000';

    const url = `https://api.lightspeedapp.com/API/V3/Account/${req.session.accountID}/Sale.json?timeStamp=><,${startStr},${endStr}&completed=true&limit=100`;

    console.log("Fetching weekly sales from:", url);

    const salesRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${req.session.token}`,
        Accept: 'application/json'
      }
    });

    const salesData = await salesRes.json();

    let gross = 0;
    let cogs = 0; // Could be fetched from SaleLine if needed

    if (salesData.Sale) {
      for (const sale of salesData.Sale) {
        gross += parseFloat(sale.total || 0);
        // If you have COGS in your account, fetch related SaleLine here
      }
    }

    const profit = gross - cogs;
    res.json({ gross, cogs, profit });
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
