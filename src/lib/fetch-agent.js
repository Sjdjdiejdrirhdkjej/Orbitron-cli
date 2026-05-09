import { Agent, setGlobalDispatcher } from 'undici';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadCaBundle() {
  const candidates = [
    // Development: src/lib/ca-bundle.pem (this file lives in src/lib/)
    path.join(__dirname, 'ca-bundle.pem'),
    // Compiled build: dist/lib/ca-bundle.pem (this file is in dist/ alongside lib/)
    path.join(__dirname, '..', 'lib', 'ca-bundle.pem'),
    // Fallback from project root
    path.join(process.cwd(), 'src', 'lib', 'ca-bundle.pem'),
    path.join(process.cwd(), 'dist', 'lib', 'ca-bundle.pem'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {
      // ignore and try next candidate
    }
  }
  return undefined;
}

const caBundle = loadCaBundle();

export const fetchAgent = new Agent({
  connections: 10,
  keepAliveTimeout: 3000,
  maxRequestsPerClient: 100,
  connect: {
    ca: caBundle,
  },
});

setGlobalDispatcher(fetchAgent);
