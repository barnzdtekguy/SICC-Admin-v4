const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const checks = [
  {
    path: '/api/health',
    name: 'API and database',
    verify: async response => (await response.json()).ok === true,
  },
  {
    path: '/app/overview',
    name: 'Web app deep link',
    verify: async response => (await response.text()).includes('id="root"'),
  },
  {
    path: '/sw.js',
    name: 'Service worker',
    verify: response => response.headers.get('cache-control') === 'no-cache',
  },
  {
    path: '/manifest.json',
    name: 'Web app manifest',
    verify: async response => (await response.json()).icons?.length > 0,
  },
];

for (const { path, name, verify } of checks) {
  try {
    const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!await verify(response)) throw new Error('Unexpected response');
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name} (GET ${path}): ${error.message}`);
    process.exitCode = 1;
  }
}
