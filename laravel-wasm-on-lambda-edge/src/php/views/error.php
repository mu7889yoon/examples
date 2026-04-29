<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>エラー - 掲示板</title>
</head>
<body>
    <h1>入力エラー</h1>
    <ul>
        <?php foreach ($errors as $error): ?>
            <li><?= h($error) ?></li>
        <?php endforeach; ?>
    </ul>
    <p><a href="/board">掲示板に戻る</a></p>
</body>
</html>
