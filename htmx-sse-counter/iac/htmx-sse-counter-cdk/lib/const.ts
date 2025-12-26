import * as path from 'node:path';

const APP_ROOT = path.join(__dirname, '../../../src')
export const INCREMENT_LAMBDA_ROOT = path.join(APP_ROOT, 'lambda/increment')
export const STREAMING_LAMBDA_ROOT = path.join(APP_ROOT, 'lambda/sse')
export const FRONTEND_ROOT = path.join(APP_ROOT, 'frontend')
