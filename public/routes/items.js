// ======================================================
// File: /server/routes/items.js
// ======================================================
import express from "express";
import pool from "../db/pool.js";

const router = express.Router();

// === GET all items ===
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT line_number, room_area, quantity, description,
             unit_rcv, extended_rcv
      FROM claims.inventory_items
      ORDER BY line_number ASC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching items:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
