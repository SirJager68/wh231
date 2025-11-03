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
// --- GET ALL ITEMS (with search, paging, status, and room filter)
// --- GET ALL ITEMS (with search, paging, status, and room filter)
app.get("/api/items", async (req, res) => {
  const { search, limit = 25, offset = 0, status, room } = req.query;

  try {
    // --- Base FROM + JOIN block
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

    // --- Optional search filter
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

    // --- Optional status filter
    if (status) {
      params.push(status);
      baseSQL += ` AND i.status = $${params.length}`;
    }

    // --- ✅ Optional room filter
    if (room) {
      params.push(room);
      baseSQL += ` AND i.room_area = $${params.length}`;
    }

    // --- Get total count
    const countSQL = `SELECT COUNT(*) AS total ${baseSQL}`;
    const { rows: countRows } = await pool.query(countSQL, params);
    const total = parseInt(countRows[0].total);

    // --- Paging
    params.push(limit);
    params.push(offset);

    // --- ✅ Return id too
    const dataSQL = `
      SELECT 
        i.id,                              -- ✅ added
        i.line_number, 
        i.room_area, 
        i.quantity, 
        i.description,
        i.brand, 
        i.model, 
        i.unit_rcv, 
        i.extended_rcv,
        i.acv_percent, 
        i.acv, 
        i.source_link, 
        i.notes,
        i.status, 
        e.last_edit_date
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


// ======================================================
// Get total $ Extended RCV for a client
// ======================================================
// ======================================================
// Get original and edited totals
// ======================================================
app.get("/api/clients/:id/totalrcv", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        SUM(unit_rcv * quantity)        AS original_total,
        SUM(unit_rcv_edit * quantity)   AS edited_total
      FROM ${schema}.inventory_items
      WHERE client_id = $1;
      `,
      [id]
    );

    const row = result.rows[0] || {};
    res.json({
      client_id: id,
      original_total: Number(row.original_total || 0),
      edited_total: Number(row.edited_total || 0)
    });
  } catch (err) {
    console.error("GET /api/clients/:id/totalrcv error:", err);
    res.status(500).json({ error: err.message });
  }
});




// --- GET SINGLE ITEM ---
app.get("/api/items/:line_number/compare", async (req, res) => {
    const { line_number } = req.params;

    // 🔒 Defensive: reject invalid line numbers
    if (!line_number || line_number === "null" || line_number === "undefined") {
        return res.status(400).json({ error: "Invalid line number" });
    }

    try {
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


app.post("/api/items", async (req, res) => {
    try {
        let {
            line_number,
            room_area,
            quantity,
            description,
            brand,
            model,
            unit_rcv,
            acv_percent,
            acv,
            source_link,
            notes,
        } = req.body;

        // 🧮 Auto-assign next line_number if not provided
        if (!line_number) {
            const { rows } = await pool.query(`
        SELECT COALESCE(MAX(line_number), 0) + 1 AS next_line
        FROM ${t("inventory_items")};
      `);
            line_number = rows[0].next_line;
        }

        // 🧾 Always calculate extended_rcv from qty * unit_rcv
        const extended_rcv =
            Number(quantity || 0) * Number(unit_rcv || 0);

        const sql = `
  INSERT INTO ${t("inventory_items")}
  (line_number, room_area, quantity, description,
   brand, model, unit_rcv, acv_percent, acv,
   source_link, notes)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  RETURNING *;
`;

        const result = await pool.query(sql, [
            line_number,
            room_area,
            quantity,
            description,
            brand,
            model,
            unit_rcv,
            acv_percent,
            acv,
            source_link,
            notes,
        ]);

        res.json({ status: "success", item: result.rows[0] });
    } catch (err) {
        console.error("POST /api/items error:", err.message);
        res.status(500).json({ status: "error", message: err.message });
    }
});


// --- DELETE ITEM ---
app.delete("/api/items/:line_number", async (req, res) => {
    const { line_number } = req.params;
    try {
        const del = await pool.query(
            `DELETE FROM ${t("inventory_items")} WHERE line_number = $1 RETURNING *;`,
            [line_number]
        );
        if (del.rowCount === 0)
            return res.status(404).json({ error: "Item not found" });
        res.json({ status: "deleted", item: del.rows[0] });
    } catch (err) {
        console.error("DELETE /api/items/:line_number error:", err.message);
        res.status(500).json({ error: err.message });
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



// ======================================================
// SPACES API
// ======================================================
const multer = require("multer");
const uploadDir = path.join(__dirname, "public/uploads/spaces");

// ✅ Ensure upload folder exists
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ✅ Configure Multer
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

// ======================================================
// GET all spaces (optionally filtered by client_id)
// ======================================================
app.get("/api/spaces", async (req, res) => {
  try {
    const clientId = req.query.client_id || 1;
    const result = await pool.query(
      `
      SELECT space_id, client_id, space_name, image_url
      FROM ${schema}.spaces
      WHERE client_id = $1
      ORDER BY space_name;
      `,
      [clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error loading spaces:", err);
    res.status(500).json({ error: "Error loading spaces" });
  }
});

// ======================================================
// CREATE or UPDATE a space (name + image)
// ======================================================
app.post("/api/spaces", async (req, res) => {
  try {
    const { client_id = 1, space_name, image_url } = req.body;

    if (!space_name) {
      return res.status(400).json({ error: "space_name required" });
    }

    const result = await pool.query(
      `
      INSERT INTO ${schema}.spaces (client_id, space_name, image_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (client_id, space_name)
      DO UPDATE SET image_url = EXCLUDED.image_url
      RETURNING *;
      `,
      [client_id, space_name, image_url || null]
    );

    res.json({ status: "success", space: result.rows[0] });
  } catch (err) {
    console.error("POST /api/spaces error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// UPLOAD space image
// ======================================================
app.post("/api/spaces/:id/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // ✅ Build URL-safe relative path for browser
    const filePath = `/uploads/spaces/${req.file.filename}`;

    await pool.query(
      `UPDATE ${schema}.spaces SET image_url = $1 WHERE space_id = $2;`,
      [filePath, req.params.id]
    );

    res.json({ status: "uploaded", image_url: filePath });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// GET labels for a room
// ======================================================
app.get("/api/spaces/:id/labels", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT 
          l.label_id,
          l.item_id,                -- ✅ include item_id
          l.x_percent,
          l.y_percent,
          l.label_text,
          i.description,
          i.brand,
          i.model
       FROM ${schema}.space_labels l
       LEFT JOIN ${schema}.inventory_items i ON i.id = l.item_id
       WHERE l.space_id = $1`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /labels error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// GET image + label info for a specific item
// ======================================================
app.get("/api/items/:item_id/labelinfo", async (req, res) => {
  try {
    const { item_id } = req.params;

    const result = await pool.query(
      `SELECT 
          s.space_id,
          s.space_name,
          s.image_url,
          l.label_id,
          l.x_percent,
          l.y_percent,
          l.label_text
       FROM ${schema}.space_labels l
       JOIN ${schema}.spaces s ON l.space_id = s.space_id
       WHERE l.item_id = $1
       LIMIT 1;`, // in case of multiple labels per item, grab the first
      [item_id]
    );

    if (result.rowCount === 0)
      return res.json({ hasLabel: false });

    res.json({ hasLabel: true, ...result.rows[0] });
  } catch (err) {
    console.error("GET /labelinfo error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ======================================================
// POST new label
// ======================================================
app.post("/api/spaces/:id/labels", async (req, res) => {
  try {
    const { id } = req.params;
    let { item_id, x_percent, y_percent, label_text } = req.body;

    // ensure numeric coords
    x_percent = Number(x_percent);
    y_percent = Number(y_percent);

    const result = await pool.query(
      `INSERT INTO ${schema}.space_labels (space_id, item_id, x_percent, y_percent, label_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, item_id || null, x_percent, y_percent, label_text]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /labels error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// GET single item details (for label info)
// ======================================================
app.get("/api/items/byid/:item_id", async (req, res) => {
  try {
    const { item_id } = req.params;
    const result = await pool.query(
      `SELECT line_number, room_area, quantity, description, brand, model,
              unit_rcv, extended_rcv, acv_percent, acv, notes
         FROM ${schema}.inventory_items
        WHERE id = $1`,
      [item_id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Item not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /items/byid error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ======================================================
// DELETE label (by label_id)
// ======================================================
app.delete("/api/spaces/:space_id/labels/:label_id", async (req, res) => {
  try {
    const { label_id } = req.params;

    console.log("🗑 Attempting to delete label:", label_id);

    const result = await pool.query(
      `DELETE FROM ${schema}.space_labels WHERE label_id = $1 RETURNING *;`,
      [label_id]
    );

    if (result.rowCount === 0) {
      console.warn("⚠️ Label not found for deletion:", label_id);
      return res.status(404).json({ error: "Label not found" });
    }

    console.log("✅ Deleted label:", result.rows[0]);
    res.json({ status: "deleted", label_id });
  } catch (err) {
    console.error("❌ DELETE /labels error:", err);
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
