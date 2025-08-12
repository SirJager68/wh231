// server.js
const express = require('express');
const fetch = require('node-fetch'); // v2
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.static('public'));
app.use(session({ secret: 'lightspeedsecret', resave: false, saveUninitialized: true }));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Detect environment: Heroku provides process.env.HEROKU_APP_NAME automatically if set, 
// or you can use NODE_ENV
const IS_HEROKU = process.env.DYNO !== undefined;

// Pick redirect URI based on environment
const REDIRECT_URI = IS_HEROKU
  ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com/callback`
  : `http://localhost:${process.env.PORT || 3000}/callback`;

// Store in env so it's consistent
process.env.REDIRECT_URI = REDIRECT_URI;

app.get('/login', (req, res) => {
  const authURL = `https://cloud.lightspeedapp.com/oauth/authorize.php` +
    `?response_type=code` +
    `&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(authURL);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');

  const tokenRes = await fetch('https://cloud.lightspeedapp.com/oauth/access_token.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI
    })
  });

  const tokenData = await tokenRes.json();
  req.session.token = tokenData.access_token;
  req.session.accountID = tokenData.account_id;

  res.redirect('/');
});

app.get('/api/weekly-sales', async (req, res) => {
  if (!req.session.token) return res.status(401).send({ error: 'Not authenticated' });

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const startStr = startDate.toISOString();

  const url = `https://api.lightspeedapp.com/API/Account/${req.session.accountID}/Sale.json?timeStamp=><${startStr}`;

  const salesRes = await fetch(url, {
    headers: { Authorization: `Bearer ${req.session.token}` }
  });

  const salesData = await salesRes.json();

  let gross = 0, cogs = 0;
  for (const sale of salesData.Sale || []) {
    gross += parseFloat(sale.total || 0);
    // Later: fetch SaleLine for COGS
  }

  res.json({ gross, cogs, profit: gross - cogs });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running at ${REDIRECT_URI.replace('/callback', '')}`);
});
