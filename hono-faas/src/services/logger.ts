export function logEvent(message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (meta) {
    console.log(`[${timestamp}] ${message}`, meta);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}
