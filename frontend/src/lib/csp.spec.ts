import { buildCspHeader } from './csp';

describe('buildCspHeader', () => {
  const originalApi = process.env['NEXT_PUBLIC_API_URL'];
  const originalWs = process.env['NEXT_PUBLIC_WS_URL'];

  afterEach(() => {
    process.env['NEXT_PUBLIC_API_URL'] = originalApi;
    process.env['NEXT_PUBLIC_WS_URL'] = originalWs;
  });

  it('should embed the provided nonce in script-src', () => {
    const csp = buildCspHeader('test-nonce-123');
    expect(csp).toContain("'nonce-test-nonce-123'");
    expect(csp).toContain("'strict-dynamic'");
  });

  it('should allow browser API and WebSocket origins in connect-src', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:3001';
    process.env['NEXT_PUBLIC_WS_URL'] = 'http://localhost:3001';

    const csp = buildCspHeader('abc');
    expect(csp).toContain('http://localhost:3001');
    expect(csp).toContain('ws://localhost:3001');
  });

  it('should disallow framing and plugins', () => {
    const csp = buildCspHeader('abc');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('should omit upgrade-insecure-requests when API URLs are http (Compose/minikube)', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'http://task-tracker.local/api';
    process.env['NEXT_PUBLIC_WS_URL'] = 'http://task-tracker.local';

    const csp = buildCspHeader('abc');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('should include upgrade-insecure-requests when API URLs are https', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';
    process.env['NEXT_PUBLIC_WS_URL'] = 'https://api.example.com';

    const csp = buildCspHeader('abc');
    expect(csp).toContain('upgrade-insecure-requests');
  });
});
