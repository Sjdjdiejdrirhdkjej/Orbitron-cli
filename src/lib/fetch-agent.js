import { Agent, setGlobalDispatcher } from 'undici';
import tls from 'tls';

export const fetchAgent = new Agent({
  connections: 10,
  keepAliveTimeout: 3000,
  maxRequestsPerClient: 100,
  connect: {
    checkServerIdentity: () => undefined,
  },
});

setGlobalDispatcher(fetchAgent);
