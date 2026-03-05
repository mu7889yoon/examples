async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const raw = await readStdin();
  const event = raw.trim() ? JSON.parse(raw) : { body: null, metadata: {} };

  const handlerModule = await import('/app/handler.js');
  const handler = handlerModule.default;
  if (typeof handler !== 'function') {
    throw new Error('handler default export must be a function');
  }

  const result = await handler(event);
  let statusCode = 200;
  let body = '';

  if (result && typeof result === 'object') {
    const maybeStatus = result.statusCode;
    const maybeBody = result.body;
    if (typeof maybeStatus === 'number') {
      statusCode = maybeStatus;
    }
    if (typeof maybeBody === 'string') {
      body = maybeBody;
    } else if (typeof maybeBody !== 'undefined') {
      body = JSON.stringify(maybeBody);
    }
  } else if (typeof result !== 'undefined') {
    body = String(result);
  }

  console.log(JSON.stringify({ statusCode, body }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
