import app from './app';
import { loadConfig } from './models/storage';
import { logEvent } from './services/logger';

const config = await loadConfig();
const server = Bun.serve({ fetch: app.fetch, port: config.port });
logEvent('server started', { port: server.port });

export default app;
