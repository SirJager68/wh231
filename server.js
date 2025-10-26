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
      FROM ${t("inventory_items")} i
      LEFT JOIN (
        SELECT item_id, MAX(edited_at) AS last_edit_date
        FROM ${t("inventory_edits")}
        GROUP BY item_id
      ) e ON i.id = e.item_id
      WHERE 1=1
    `;

    const params = [];
    if (search) {
      params.push(`%${search}%`);
      baseSQL += `
        AND (
          i.description ILIKE $${params.length} OR
          i.brand ILIKE $${params.length} OR
          i.model ILIKE $${params.length} OR
          i.room_area ILIKE $${params.length} OR
          i.notes ILIKE $${params.length}
        )
      `;
    }

    const countSQL = `SELECT COUNT(*) AS total ${baseSQL}`;
    const { rows: countRows } = await pool.query(countSQL, params);
    const total = parseInt(countRows[0].total);

    params.push(limit);
    params.push(offset);
    const dataSQL = `
      SELECT 
        i.line_number, i.room_area, i.quantity, i.description,
        i.brand, i.model, i.unit_rcv, i.extended_rcv, i.acv_percent, i.acv,
        i.source_link, i.notes, e.last_edit_date
      ${baseSQL}
      ORDER BY i.line_number ASC
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

// ---- EDIT ITEM DB
// --- POST: record an edit to an item ---
// --- POST edit record (lookup item_id by line_number) ---
app.post("/api/items/:line/edit", async (req, res) => {
  const { line } = req.params;
  const { field_name, old_value, new_value, edited_by } = req.body;

  try {
    // Find matching item_id from line_number
    const result = await pool.query(
      `SELECT id FROM ${t("inventory_items")} WHERE line_number = $1;`,
      [line]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item_id = result.rows[0].id;

    await pool.query(
      `
      INSERT INTO ${t("inventory_edits")}
      (item_id, field_name, old_value, new_value, edited_by)
      VALUES ($1,$2,$3,$4,$5);
      `,
      [item_id, field_name, old_value, new_value, edited_by || "admin"]
    );

    // Optionally: update live field on item
    await pool.query(
      `UPDATE ${t("inventory_items")} SET ${field_name} = $1 WHERE id = $2;`,
      [new_value, item_id]
    );

    res.json({ status: "success" });
  } catch (err) {
    console.error("POST /api/items/:line/edit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET all edit history for a line_number ---
app.get("/api/items/:line/edits", async (req, res) => {
  const { line } = req.params;
  try {
    const result = await pool.query(
      `SELECT id FROM ${t("inventory_items")} WHERE line_number = $1;`,
      [line]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Item not found" });

    const item_id = result.rows[0].id;

    const { rows } = await pool.query(
      `
      SELECT edit_id, field_name, old_value, new_value, edited_by, edited_at
      FROM ${t("inventory_edits")}
      WHERE item_id = $1
      ORDER BY edited_at DESC;
      `,
      [item_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /api/items/:line/edits error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET combined item + latest edit data ---
app.get("/api/items/:line_number/compare", async (req, res) => {
  const { line_number } = req.params;
  try {
    // 1️⃣ Get the main item
    const itemRes = await pool.query(
      `SELECT id, line_number, room_area, quantity, description, brand, model,
              unit_rcv, extended_rcv, acv_percent, acv, source_link, notes
       FROM ${t("inventory_items")}
       WHERE line_number = $1`,
      [line_number]
    );

    if (itemRes.rows.length === 0)
      return res.status(404).json({ error: "Item not found" });

    const item = itemRes.rows[0];

    // 2️⃣ Get the latest edit per field
    const editsRes = await pool.query(
      `
      SELECT DISTINCT ON (field_name) field_name, new_value, edited_by, edited_at
      FROM ${t("inventory_edits")}
      WHERE item_id = $1
      ORDER BY field_name, edited_at DESC
      `,
      [item.id]
    );

    const edits = {};
    editsRes.rows.forEach(e => {
      edits[e.field_name] = e;
    });

    res.json({ item, edits });
  } catch (err) {
    console.error("GET /compare error:", err.message);
    res.status(500).json({ error: err.message });
  }
});



app.get("/api/items/:id/edits", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `
      SELECT edit_id, field_name, old_value, new_value, edited_by, edited_at
      FROM claims.inventory_edits
      WHERE item_id = $1
      ORDER BY edited_at DESC
      `,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /api/items/:id/edits error:", err.message);
    res.status(500).json({ error: err.message });
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
