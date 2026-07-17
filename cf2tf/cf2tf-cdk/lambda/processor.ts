import { SQSEvent, SQSRecord } from 'aws-lambda';

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    await processMessage(record);
  }
}

async function processMessage(record: SQSRecord): Promise<void> {
  const body = JSON.parse(record.body);
  console.log('Processing message:', JSON.stringify(body, null, 2));

  // ここにビジネスロジックを実装
  // 例: DB への書き込み、外部 API 呼び出し、通知送信など
}
