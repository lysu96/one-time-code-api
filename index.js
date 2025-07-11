require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Tự tạo bảng nếu chưa có
async function createTableIfNotExists() {
  const query = `
    CREATE TABLE IF NOT EXISTS one_time_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(255) UNIQUE NOT NULL,
      used BOOLEAN DEFAULT false,
      expires_at TIMESTAMP NOT NULL
    );
  `;
  await pool.query(query);
}

// Sinh mã ngẫu nhiên
function generateRandomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

app.post("/generate", async (req, res) => {
  const code = generateRandomCode();
  const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 phút

  try {
    await pool.query(
      "INSERT INTO one_time_codes (code, expires_at) VALUES ($1, $2)",
      [code, expires_at]
    );
    res.json({ success: true, code, expires_at });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/use-code", async (req, res) => {
  const { code } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM one_time_codes WHERE code = $1 AND used = false AND expires_at > NOW()",
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired code" });
    }

    await pool.query(
      "UPDATE one_time_codes SET used = true WHERE code = $1",
      [code]
    );

    res.json({ success: true, message: "Code used successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tự tạo bảng trước khi server chạy
createTableIfNotExists().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});
