<?php
require_once __DIR__ . '/helpers.php';

function route(string $method, string $uri, string $body, string $queryString): void {
    $path = parse_url($uri, PHP_URL_PATH);

    // Parse query string
    parse_str($queryString, $queryParams);

    switch (true) {
        case ($method === 'GET' && $path === '/board'):
            handle_list_posts($queryParams);
            return;

        case ($method === 'POST' && $path === '/board'):
            handle_create_post($body);
            return;

        case ($method === 'GET' && ($path === '/' || $path === '')):
            write_response(302, ['Location' => '/board'], '');
            return;

        default:
            write_response(404, ['Content-Type' => 'text/html; charset=utf-8'], '<h1>404 Not Found</h1>');
            return;
    }
}

function handle_list_posts(array $queryParams): void {
    $page = max(1, intval($queryParams['page'] ?? 1));
    $limit = min(100, max(1, intval($queryParams['limit'] ?? 20)));
    $offset = ($page - 1) * $limit;

    // First DB operation: get total count
    // Save state so resume.php knows what to do next
    request_db_operation('query', 'SELECT COUNT(*) as total FROM posts', [], [
        'phase' => 'list_count',
        'page' => $page,
        'limit' => $limit,
        'offset' => $offset,
    ]);
    // PHP execution ends here. resume.php will continue.
}

function handle_create_post(string $body): void {
    parse_str($body, $params);

    $authorName = trim($params['author_name'] ?? '');
    $content = trim($params['content'] ?? '');

    // Validation
    $errors = [];
    if ($authorName === '' || mb_strlen($authorName) > 100) {
        $errors[] = '名前は1〜100文字で入力してください';
    }
    if ($content === '' || mb_strlen($content) > 2000) {
        $errors[] = '内容は1〜2000文字で入力してください';
    }

    if (!empty($errors)) {
        $html = render_error_page($errors);
        write_response(400, ['Content-Type' => 'text/html; charset=utf-8'], $html);
        return;
    }

    // Request DB insert
    request_db_operation('execute', 'INSERT INTO posts (author_name, content) VALUES ($1, $2)', [$authorName, $content], [
        'phase' => 'create_post',
    ]);
    // PHP execution ends here. resume.php will continue.
}

function render_error_page(array $errors): string {
    ob_start();
    require __DIR__ . '/views/error.php';
    return ob_get_clean();
}
