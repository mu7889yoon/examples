<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<title>Laravel Lambda Bref BBS</title>
<body>
  <h1>Laravel Lambda Bref BBS</h1>

  @if ($errors->any())
    <div>{{ $errors->first('content') }}</div>
  @endif

  <form method="post" action="{{ route('posts.store') }}">
    @csrf
    <input type="text" name="content" placeholder="ひとこと" required maxlength="255">
    <button type="submit">投稿</button>
  </form>

  <hr>
  <ul>
    @foreach ($posts as $p)
      <li>
        {{ $p->content }}
        <form method="post" action="{{ route('posts.destroy', $p) }}" onsubmit="return confirm('削除しますか？');">
          @csrf
          @method('DELETE')
          <button type="submit">削除</button>
        </form>
      </li>
    @endforeach
  </ul>
</body>
</html>

