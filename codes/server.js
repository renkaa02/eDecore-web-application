// eDecor backend

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_KEY = process.env.ADMIN_KEY || 'edecor-admin';

// Database path
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Middleware
app.use(cors());
app.use(express.json());

// Serve index.html and admin.html from the main project folder
app.use(express.static(__dirname));

// --------------------------------------------------
// JSON Database
// --------------------------------------------------

function readDB() {
  const dataFolder = path.join(__dirname, 'data');

  // Create data folder if it doesn't exist
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
  }

  // Create database file if it doesn't exist
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        {
          users: [],
          logins: [],
          events: []
        },
        null,
        2
      )
    );
  }

  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// --------------------------------------------------
// JWT Token
// --------------------------------------------------

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );
}

// --------------------------------------------------
// Authentication
// --------------------------------------------------

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: 'Not signed in.'
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.userId = payload.sub;
    req.userEmail = payload.email;

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Session expired. Please sign in again.'
    });
  }
}

// --------------------------------------------------
// Admin Authentication
// --------------------------------------------------

function adminRequired(req, res, next) {
  const key = req.headers['x-admin-key'];

  if (key !== ADMIN_KEY) {
    return res.status(401).json({
      error: 'Invalid admin key.'
    });
  }

  next();
}

// --------------------------------------------------
// Sign Up
// --------------------------------------------------

app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      error: 'Name, email and password are required.'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: 'Password must be at least 6 characters.'
    });
  }

  const db = readDB();

  const normalizedEmail = String(email)
    .trim()
    .toLowerCase();

  const existingUser = db.users.find(
    (user) => user.email === normalizedEmail
  );

  if (existingUser) {
    return res.status(409).json({
      error: 'An account with that email already exists.'
    });
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);

  db.logins.push({
    userId: user.id,
    email: user.email,
    at: user.createdAt,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
    type: 'signup'
  });

  writeDB(db);

  const token = signToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});

// --------------------------------------------------
// Login
// --------------------------------------------------

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required.'
    });
  }

  const db = readDB();

  const normalizedEmail = String(email)
    .trim()
    .toLowerCase();

  const user = db.users.find(
    (user) => user.email === normalizedEmail
  );

  if (
    !user ||
    !bcrypt.compareSync(password, user.passwordHash)
  ) {
    return res.status(401).json({
      error: 'Incorrect email or password.'
    });
  }

  db.logins.push({
    userId: user.id,
    email: user.email,
    at: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
    type: 'login'
  });

  writeDB(db);

  const token = signToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});

// --------------------------------------------------
// Get Current User
// --------------------------------------------------

app.get('/api/me', authRequired, (req, res) => {
  const db = readDB();

  const user = db.users.find(
    (user) => user.id === req.userId
  );

  if (!user) {
    return res.status(404).json({
      error: 'User not found.'
    });
  }

  const loginCount = db.logins.filter(
    (login) => login.userId === user.id
  ).length;

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    loginCount
  });
});

// --------------------------------------------------
// Track Usage
// --------------------------------------------------

app.post('/api/track', authRequired, (req, res) => {
  const { event, meta } = req.body || {};

  if (!event) {
    return res.status(400).json({
      error: 'event is required.'
    });
  }

  const db = readDB();

  db.events.push({
    userId: req.userId,
    email: req.userEmail,
    event: String(event),
    meta: meta || {},
    at: new Date().toISOString()
  });

  writeDB(db);

  res.json({
    ok: true
  });
});

// --------------------------------------------------
// Admin Statistics
// --------------------------------------------------

app.get('/api/admin/stats', adminRequired, (req, res) => {
  const db = readDB();

  const users = db.users.map((user) => {
    const userLogins = db.logins.filter(
      (login) => login.userId === user.id
    );

    const lastLogin =
      userLogins.length > 0
        ? userLogins
            .map((login) => login.at)
            .sort()
            .slice(-1)[0]
        : null;

    const eventCount = db.events.filter(
      (event) => event.userId === user.id
    ).length;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      loginCount: userLogins.length,
      lastLogin,
      eventCount
    };
  });

  const eventCounts = {};

  db.events.forEach((event) => {
    eventCounts[event.event] =
      (eventCounts[event.event] || 0) + 1;
  });

  const recentLogins = [...db.logins]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  const recentEvents = [...db.events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  res.json({
    totalUsers: db.users.length,
    totalLogins: db.logins.length,
    totalEvents: db.events.length,
    eventCounts,
    users,
    recentLogins,
    recentEvents
  });
});

// --------------------------------------------------
// Start Server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`eDecor backend running at http://localhost:${PORT}`);
  console.log(
    `Admin dashboard: http://localhost:${PORT}/admin.html`
  );
});