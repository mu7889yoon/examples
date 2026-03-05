export default async function handler(event) {
return { statusCode: 200, body: Hello ${event.body?.name ?? 'world'} };
}