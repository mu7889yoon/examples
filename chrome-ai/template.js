export const renderCard = (img) => `
<div class="group relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all hover:shadow-md" id="image-${img.id}">
  <div class="aspect-square overflow-hidden">
    <img src="/api/blob/${img.id}" alt="${img.fileName}" class="h-full w-full object-cover transition-transform group-hover:scale-105">
  </div>
  <div class="p-4">
    <p class="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">${img.annotation || '（アノテーションなし）'}</p>
    <button 
      hx-post="/api/annotate/${img.id}" 
      hx-target="#image-${img.id}" 
      hx-swap="outerHTML"
      class="mt-3 w-full inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
      ${img.annotation ? 'タグを再生成' : 'タグを生成'}
    </button>
  </div>
</div>`

export const renderPagination = (page, totalPages, baseUrl) => {
  if (totalPages <= 1) return ''
  
  const buttons = []
  
  if (page > 1) {
    buttons.push(`<button hx-get="${baseUrl}&page=${page - 1}" hx-target="#imageList" class="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 border border-input bg-background hover:bg-accent transition-colors">前へ</button>`)
  }
  
  buttons.push(`<span class="inline-flex items-center justify-center text-sm text-muted-foreground px-2">${page} / ${totalPages}</span>`)
  
  if (page < totalPages) {
    buttons.push(`<button hx-get="${baseUrl}&page=${page + 1}" hx-target="#imageList" class="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 border border-input bg-background hover:bg-accent transition-colors">次へ</button>`)
  }
  
  return `<div class="col-span-full flex items-center justify-center gap-2 mt-4">${buttons.join('')}</div>`
}

export const renderList = (images, page = 1, totalPages = 1, baseUrl = '/api/images?') => 
  images.length 
    ? images.map(renderCard).join('') + renderPagination(page, totalPages, baseUrl)
    : renderEmpty('画像がありません')

export const renderEmpty = (message) => `
<div class="col-span-full flex flex-col items-center justify-center py-12 text-center">
  <svg class="w-12 h-12 text-muted-foreground/50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
  </svg>
  <p class="text-muted-foreground">${message}</p>
</div>`
