const express = require('express');
const fetch = require('node-fetch');
const dayjs = require('dayjs');

const app = express();

// Helper to format YYYY-MM-DDTHH:mm:ss±HHMM
function formatLightspeedDate(date) {
  return dayjs(date).format('YYYY-MM-DDTHH:mm:ssZZ');
}

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

    const accountId = process.env.LS_ACCOUNT_ID; // Store in .env
    const accessToken = process.env.LS_ACCESS_TOKEN; // Store in .env

    const startStr = formatLightspeedDate(startDate);
    const endStr = formatLightspeedDate(endDate);

    const url = `https://api.lightspeedapp.com/API/V3/Account/${accountId}/Sale.json?timeStamp=%3E%3C,${startStr},${endStr}&completed=true&archived=false&limit=100`;

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

    data.Sale.forEach(sale => {
      const date = dayjs(sale.completeTime).format('YYYY-MM-DD');
      const total = parseFloat(sale.total || 0);
      if (!dailyTotals[date]) dailyTotals[date] = 0;
      dailyTotals[date] += total;
    });

    // Fill missing days with zero sales
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

// Export or listen depending on your structure
module.exports = app;
