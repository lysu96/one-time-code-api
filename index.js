require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

// Kết nối MySQL dùng biến môi trường
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// Hàm tạo mã ngẫu nhiên
function generateRandomCode(length = 10) {
  return Math.random().toString(36).substr(2, length).toUpperCase();
}

// Tạo mã dùng một lần (hết hạn sau 10 phút)
app.post("/generate", async (req, res) => {
  const code = generateRandomCode();
  const expiresAt = new Date(Date.now() + 10 * 60000); // 10 phút

  try {
    await db.query(
      "INSERT INTO one_time_codes (code, expires_at) VALUES (?, ?)",
      [code, expiresAt]
    );
    res.json({ success: true, code, expires_at: expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi tạo mã" });
  }
});

// Sử dụng mã một lần
app.post("/use-code", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Thiếu mã" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT * FROM one_time_codes WHERE code = ? AND used_at IS NULL AND expires_at > NOW()",
      [code]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Mã không hợp lệ, đã dùng hoặc hết hạn" });
    }

    const usedAt = new Date();
    await conn.query(
      "UPDATE one_time_codes SET used_at = ? WHERE code = ?",
      [usedAt, code]
    );

    await conn.commit();
    res.json({ success: true, message: "Mã hợp lệ và đã được sử dụng", used_at: usedAt });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  } finally {
    conn.release();
  }
});

// Dọn dẹp mã đã dùng hoặc hết hạn
app.delete("/cleanup", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM one_time_codes WHERE used_at IS NOT NULL OR expires_at <= NOW()"
    );
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi dọn dẹp mã" });
  }
});

// Khởi chạy server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});
