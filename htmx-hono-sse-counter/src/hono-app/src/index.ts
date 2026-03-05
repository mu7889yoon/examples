import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getCounterValue, incrementCounter } from './services/counter.js'

const POLL_INTERVAL_MS = 1000

const app = new Hono()

app.use('/*', cors())

app.post('/api/increment', async (c) => {
  try {
    const count = await incrementCounter()
    return c.json({ count })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to increment counter', message }, 500)
  }
})

app.get('/api/events', async (c) => {
  return streamSSE(c, async (stream) => {
    let lastCount: number | null = null
    try {
      const initialCount = await getCounterValue()
      lastCount = initialCount
      await stream.writeSSE({
        event: 'counter',
        data: `<div id="counter">${initialCount}</div>`
      })
    } catch (error) {
      console.error('Failed to get initial counter value:', error)
      await stream.writeSSE({
        event: 'error',
        data: 'Failed to get initial counter value'
      })
      return
    }

    while (true) {
      await stream.sleep(POLL_INTERVAL_MS)
      
      try {
        const currentCount = await getCounterValue()
        if (currentCount !== lastCount) {
          lastCount = currentCount
          await stream.writeSSE({
            event: 'counter',
            data: `<div id="counter">${currentCount}</div>`
          })
        }
      } catch (error) {
        console.error('Error polling counter value:', error)
      }
    }
  })
})

const port = 8080
console.log(`Server starting on port ${port}`)
serve({ fetch: app.fetch, port })

export default app
