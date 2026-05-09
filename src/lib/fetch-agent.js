import { Agent } from "undici";

export const fetchAgent = new Agent({
  connections: 10,
  keepAliveTimeout: 3000,
  maxRequestsPerClient: 100,
});
