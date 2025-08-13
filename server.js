// server.js
const express = require('express');
const fetch = require('node-fetch'); // v2: npm install node-fetch@2
const session = require('express-session');
const dotenv = require('dotenv');
const dayjs = require('dayjs'); // npm install dayjs

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
const REDIRECT_URI = process.env.REDIRECT_URI; // e.g. https://yourapp.herokuapp.com/callback
let LS_REFRESH_TOKEN = process.env.LS_REFRESH_TOKEN; // saved after first login

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('❌ Missing CLIENT_ID, CLIENT_SECRET, or REDIRECT_URI in environment.');
  process.exit(1);
}

/**
 * Helper to refresh the Lightspeed access token using the stored refresh token.
 */
async function refreshAccessToken() {
  if (!LS_REFRESH_TOKEN) {
    throw new Error("No refresh token available — please log in first at /login");
  }

  const tokenRes = await fetch('https://cloud.lightspeedapp.com/oauth/access_token.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: LS_REFRESH_TOKEN
    })
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    console.error('Refresh error:', tokenData);
    throw new Error(tokenData.error_description || 'Failed to refresh token');
  }

  console.log("🔄 Refreshed access token at", new Date().toISOString());
  ACCESS_TOKEN = tokenData.access_token;

  // If Lightspeed returns a new refresh_token, store it
  if (tokenData.refresh_token && tokenData.refresh_token !== LS_REFRESH_TOKEN) {
    LS_REFRESH_TOKEN = tokenData.refresh_token;
    console.log("💾 Updated refresh token — update it in Heroku with:");
    console.log(`heroku config:set LS_REFRESH_TOKEN=${LS_REFRESH_TOKEN}`);
  }

  return ACCESS_TOKEN;
}

let ACCESS_TOKEN = process.env.LS_ACCESS_TOKEN || null;
let ACCOUNT_ID = process.env.LS_ACCOUNT_ID || null;

/**
 * Get a valid access token, refreshing if needed.
 */
async function getAccessToken() {
  if (!ACCESS_TOKEN) {
    return await refreshAccessToken();
  }
  return ACCESS_TOKEN;
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

    ACCESS_TOKEN = tokenData.access_token;
    LS_REFRESH_TOKEN = tokenData.refresh_token;

    console.log("✅ Got new access token and refresh token");
    console.log("💾 Save refresh token to Heroku so you don't need to log in again:");
    console.log(`heroku config:set LS_REFRESH_TOKEN=${LS_REFRESH_TOKEN}`);

    // Get account ID if not provided
    let accountID = tokenData.account_id;
    if (!accountID) {
      const acctRes = await fetch('https://api.lightspeedapp.com/API/Account.json', {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      const acctData = await acctRes.json();

      if (acctData.Account && acctData.Account.accountID) {
        accountID = acctData.Account.accountID;
      } else if (Array.isArray(acctData.Account) && acctData.Account.length > 0) {
        accountID = acctData.Account[0].accountID;
      }
    }

    ACCOUNT_ID = accountID;
    console.log('✅ Authenticated with Lightspeed for account:', ACCOUNT_ID);

    res.redirect('/');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('OAuth callback failed');
  }
});

// Helper to format Lightspeed date
function formatLightspeedDate(date) {
  return dayjs(date).format('YYYY-MM-DDTHH:mm:ssZZ');
}

// =========================
// Sales Range API (7, 14 days, month)
// =========================
app.get('/api/sales', async (req, res) => {
  try {
    const range = req.query.range || '7';

    let startDate, endDate;
    endDate = dayjs().endOf('day');

    if (range === '7') {
      startDate = dayjs().subtract(6, 'day').startOf('day');
    } else if (range === '14') {
      startDate = dayjs().subtract(13, 'day').startOf('day');
    } else if (range === 'month') {
      startDate = dayjs().startOf('month');
    } else {
      return res.status(400).json({ error: 'Invalid range' });
    }

    if (!ACCOUNT_ID) throw new Error("Missing ACCOUNT_ID — log in first");

    const startStr = formatLightspeedDate(startDate);
    const endStr = formatLightspeedDate(endDate);

    const accessToken = await getAccessToken();

    const url = `https://api.lightspeedapp.com/API/V3/Account/${ACCOUNT_ID}/Sale.json?timeStamp=%3E%3C,${startStr},${endStr}&completed=true&archived=false&limit=100`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();

    if (!data.Sale) {
      return res.json([]);
    }

    // Normalize data into daily totals
    const dailyTotals = {};

    (Array.isArray(data.Sale) ? data.Sale : [data.Sale]).forEach(sale => {
      const date = dayjs(sale.completeTime).format('YYYY-MM-DD');
      const total = parseFloat(sale.total || 0);
      if (!dailyTotals[date]) dailyTotals[date] = 0;
      dailyTotals[date] += total;
    });

    // Fill missing days
    const days = [];
    for (let d = startDate; d.isBefore(endDate) || d.isSame(endDate, 'day'); d = d.add(1, 'day')) {
      const dayStr = d.format('YYYY-MM-DD');
      days.push({
        date: dayStr,
        totalSales: dailyTotals[dayStr] || 0
      });
    }

    res.json(days);
  } catch (err) {
    console.error('Error fetching sales:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =========================
// Start Server
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running at ${REDIRECT_URI.replace('/callback', '')}`);
});
