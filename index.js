require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const cron = require("node-cron");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // ✅ Cho phép truy cập từ frontend
app.use(express.json());

// 🔌 Kết nối MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: false,
});

// 📋 Tạo bảng nếu chưa có
async function createTableIfNotExists() {
  const query = `
    CREATE TABLE IF NOT EXISTS one_time_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(255) UNIQUE NOT NULL,
      used BOOLEAN DEFAULT false,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL
    );
  `;
  const conn = await pool.getConnection();
  await conn.query(query);
  conn.release();
}

// 🔐 Sinh mã ngẫu nhiên
function generateRandomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// 📦 API tạo mã
app.post("/generate", async (req, res) => {
  const code = generateRandomCode();
  const expires_at = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

  try {
    const conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO one_time_codes (code, expires_at) VALUES (?, ?)",
      [code, expires_at]
    );
    conn.release();
    res.json({ success: true, code, expires_at });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🧪 API kiểm tra & dùng mã
app.post("/use-code", async (req, res) => {
  const { code } = req.body;
  const now = new Date();

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      "SELECT * FROM one_time_codes WHERE code = ? AND used = false AND expires_at > ?",
      [code, now]
    );

    if (rows.length === 0) {
      conn.release();
      return res.status(400).json({ success: false, message: "Mã không hợp lệ hoặc đã hết hạn." });
    }

    await conn.query(
      "UPDATE one_time_codes SET used = true, used_at = ? WHERE code = ?",
      [now, code]
    );

    conn.release();
    res.json({ success: true, message: "Mã đã được sử dụng", used_at: now });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🧹 Cron dọn dẹp mã hết hạn và đã dùng quá 15 phút
async function deleteExpiredAndUsedCodes() {
  const conn = await pool.getConnection();
  const now = new Date();

  try {
    const [result] = await conn.query(
      `
      DELETE FROM one_time_codes
      WHERE 
        (used = false AND expires_at < ?)
        OR
        (used = true AND used_at < DATE_SUB(?, INTERVAL 15 MINUTE))
      `,
      [now, now]
    );

    if (result.affectedRows > 0) {
      console.log(`[🧹] Đã xoá ${result.affectedRows} mã tại ${now.toISOString()}`);
    }
  } catch (err) {
    console.error("[❌] Lỗi xoá mã:", err.message);
  } finally {
    conn.release();
  }
}

// ⏰ Lên lịch dọn dẹp mỗi phút
cron.schedule("* * * * *", () => {
  deleteExpiredAndUsedCodes();
});

// 🚀 Khởi động server
createTableIfNotExists().then(() => {
  app.listen(port, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${port}`);
    console.log("🧹 Dọn dẹp mã mỗi phút đã được bật.");
  });
});
