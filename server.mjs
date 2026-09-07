import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist/random-interval');
const browserDir = existsSync(join(dist, 'browser', 'index.html'))
  ? join(dist, 'browser')
  : dist;

const app = express();
app.use(express.static(browserDir));
app.get('*', (_req, res) => {
  res.sendFile(join(browserDir, 'index.html'));
});

const port = Number(process.env['PORT'] || 4000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Random Interval listening on http://0.0.0.0:${port}`);
});
