import { CONFIG } from "./config.js";

const TOKEN_KEY = "geo_stream_id_token";

function parseHashParams() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.substring(1)
    : "";
  return new URLSearchParams(hash);
}

export function handleAuthRedirect() {
  const params = parseHashParams();
  const idToken = params.get("id_token");

  if (idToken) {
    localStorage.setItem(TOKEN_KEY, idToken);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }
}

export function getIdToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function isLoggedIn() {
  return Boolean(getIdToken());
}

export function login() {
  const url = new URL(`${CONFIG.cognitoDomain}/login`);
  url.searchParams.set("client_id", CONFIG.userPoolClientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", CONFIG.redirectUri);
  window.location.href = url.toString();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  const url = new URL(`${CONFIG.cognitoDomain}/logout`);
  url.searchParams.set("client_id", CONFIG.userPoolClientId);
  url.searchParams.set("logout_uri", CONFIG.redirectUri);
  window.location.href = url.toString();
}
