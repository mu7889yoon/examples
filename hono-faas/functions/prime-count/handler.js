function countPrimes(limit) {
  const n = Math.floor(limit);
  if (n < 2) {
    return 0;
  }

  const isPrime = new Array(n + 1).fill(true);
  isPrime[0] = false;
  isPrime[1] = false;

  for (let i = 2; i * i <= n; i += 1) {
    if (!isPrime[i]) continue;
    for (let j = i * i; j <= n; j += i) {
      isPrime[j] = false;
    }
  }

  let count = 0;
  for (let i = 2; i <= n; i += 1) {
    if (isPrime[i]) count += 1;
  }
  return count;
}

export default async function handler(event) {
  const value = event?.body?.n;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) {
    return { statusCode: 400, body: 'Invalid n' };
  }

  const result = countPrimes(n);
  return { statusCode: 200, body: String(result) };
}
