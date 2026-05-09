import { Agent, setGlobalDispatcher } from 'undici';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadCaBundle() {
  const candidates = [
    path.join(__dirname, 'ca-bundle.pem'),
    path.join(__dirname, '..', 'lib', 'ca-bundle.pem'),
    path.join(process.cwd(), 'src', 'lib', 'ca-bundle.pem'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {}
  }
  return undefined;
}

const caBundle = loadCaBundle();

export const fetchAgent = new Agent({
  connections: 10,
  keepAliveTimeout: 3000,
  maxRequestsPerClient: 100,
  connect: {
    checkServerIdentity: () => undefined,
    ca: caBundle,
  },
});

setGlobalDispatcher(fetchAgent);
