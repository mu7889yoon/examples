<?php
require_once __DIR__ . '/helpers.php';

// Read state and DB result
$state = read_state();
$dbResult = read_db_result();

switch ($state['phase']) {
    case 'list_count':
        // We got the count, now fetch the posts
        $totalCount = intval($dbResult['rows'][0]['total'] ?? 0);
        $page = $state['page'];
        $limit = $state['limit'];
        $offset = $state['offset'];
        $hasNextPage = ($offset + $limit) < $totalCount;

        // Request the actual posts
        request_db_operation('query',
            'SELECT id, author_name, content, created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2',
            [$limit, $offset],
            [
                'phase' => 'list_posts',
                'page' => $page,
                'limit' => $limit,
                'offset' => $offset,
                'totalCount' => $totalCount,
                'hasNextPage' => $hasNextPage,
            ]
        );
        break;

    case 'list_posts':
        // We got the posts, render the page
        $posts = $dbResult['rows'];
        $page = $state['page'];
        $limit = $state['limit'];
        $totalCount = $state['totalCount'];
        $hasNextPage = $state['hasNextPage'];

        ob_start();
        require __DIR__ . '/views/list.php';
        $html = ob_get_clean();

        write_response(200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => 'public, max-age=5, stale-while-revalidate=10',
        ], $html);
        break;

    case 'create_post':
        // Insert completed, redirect to board
        write_response(302, ['Location' => '/board'], '');
        break;

    default:
        write_response(500, ['Content-Type' => 'text/html; charset=utf-8'], '<h1>Internal Server Error</h1>');
        break;
}
