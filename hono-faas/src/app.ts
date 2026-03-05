import { Hono } from 'hono';
import { invokeFunction } from './controllers/functionController';
import { registerFunction, showRegisterForm } from './controllers/registerController';
import { logEvent } from './services/logger';

const app = new Hono();

app.post('/register', registerFunction);
app.get('/register', showRegisterForm);
app.post('/function/:name', invokeFunction);

app.onError((error, c) => {
  logEvent('server error', { message: error.message });
  return c.json({ statusCode: 500, body: `Error: ${error.message}` }, 500);
});

app.notFound((c) => c.json({ statusCode: 404, body: 'Not found' }, 404));

export default app;
