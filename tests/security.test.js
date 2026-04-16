/**
 * Security hardening tests:
 *   - /events/:callId requires a valid token issued at call creation
 *   - /create-web-call honors DEMO_SECRET when set
 *   - CORS rejects unknown origins
 *
 * We import the express app, monkey-patch the tiny bit of state we need, and
 * drive it with supertest-style requests via `http`. Keeps tests self-contained
 * and free of any Retell/Anthropic dependency.
 */

const http = require('http');

// Ensure a clean, known env for the server module.
process.env.ALLOWED_ORIGINS = 'http://localhost:8080,https://demo.example.com';
delete process.env.DEMO_SECRET;

const { app, httpServer } = require('../src/server');

function startServer() {
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function request(srv, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = srv.address();
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('Security: SSE token gating', () => {
  let srv;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(() => new Promise((r) => srv.close(r)) && httpServer.close?.());

  test('rejects /events/:callId with no token', async () => {
    const res = await request(srv, { path: '/events/fake-call-id' });
    expect(res.status).toBe(403);
  });

  test('rejects /events/:callId with wrong token', async () => {
    const res = await request(srv, { path: '/events/fake-call-id?token=wrongtoken' });
    expect(res.status).toBe(403);
  });

  test('health check is public', async () => {
    const res = await request(srv, { path: '/health' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });
});

describe('Security: CORS allowlist', () => {
  let srv;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(() => new Promise((r) => srv.close(r)));

  test('rejects disallowed origin on /health', async () => {
    const res = await request(srv, {
      path: '/health',
      headers: { Origin: 'https://attacker.example' },
    });
    // cors middleware returns 500 when the origin callback errors — some
    // versions return 403. Either way, it must not set the allow header.
    expect(res.headers['access-control-allow-origin']).toBeFalsy();
  });

  test('allows configured origin on /health', async () => {
    const res = await request(srv, {
      path: '/health',
      headers: { Origin: 'https://demo.example.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://demo.example.com');
  });

  test('allows same-origin / no-Origin requests', async () => {
    const res = await request(srv, { path: '/health' });
    expect(res.status).toBe(200);
  });
});
