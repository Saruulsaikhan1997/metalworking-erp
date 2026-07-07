const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load } = require('../database');

const router = express.Router();
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET environment variable is required. Check .env file.');

// ── Login brute-force хамгаалалт (пакетгүй, санах ойд) ──
// Нэг IP-ээс 15 минутанд дээд тал нь 10 буруу оролдлого. Хэтэрвэл 429.
// Амжилттай нэвтэрвэл тухайн IP-ийн тоолуур цэвэрлэгдэнэ.
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX = 10;
const loginHits = new Map(); // ip -> { count, first }
function loginBlocked(ip) {
  const now = Date.now();
  const rec = loginHits.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW) { loginHits.set(ip, { count: 1, first: now }); return false; }
  rec.count++;
  return rec.count > LOGIN_MAX;
}
// Санах ой хамгаалах — хугацаа дууссан бичлэгийг үе үе цэвэрлэх
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginHits) if (now - rec.first > LOGIN_WINDOW) loginHits.delete(ip);
}, LOGIN_WINDOW).unref();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Нэвтрэх нэр, нууц үг оруулна уу' });

  if (loginBlocked(req.ip)) {
    return res.status(429).json({ error: 'Хэт олон оролдлого. Хэсэг хугацааны дараа дахин оролдоно уу.' });
  }

  const db = load();
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Нэвтрэх нэр эсвэл нууц үг буруу' });
  }
  loginHits.delete(req.ip); // амжилттай — тоолуур цэвэрлэх

  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ token, user: { name: user.name, role: user.role } });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

module.exports = router;
