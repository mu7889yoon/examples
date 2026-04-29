<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>掲示板 - PHP-WASM on Lambda@Edge</title>
</head>
<body>
    <h1>掲示板</h1>
    <p>PHP-WASM on Lambda@Edge PoC</p>

    <h2>新規投稿</h2>
    <form method="POST" action="/board">
        <div>
            <label>名前: <input type="text" name="author_name" maxlength="100" required></label>
        </div>
        <div>
            <label>内容:<br>
                <textarea name="content" rows="4" cols="50" maxlength="2000" required></textarea>
            </label>
        </div>
        <div>
            <button type="submit">投稿する</button>
        </div>
    </form>

    <h2>投稿一覧 (<?= h((string)$totalCount) ?> 件)</h2>

    <?php if (empty($posts)): ?>
        <p>投稿はまだありません。</p>
    <?php else: ?>
        <?php foreach ($posts as $post): ?>
            <div>
                <hr>
                <p><strong><?= h($post['author_name']) ?></strong> - <?= h($post['created_at']) ?></p>
                <p><?= nl2br(h($post['content'])) ?></p>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>

    <hr>
    <div>
        <?php if ($page > 1): ?>
            <a href="/board?page=<?= $page - 1 ?>&limit=<?= $limit ?>">前のページ</a>
        <?php endif; ?>
        <?php if ($hasNextPage): ?>
            <a href="/board?page=<?= $page + 1 ?>&limit=<?= $limit ?>">次のページ</a>
        <?php endif; ?>
    </div>
</body>
</html>
