import { handleAuthRedirect, isLoggedIn, login, logout } from "./auth.js";
import { listCurrentLocations, subscribeOnLocationUpdate } from "./graphql.js";

const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [139.767125, 35.681236],
  zoom: 11,
});

const markers = new Map();
let subscription = null;
let pollTimer = null;

function updateStatus(message) {
  statusEl.textContent = message;
}

function setMarker(location) {
  const lngLat = [location.lng, location.lat];
  const popupHtml = `
    <strong>${location.deviceId}</strong><br />
    capturedAt: ${location.capturedAt}<br />
    speed: ${location.speed ?? "-"}<br />
    heading: ${location.heading ?? "-"}<br />
    accuracy: ${location.accuracy ?? "-"}
  `;

  if (markers.has(location.deviceId)) {
    const marker = markers.get(location.deviceId);
    marker.setLngLat(lngLat);
    marker.getPopup().setHTML(popupHtml);
    return;
  }

  const el = document.createElement("div");
  el.className = "marker";

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat(lngLat)
    .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(popupHtml))
    .addTo(map);

  markers.set(location.deviceId, marker);
}

async function refreshCurrentLocations() {
  const locations = await listCurrentLocations(500);
  locations.forEach((location) => setMarker(location));
  if (locations.length > 0) {
    const newest = locations.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    updateStatus(`Last update: ${newest.updatedAt} / devices: ${locations.length}`);
  } else {
    updateStatus("No location records yet.");
  }
}

async function start() {
  handleAuthRedirect();

  loginBtn.addEventListener("click", login);
  logoutBtn.addEventListener("click", () => {
    if (subscription) {
      subscription.close();
      subscription = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    logout();
  });

  if (!isLoggedIn()) {
    updateStatus("Please login to start viewing locations.");
    return;
  }

  await refreshCurrentLocations();

  subscription = subscribeOnLocationUpdate({
    onConnected: () => {
      updateStatus("Connected to AppSync realtime subscription.");
    },
    onData: (location) => {
      setMarker(location);
      updateStatus(`Realtime update: ${location.deviceId} @ ${location.updatedAt}`);
    },
    onError: (error) => {
      updateStatus(`Realtime unavailable (${error.message}). Falling back to 5s polling.`);
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          refreshCurrentLocations().catch((pollError) => {
            updateStatus(`Polling error: ${pollError.message}`);
          });
        }, 5000);
      }
    },
  });
}

start().catch((error) => {
  updateStatus(`Initialization error: ${error.message}`);
});
