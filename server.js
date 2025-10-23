// ======================================================
// Warehouse 231 / Contents Manager
// Full Working Server.js (Sandbox Edition)
// ======================================================

require("dotenv").config();
const { Pool } = require("pg");
const express = require("express");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");

const app = express();
app.use(express.json());

// ======================================================
// DATABASE CONNECTION
// ======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// ======================================================
// ROUTES
// ======================================================

// --- HEALTH CHECK ---
app.get("/api/health", (req, res) => {
  res.json({ status: "Contents Manager server running." });
});

// --- GET ALL ITEMS (optional ?search=term) ---
app.get("/api/items", async (req, res) => {
  const { search } = req.query;

  try {
    let sql = `
      SELECT line_number, room_area, quantity, description,
             brand, model, unit_rcv, extended_rcv, acv_percent, acv,
             source_link, notes
      FROM claims.inventory_items
    `;
    const params = [];

    if (search) {
      sql += ` WHERE 
        description ILIKE $1 OR
        brand ILIKE $1 OR
        model ILIKE $1 OR
        room_area ILIKE $1 OR
        notes ILIKE $1`;
      params.push(`%${search}%`);
    }

    sql += " ORDER BY line_number ASC LIMIT 200;";

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/items error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET SINGLE ITEM BY LINE NUMBER ---
app.get("/api/items/:line_number", async (req, res) => {
  const { line_number } = req.params;
  try {
    const sql = `
      SELECT *
      FROM claims.inventory_items
      WHERE line_number = $1;
    `;
    const { rows } = await pool.query(sql, [line_number]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Item not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/items/:line_number error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST NEW ITEM ---
app.post("/api/items", async (req, res) => {
  const {
    line_number,
    room_area,
    quantity,
    description,
    brand,
    model,
    unit_rcv,
    extended_rcv,
    acv_percent,
    acv,
    source_link,
    notes,
  } = req.body;

  const sql = `
    INSERT INTO claims.inventory_items
    (line_number, room_area, quantity, description,
     brand, model, unit_rcv, extended_rcv, acv_percent, acv,
     source_link, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
  `;

  try {
    await pool.query(sql, [
      line_number,
      room_area,
      quantity,
      description,
      brand,
      model,
      unit_rcv,
      extended_rcv,
      acv_percent,
      acv,
      source_link,
      notes,
    ]);
    res.json({ status: "success" });
  } catch (err) {
    console.error("POST /api/items error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// --- BULK IMPORT FROM CSV ---
app.post("/api/import", async (req, res) => {
  const filePath = path.join(__dirname, "public", "sandbox", "von_items.csv");

  if (!fs.existsSync(filePath)) {
    console.error(`❌ CSV file not found at ${filePath}`);
    return res
      .status(404)
      .json({ error: `CSV file not found at ${filePath}` });
  }

  console.log("📂 Importing from:", filePath);

  // clear table
  try {
    await pool.query("TRUNCATE TABLE claims.inventory_items RESTART IDENTITY;");
    console.log("🧹 Cleared table before import...");
  } catch (err) {
    console.error("DB clear error:", err.message);
    return res.status(500).json({ error: "Failed to clear table" });
  }

  // read CSV and insert
  let count = 0;
  const rows = [];

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
      // clean numeric fields
      const cleanNum = (v) =>
        v && !isNaN(v) ? Number(v.toString().replace(/[^0-9.-]/g, "")) : null;

      rows.push([
        cleanNum(row.line_number),
        row.room_area || null,
        cleanNum(row.quantity || row.quanity), // fix misspellings
        row.description || null,
        row.brand || null,
        row.model || null,
        cleanNum(row.unit_rcv),
        cleanNum(row.extended_rcv),
        cleanNum(row.acv_percent),
        cleanNum(row.acv),
        row.source_link || null,
        row.notes || null,
      ]);
    })
    .on("end", async () => {
      try {
        for (const r of rows) {
          await pool.query(
            `
            INSERT INTO claims.inventory_items
            (line_number, room_area, quantity, description,
             brand, model, unit_rcv, extended_rcv, acv_percent, acv,
             source_link, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
            r
          );
          count++;
        }
        console.log(`✅ Imported ${count} rows successfully`);
        res.json({ status: "success", imported: count });
      } catch (err) {
        console.error("DB insert error:", err.message);
        res.status(500).json({ error: err.message });
      }
    })
    .on("error", (err) => {
      console.error("CSV parse error:", err.message);
      res.status(500).json({ error: err.message });
    });
});

// ======================================================
// STATIC FILES (keep this at the bottom!)
// ======================================================
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3231;
app.listen(PORT, () =>
  console.log(`✅ Contents Manager server running on port ${PORT}`)
);
