// ======================================================
// Warehouse 231 / Contents Manager
// Auto-detects schema for Local (claims) or Heroku (public)
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

// Determine correct schema on startup
let schema = "claims";
(async () => {
    try {
        const res = await pool.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'claims';
    `);
        if (res.rowCount === 0) {
            schema = "public";
        }
        console.log(`📦 Using schema: ${schema}`);

        // ✅ Tell Postgres to use it
        await pool.query(`SET search_path TO ${schema}, public;`);
        console.log(`🧭 search_path set to: ${schema}, public`);
    } catch (err) {
        console.error("⚠️ Error detecting schema:", err.message);
    }
})();


// Helper function to build schema-qualified names
const t = (table) => `${schema}.${table}`;

// ======================================================
// ROUTES
// ======================================================

// --- HEALTH CHECK ---
app.get("/api/health", (req, res) => {
    res.json({ status: "Contents Manager server running." });
});

// --- GET ALL ITEMS (optional ?search=term) ---
// --- GET ALL ITEMS (with search, paging, limit)
app.get("/api/items", async (req, res) => {
    const { search, limit = 25, offset = 0 } = req.query;

    try {
        let baseSQL = `
      FROM ${t("inventory_items")}
      WHERE 1=1
    `;
        const params = [];
        if (search) {
            params.push(`%${search}%`);
            baseSQL += `
        AND (
          description ILIKE $${params.length} OR
          brand ILIKE $${params.length} OR
          model ILIKE $${params.length} OR
          room_area ILIKE $${params.length} OR
          notes ILIKE $${params.length}
        )
      `;
        }

        const countSQL = `SELECT COUNT(*) AS total ${baseSQL}`;
        const { rows: countRows } = await pool.query(countSQL, params);
        const total = parseInt(countRows[0].total);

        params.push(limit);
        params.push(offset);
        const dataSQL = `
      SELECT line_number, room_area, quantity, description,
             brand, model, unit_rcv, extended_rcv, acv_percent, acv,
             source_link, notes
      ${baseSQL}
      ORDER BY line_number ASC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;
        const { rows } = await pool.query(dataSQL, params);

        const pages = Math.ceil(total / limit);
        const page = Math.floor(offset / limit) + 1;
        res.json({ items: rows, total, page, pages });
    } catch (err) {
        console.error("GET /api/items error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --- GET SINGLE ITEM ---
app.get("/api/items/:line_number", async (req, res) => {
    const { line_number } = req.params;
    try {
        const sql = `SELECT * FROM ${t("inventory_items")} WHERE line_number = $1;`;
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
    INSERT INTO ${t("inventory_items")}
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
    if (!fs.existsSync(filePath))
        return res.status(404).json({ error: `CSV file not found at ${filePath}` });

    console.log("📂 Importing from:", filePath);

    try {
        await pool.query(`TRUNCATE TABLE ${t("inventory_items")} RESTART IDENTITY;`);
        console.log("🧹 Cleared table before import...");
    } catch (err) {
        console.error("DB clear error:", err.message);
        return res.status(500).json({ error: "Failed to clear table" });
    }

    let count = 0;
    const rows = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (row) => {
            const cleanNum = (v) =>
                v && !isNaN(v) ? Number(v.toString().replace(/[^0-9.-]/g, "")) : null;

            rows.push([
                cleanNum(row.line_number),
                row.room_area || null,
                cleanNum(row.quantity || row.quanity),
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
            INSERT INTO ${t("inventory_items")}
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
// STATIC FILES
// ======================================================
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "index.html"))
);

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3231;
app.listen(PORT, () =>
    console.log(`✅ Contents Manager server running on port ${PORT}`)
);
