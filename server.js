// server.js
const express = require('express');
const fetch = require('node-fetch');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.static('public'));
app.use(session({ secret: 'lightspeedsecret', resave: false, saveUninitialized: true }));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.get('/login', (req, res) => {
    const authURL = `https://cloud.lightspeedapp.com/oauth/authorize.php?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(authURL);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;

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
        // In a full version, we’d fetch SaleLine with Item.averageCost to calc COGS
    }

    const profit = gross - cogs;
    res.json({ gross, cogs, profit });
});

app.listen(process.env.PORT || 3006, () => console.log('Server running...'));
