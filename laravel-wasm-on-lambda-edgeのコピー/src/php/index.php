<?php
require_once __DIR__ . '/router.php';

// Read request from bridge
$request = read_request();

// Execute routing
route(
    $request['method'],
    $request['uri'],
    $request['body'],
    $request['queryString']
);
