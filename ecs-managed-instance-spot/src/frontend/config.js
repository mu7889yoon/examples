/**
 * Frontend Configuration
 * 
 * このファイルはデプロイ時に環境に応じて設定を変更するために使用します。
 * CloudFrontからS3にデプロイする際、このファイルを環境に合わせて更新してください。
 */

// API Endpoint - ALBのDNS名またはカスタムドメインを設定
window.API_ENDPOINT = window.API_ENDPOINT || "http://localhost:8000";

// デバッグモード
window.DEBUG = window.DEBUG || false;

console.log("Frontend config loaded:", {
    API_ENDPOINT: window.API_ENDPOINT,
    DEBUG: window.DEBUG
});
