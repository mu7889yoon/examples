#!/usr/bin/env bash
set -euxo pipefail

LOG_FILE="/var/log/benchmark-bootstrap.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "Updating AL2023 packages"
dnf -y update

echo "Installing desktop/X11/VNC dependencies"
dnf -y install \
  xorg-x11-server-Xorg \
  xorg-x11-xauth \
  xorg-x11-apps \
  xorg-x11-server-Xwayland \
  xterm \
  tigervnc-server \
  python3 \
  xclock \
  openssh-clients

echo "Installing Wayland/waypipe dependencies"
WAYPIPE_PACKAGES=(
  waypipe
  weston
)
for pkg in "${WAYPIPE_PACKAGES[@]}"; do
  if ! dnf -y install "${pkg}"; then
    echo "WARN: failed to install ${pkg}. waypipe benchmark may require manual setup." >>/var/log/waypipe-install-warning.log
  fi
done

if [[ ! -f /etc/yum.repos.d/nice-dcv.repo ]]; then
  cat >/etc/yum.repos.d/nice-dcv.repo <<'REPO'
[nice-dcv]
name=NICE DCV
baseurl=https://d1uj6qtbmh3dt5.cloudfront.net/rpm/el9/x86_64/
enabled=1
gpgcheck=0
REPO
fi

if dnf -y install nice-dcv-server; then
  systemctl enable --now dcvserver
else
  echo "WARN: nice-dcv-server install failed. Confirm repo URL for AL2023." >/var/log/dcv-install-warning.log
fi

mkdir -p /home/ec2-user/.vnc
chown -R ec2-user:ec2-user /home/ec2-user/.vnc
su - ec2-user -c "printf 'benchmark\nbenchmark\nn\n' | vncpasswd" || true

cat >/etc/systemd/system/vncserver@:1.service <<'SERVICE'
[Unit]
Description=TigerVNC Server (:1)
After=network.target

[Service]
Type=forking
User=ec2-user
Group=ec2-user
WorkingDirectory=/home/ec2-user
PAMName=login
PIDFile=/home/ec2-user/.vnc/%H:1.pid
ExecStartPre=-/usr/bin/vncserver -kill :1 > /dev/null 2>&1
ExecStart=/usr/bin/vncserver :1 -geometry 1920x1080 -depth 24
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure

[Install]
WantedBy=multi-user.target
SERVICE

cat >/opt/latency-overlay.py <<'PY'
#!/usr/bin/env python3
import time
import tkinter as tk

counter = 0
root = tk.Tk()
root.title('Latency Overlay')
root.geometry('1280x720')
root.configure(bg='black')

label = tk.Label(
    root,
    text='',
    font=('Courier', 44),
    fg='lime',
    bg='black',
)
label.pack(expand=True)


def tick() -> None:
    global counter
    counter += 1
    label.configure(text=f"SERVER_EPOCH_MS={int(time.time() * 1000)} FRAME={counter}")
    root.after(16, tick)


tick()
root.mainloop()
PY
chmod +x /opt/latency-overlay.py

cat >/opt/latency-ticker.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

frame=0
while true; do
  frame=$((frame + 1))
  epoch_ms="$(date +%s%3N)"
  printf '\033[2J\033[H'
  printf 'SERVER_EPOCH_MS=%s FRAME=%d\n' "${epoch_ms}" "${frame}"
  sleep 0.016
done
SCRIPT
chmod +x /opt/latency-ticker.sh

cat >/opt/run-waypipe-latency.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

if ! command -v waypipe >/dev/null 2>&1; then
  echo "waypipe is not installed on server." >&2
  exit 1
fi

if ! command -v weston >/dev/null 2>&1; then
  echo "weston is not installed on server." >&2
  exit 1
fi

if ! command -v weston-terminal >/dev/null 2>&1; then
  echo "weston-terminal is not installed on server." >&2
  exit 1
fi

export XDG_RUNTIME_DIR="/tmp/waypipe-${USER}-runtime"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"
export WAYLAND_DISPLAY="wayland-1"

if ! pgrep -x weston >/dev/null 2>&1; then
  weston \
    --backend=headless-backend.so \
    --socket="${WAYLAND_DISPLAY}" \
    --idle-time=0 \
    >/tmp/weston-waypipe.log 2>&1 &
  sleep 2
fi

exec weston-terminal --shell=/opt/latency-ticker.sh
SCRIPT
chmod +x /opt/run-waypipe-latency.sh

cat >/etc/systemd/system/latency-overlay.service <<'SERVICE'
[Unit]
Description=Latency Overlay for visual benchmark
After=network.target vncserver@:1.service

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/home/ec2-user
Environment=DISPLAY=:1
ExecStart=/usr/bin/python3 /opt/latency-overlay.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now vncserver@:1.service
systemctl enable --now latency-overlay.service

echo "Bootstrap completed on AL2023"
