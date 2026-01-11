const statusEl = document.getElementById('status')

async function init() {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map(r => r.unregister()))
  
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { type: 'module' })
    await navigator.serviceWorker.ready
    
    const channel = new MessageChannel()
    channel.port1.onmessage = handleMessage
    channel.port1.start()
    navigator.serviceWorker.controller?.postMessage({ type: 'INIT_PORT' }, [channel.port2])
    
    statusEl.textContent = '準備完了'
    htmx.ajax('GET', '/api/images', { target: '#imageList' })
  } catch {
    statusEl.textContent = 'SW登録エラー'
  }
}

function handleMessage(e) {
  const { type, id, blob, query, tags } = e.data
  const port = e.currentTarget

  if (type === 'ANNOTATE') {
    annotateImage(blob).then(annotation => port.postMessage({ id, annotation }))
  }
  if (type === 'SEARCH') {
    searchWithAI(query, tags).then(indices => port.postMessage({ id, indices }))
  }
}

async function annotateImage(blob) {
  if (!('LanguageModel' in self)) return ''
  try {
    const session = await self.LanguageModel.create({
      expectedInputs: [{ type: 'image' }, { type: 'text' }],
      languageCode: 'ja'
    })
    const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' })
    let result = ''
    for await (const chunk of session.promptStreaming([{
      role: 'user',
      content: [
        { type: 'text', value: 'この画像に含まれる要素をタグ形式で列挙してください。カンマ区切りで、例: 猫, ソファ, 窓, 日光' },
        { type: 'image', value: file }
      ]
    }])) {
      result += chunk
    }
    session.destroy()
    return result
  } catch {
    return ''
  }
}

async function searchWithAI(query, tags) {
  if (!('LanguageModel' in self)) return []
  try {
    const session = await self.LanguageModel.create({ languageCode: 'ja' })
    const tagList = tags.map((t, i) => `${i}: ${t}`).join('\n')
    let result = ''
    for await (const chunk of session.promptStreaming(`あなたは画像検索アシスタントです。ユーザーの検索クエリの意図を理解し、関連する画像を見つけてください。

例:
- 「生き物」→ 猫、犬、馬、鳥、魚など動物全般
- 「食べ物」→ 料理、果物、野菜、お菓子など
- 「乗り物」→ 車、電車、飛行機、自転車など
- 「自然」→ 山、海、森、花、空など

以下の画像タグリストから、検索クエリに意味的に関連する画像の番号を全て選んでください。
直接的な一致だけでなく、カテゴリや概念として関連するものも含めてください。

タグリスト:
${tagList}

検索クエリ: ${query}

関連する画像の番号をカンマ区切りで返してください。該当なしの場合は「なし」と返してください。
回答:`)) {
      result += chunk
    }
    session.destroy()
    if (result.includes('なし')) return []
    return (result.match(/\d+/g) || []).map(Number)
  } catch {
    return []
  }
}

init()
