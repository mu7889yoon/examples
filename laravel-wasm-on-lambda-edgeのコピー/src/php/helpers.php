<?php
// Bridge file paths
define('BRIDGE_DIR', '/tmp/bridge');
define('REQUEST_FILE', BRIDGE_DIR . '/request.json');
define('RESPONSE_FILE', BRIDGE_DIR . '/response.json');
define('DB_OPERATION_FILE', BRIDGE_DIR . '/db_operation.json');
define('DB_RESULT_FILE', BRIDGE_DIR . '/db_result.json');
define('STATE_FILE', BRIDGE_DIR . '/state.json');

/**
 * Read the HTTP request from the bridge
 */
function read_request(): array {
    $json = file_get_contents(REQUEST_FILE);
    return json_decode($json, true);
}

/**
 * Write the HTTP response to the bridge
 */
function write_response(int $statusCode, array $headers, string $body): void {
    $response = json_encode([
        'statusCode' => $statusCode,
        'headers' => $headers,
        'body' => $body,
    ]);
    file_put_contents(RESPONSE_FILE, $response);
}

/**
 * Request a DB operation and save state for resume
 * PHP execution will end after this call.
 * resume.php will be called after Node.js executes the DB query.
 */
function request_db_operation(string $action, string $sql, array $params, array $state): void {
    // Write DB operation request
    $operation = json_encode([
        'action' => $action,
        'sql' => $sql,
        'params' => $params,
    ]);
    file_put_contents(DB_OPERATION_FILE, $operation);

    // Save state for resume.php
    file_put_contents(STATE_FILE, json_encode($state));
}

/**
 * Read DB result (called from resume.php after Node.js executes the query)
 */
function read_db_result(): array {
    $json = file_get_contents(DB_RESULT_FILE);
    if ($json === false) {
        return ['rows' => [], 'rowCount' => 0, 'error' => 'Failed to read DB result'];
    }
    return json_decode($json, true);
}

/**
 * Read saved state (called from resume.php)
 */
function read_state(): array {
    $json = file_get_contents(STATE_FILE);
    return json_decode($json, true);
}

/**
 * Escape HTML to prevent XSS
 */
function h(string $str): string {
    return htmlspecialchars($str, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}
