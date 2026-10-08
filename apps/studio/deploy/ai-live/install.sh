#!/usr/bin/env bash
# Install Naka AI Live on the GPU box (Ubuntu 22.04/24.04 + NVIDIA driver), run as root:
#   sudo bash install.sh [PUBLIC_IP]
# Installs: Miniconda env "livetalking" (Python 3.12, torch cu128) + LiveTalking, SRS 5 (docker,
# host network), naka-live-agent (systemd). Safe to re-run: existing pieces are kept/updated.
# The model weights and avatars are NOT downloadable by script (Quark / Google Drive only): see README.md.
set -euo pipefail

ROOT=/opt/naka-live
LT_REPO=${LT_REPO:-https://github.com/hfhfn/LiveTalking}
CONDA=$ROOT/conda
ENV_PY=$CONDA/envs/livetalking/bin/python
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash install.sh"; exit 1; }
command -v nvidia-smi >/dev/null || { echo "nvidia-smi not found: install the NVIDIA driver first"; exit 1; }
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

say "system packages (git, ffmpeg, docker)"
apt-get update -y
apt-get install -y git ffmpeg curl ca-certificates
command -v docker >/dev/null || apt-get install -y docker.io
systemctl enable --now docker

say "Miniconda + env livetalking (Python 3.12)"
mkdir -p $ROOT
if [ ! -x $CONDA/bin/conda ]; then
  curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/miniconda.sh
  bash /tmp/miniconda.sh -b -p $CONDA
fi
[ -x "$ENV_PY" ] || $CONDA/bin/conda create -y -n livetalking python=3.12

say "LiveTalking source"
if [ -d $ROOT/LiveTalking/.git ]; then git -C $ROOT/LiveTalking pull --ff-only; else git clone --depth 1 "$LT_REPO" $ROOT/LiveTalking; fi

say "PyTorch 2.9.1 (CUDA 12.8) + LiveTalking requirements (this takes a while)"
"$ENV_PY" -m pip install --upgrade pip
"$ENV_PY" -m pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128
"$ENV_PY" -m pip install -r $ROOT/LiveTalking/requirements.txt
"$ENV_PY" -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"

say "face detector for building avatars (s3fd, public download)"
S3FD=$ROOT/LiveTalking/avatars/wav2lip/face_detection/detection/sfd/s3fd.pth
[ -f "$S3FD" ] || curl -fL --retry 3 -o "$S3FD" https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth \
  || echo "WARN: s3fd.pth download failed; genavatar will try again on first use"

say "naka-live-agent"
install -m 0644 "$HERE/naka_live_agent.py" $ROOT/naka_live_agent.py
mkdir -p /etc/naka-live /var/log/naka-live
chmod 700 /etc/naka-live
NEW_TOKEN=""
if [ ! -f /etc/naka-live/agent.env ]; then
  NEW_TOKEN=$(openssl rand -hex 24)
  cat > /etc/naka-live/agent.env <<EOF
NAKA_LIVE_TOKEN=$NEW_TOKEN
LIVETALKING_DIR=$ROOT/LiveTalking
LIVETALKING_PYTHON=$ENV_PY
AGENT_PORT=8020
MIN_FREE_VRAM_MB=5000
EOF
  chmod 600 /etc/naka-live/agent.env
fi
install -m 0644 "$HERE/naka-live-agent.service" /etc/systemd/system/naka-live-agent.service
systemctl daemon-reload
systemctl enable --now naka-live-agent
systemctl restart naka-live-agent

say "SRS 5 (docker, host network)"
PUBLIC_IP=${1:-$(curl -fsS --max-time 5 https://ifconfig.me || true)}
[ -n "$PUBLIC_IP" ] || { echo "could not detect the public IP; re-run: sudo bash install.sh <PUBLIC_IP>"; exit 1; }
install -m 0644 "$HERE/srs.conf" $ROOT/srs.conf
docker rm -f naka-srs >/dev/null 2>&1 || true
docker run -d --name naka-srs --restart unless-stopped --network host \
  -e CANDIDATE="$PUBLIC_IP" -v $ROOT/srs.conf:/usr/local/srs/conf/naka.conf \
  ossrs/srs:5 ./objs/srs -c conf/naka.conf

if command -v ufw >/dev/null && ufw status | grep -q active; then
  say "firewall (ufw): agent 8020/tcp, WebRTC media 8000/tcp+udp"
  ufw allow 8020/tcp; ufw allow 8000/tcp; ufw allow 8000/udp
fi

say "checks"
LT=$ROOT/LiveTalking
[ -f $LT/models/wav2lip.pth ] && echo "OK  models/wav2lip.pth" || echo "MISSING  $LT/models/wav2lip.pth  (download wav2lip256.pth, rename to wav2lip.pth)"
ls -d $LT/data/avatars/*/ >/dev/null 2>&1 && ls -d $LT/data/avatars/*/ || echo "MISSING  an avatar folder in $LT/data/avatars/ (e.g. wav2lip256_avatar1)"
sleep 2
curl -fsS http://127.0.0.1:8020/ping && echo
docker ps --filter name=naka-srs --format '{{.Names}} {{.Status}}'

echo
echo "Public IP for Naka Studio: $PUBLIC_IP   (forward 8020/tcp and 8000/tcp+udp on the router to this box)"
if [ -n "$NEW_TOKEN" ]; then
  echo "Agent token (shown once, paste it into Naka Studio → AI Live → settings): $NEW_TOKEN"
else
  echo "Agent token unchanged: see NAKA_LIVE_TOKEN in /etc/naka-live/agent.env"
fi
