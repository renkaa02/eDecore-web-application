// Self-contained end-to-end test for the sign-up / login / gating flow.
// It starts the REAL server on a scratch port, loads the REAL public/index.html
// into a DOM, and clicks/submits things exactly like a person would — no
// mocking of the app's own code. Run with: npm test

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function waitForServer(url, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error('Server did not start in time'));
        else setTimeout(poll, 150);
      });
    })();
  });
}

(async () => {
  // Start from a clean, empty database for a repeatable test run.
  const originalDb = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH, 'utf-8') : null;
  fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], logins: [], events: [] }, null, 2));

  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT, ADMIN_KEY: 'test-admin-key' },
    stdio: 'ignore',
  });

  let allPass = false;
  try {
    await waitForServer(BASE + '/');

    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');
    const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'dangerously', pretendToBeVisualDevice: true });
    const { window } = dom;

    // jsdom has no fetch; use Node's, resolved against the app's own origin
    // exactly the way a browser resolves a relative "/api/..." URL.
    window.fetch = (input, init) => {
      const url = typeof input === 'string' && input.startsWith('/') ? BASE + input : input;
      return fetch(url, init);
    };

    await new Promise(res => {
      if (window.document.readyState === 'complete') return res();
      window.addEventListener('load', res);
    });
    await new Promise(res => setTimeout(res, 100)); // let inline init scripts settle

    const doc = window.document;
    const results = [];
    const check = (label, cond) => results.push({ label, pass: !!cond });
    const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    // 1. Nothing gated should be usable while logged out.
    check('no token in localStorage initially', !window.localStorage.getItem('edecor_token'));
    const kitchenBtn = [...doc.querySelectorAll('.room-type-card')].find(b => b.dataset.room === 'kitchen');
    click(kitchenBtn);
    check('gated click opens the sign-in modal', doc.getElementById('authModal').classList.contains('open'));
    check('the gated action itself did NOT run', !kitchenBtn.classList.contains('active'));

    // 2. Sign up through the real modal -> real /api/signup.
    click(doc.getElementById('tabSignup'));
    doc.getElementById('authName').value = 'Test User';
    doc.getElementById('authEmail').value = `test+${Date.now()}@example.com`;
    doc.getElementById('authPassword').value = 'secret123';
    doc.getElementById('authForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(res => setTimeout(res, 500));

    check('token stored after signup', !!window.localStorage.getItem('edecor_token'));
    check('modal closes after signup', !doc.getElementById('authModal').classList.contains('open'));
    check('header greets the signed-in user', doc.getElementById('authArea').textContent.includes('Test User'));
    check('the original click replays automatically', kitchenBtn.classList.contains('active'));

    // 3. Now signed in: gated actions should work immediately, no modal.
    click(doc.getElementById('generateBtn'));
    await new Promise(res => setTimeout(res, 300));
    check('Generate works with no modal interruption', !doc.getElementById('authModal').classList.contains('open'));
    check('layout output updates (room label)', doc.getElementById('roomNameLabel').textContent.includes('Kitchen'));
    check('space-utilization score renders', doc.getElementById('scoreNum').textContent !== '—');

    // 4. Log out -> gate re-engages.
    click(doc.getElementById('logoutBtn'));
    check('token cleared after logout', !window.localStorage.getItem('edecor_token'));
    const bedroomBtn = [...doc.querySelectorAll('.room-type-card')].find(b => b.dataset.room === 'bedroom');
    click(bedroomBtn);
    check('gate re-engages after logout', doc.getElementById('authModal').classList.contains('open'));

    // 5. Admin stats endpoint reflects the activity above.
    const statsRes = await fetch(BASE + '/api/admin/stats', { headers: { 'x-admin-key': 'test-admin-key' } });
    const stats = await statsRes.json();
    check('admin stats: exactly one account created', stats.totalUsers === 1);
    check('admin stats: at least one login recorded', stats.totalLogins >= 1);
    const wrongKeyRes = await fetch(BASE + '/api/admin/stats', { headers: { 'x-admin-key': 'not-the-key' } });
    check('admin stats reject the wrong key', wrongKeyRes.status === 401);

    console.log('\n=== eDecor auth flow test ===');
    allPass = true;
    for (const r of results) {
      console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.label);
      if (!r.pass) allPass = false;
    }
    console.log(allPass ? '\nAll checks passed.' : '\nSOME CHECKS FAILED.');
  } finally {
    server.kill();
    if (originalDb !== null) fs.writeFileSync(DB_PATH, originalDb);
    else fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], logins: [], events: [] }, null, 2));
  }

  process.exit(allPass ? 0 : 1);
})();
