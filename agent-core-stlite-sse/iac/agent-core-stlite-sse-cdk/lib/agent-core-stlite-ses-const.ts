import * as path from 'node:path'

const APP_ROOT = path.join(__dirname, '../../../app')
export const WEATHER_AGENT_CORE_ROOT = path.join(APP_ROOT, 'agent-core')
// Lambda のエントリーファイル（NodejsFunction.entry 用）
export const LAMBDA_ROOT = path.join(APP_ROOT, 'lambda')
export const AWS_REGION = 'ap-northeast-1'
export const BEDROCK_MODEL_ID = 'apac.amazon.nova-lite-v1:0'
export const FRONTEND_ROOT = path.join(APP_ROOT, 'stlite')