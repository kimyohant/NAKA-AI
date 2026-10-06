"""naka-live-agent — small control API that lets Naka Studio drive LiveTalking on the GPU box.

    NAKA_LIVE_TOKEN=... python naka_live_agent.py          (normally run by naka-live-agent.service)

Exposure (chosen by the owner: public port + token, see README.md):
  - this agent listens on AGENT_PORT (8020) and requires "Authorization: Bearer <NAKA_LIVE_TOKEN>"
    (24+ characters, constant-time compare) on every route except /ping
  - LiveTalking (8010) and the SRS API (1985) stay on 127.0.0.1; only SRS media (8000 tcp+udp) is public
Studio calls this agent to:
  - start/stop LiveTalking in rtcpush mode (session "0" pushes WHIP into the local SRS)
  - make the avatar speak a line (/human echo), interrupt it, ask whether it is speaking
  - relay the SRS stream to a live platform over RTMP (ffmpeg -c copy) and stop the relay
  - exchange the WHEP SDP for the browser preview
"""
import asyncio
import hmac
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, web

TOKEN = os.environ.get('NAKA_LIVE_TOKEN', '')
LT_DIR = Path(os.environ.get('LIVETALKING_DIR', '/opt/naka-live/LiveTalking'))
LT_PYTHON = os.environ.get('LIVETALKING_PYTHON', 'python')
LT_PORT = int(os.environ.get('LIVETALKING_PORT', '8010'))
AGENT_HOST = os.environ.get('AGENT_HOST', '0.0.0.0')
AGENT_PORT = int(os.environ.get('AGENT_PORT', '8020'))
SRS_API = os.environ.get('SRS_API', 'http://127.0.0.1:1985')
STREAM = os.environ.get('NAKA_STREAM', 'naka')
LOG_DIR = Path(os.environ.get('NAKA_LIVE_LOG_DIR', '/var/log/naka-live'))
MIN_FREE_VRAM_MB = int(os.environ.get('MIN_FREE_VRAM_MB', '5000'))

WHIP_URL = f'{SRS_API}/rtc/v1/whip/?app=live&stream={STREAM}'
WHEP_URL = f'{SRS_API}/rtc/v1/whep/?app=live&stream={STREAM}'
RTMP_LOCAL = f'rtmp://127.0.0.1:1935/live/{STREAM}'

SAFE_ID = re.compile(r'^[A-Za-z0-9_.-]{1,80}$')
VOICE = re.compile(r'^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$')
MODELS = {'wav2lip', 'musetalk', 'ultralight'}

state = {'lt': None, 'lt_started': 0.0, 'avatar': None, 'voice': None, 'model': None, 'push': None, 'push_started': 0.0}


def json_ok(data=None, status=200):
    return web.json_response({'ok': True, 'data': data}, status=status)


def json_err(msg, status=400):
    return web.json_response({'ok': False, 'error': msg}, status=status)


@web.middleware
async def auth(request, handler):
    if request.path == '/ping':
        return await handler(request)
    given = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
    if not TOKEN or not hmac.compare_digest(given.encode(), TOKEN.encode()):
        return json_err('unauthorized', 401)
    return await handler(request)


def alive(proc):
    return proc is not None and proc.poll() is None


def stop_proc(proc, timeout=10):
    if not alive(proc):
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(5)


def gpu():
    if not shutil.which('nvidia-smi'):
        return None
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.used,memory.total,utilization.gpu',
                              '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout
        name, used, total, util = [s.strip() for s in out.strip().splitlines()[0].split(',')]
        return {'name': name, 'used_mb': int(used), 'total_mb': int(total), 'free_mb': int(total) - int(used), 'util': int(util)}
    except Exception:
        return None


def avatars():
    root = LT_DIR / 'data' / 'avatars'
    return sorted(p.name for p in root.iterdir() if p.is_dir() and SAFE_ID.match(p.name)) if root.exists() else []


async def lt_call(path, body):
    async with ClientSession(timeout=ClientTimeout(total=15)) as s:
        async with s.post(f'http://127.0.0.1:{LT_PORT}{path}', json=body) as r:
            return await r.json(content_type=None)


async def ping(_):
    return json_ok({'agent': 'naka-live-agent'})


async def health(_):
    return json_ok({
        'livetalking': {'running': alive(state['lt']), 'since': state['lt_started'] or None,
                        'avatar': state['avatar'], 'voice': state['voice'], 'model': state['model']},
        'push': {'running': alive(state['push']), 'since': state['push_started'] or None},
        'gpu': gpu(),
        'avatars': avatars(),
        'models_ready': (LT_DIR / 'models' / 'wav2lip.pth').exists(),
    })


async def start(request):
    body = await request.json()
    avatar = str(body.get('avatar_id') or '')
    voice = str(body.get('voice') or 'th-TH-PremwadeeNeural')
    model = str(body.get('model') or 'wav2lip')
    if not SAFE_ID.match(avatar) or avatar not in avatars():
        return json_err(f'unknown avatar: {avatar}')
    if not VOICE.match(voice):
        return json_err(f'invalid voice: {voice}')
    if model not in MODELS:
        return json_err(f'invalid model: {model}')
    stop_proc(state['push'])
    stop_proc(state['lt'])
    g = gpu()
    if g and g['free_mb'] < MIN_FREE_VRAM_MB:
        return json_err(f"GPU has only {g['free_mb']} MB free (need {MIN_FREE_VRAM_MB}); unload the Unsloth models first", 409)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = open(LOG_DIR / 'livetalking.log', 'ab')
    cmd = [LT_PYTHON, 'app.py', '--transport', 'rtcpush', '--push_url', WHIP_URL, '--max_session', '1',
           '--model', model, '--avatar_id', avatar, '--tts', 'edgetts', '--REF_FILE', voice, '--listenport', str(LT_PORT)]
    state['lt'] = subprocess.Popen(cmd, cwd=LT_DIR, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    state.update(lt_started=time.time(), avatar=avatar, voice=voice, model=model)
    # model load + first WHIP push can take a while; ready once session "0" answers
    for _ in range(90):
        await asyncio.sleep(2)
        if not alive(state['lt']):
            return json_err('LiveTalking exited during start, see livetalking.log', 500)
        try:
            r = await lt_call('/is_speaking', {'sessionid': '0'})
            if r.get('code') == 0:
                return json_ok({'ready': True})
        except Exception:
            pass
    return json_ok({'ready': False})


async def stop(_):
    stop_proc(state['push'])
    stop_proc(state['lt'])
    state.update(lt=None, push=None, avatar=None)
    return json_ok()


async def say(request):
    body = await request.json()
    text = str(body.get('text') or '').strip()
    if not text or len(text) > 600:
        return json_err('text must be 1-600 characters')
    if not alive(state['lt']):
        return json_err('LiveTalking is not running', 409)
    payload = {'sessionid': '0', 'type': 'echo', 'text': text, 'interrupt': bool(body.get('interrupt'))}
    voice = body.get('voice')
    if voice:
        if not VOICE.match(str(voice)):
            return json_err('invalid voice')
        payload['tts'] = {'ref_file': voice}
    r = await lt_call('/human', payload)
    return json_ok(r) if r.get('code') == 0 else json_err(r.get('msg') or 'say failed', 502)


async def interrupt(_):
    if not alive(state['lt']):
        return json_ok()
    return json_ok(await lt_call('/interrupt_talk', {'sessionid': '0'}))


async def speaking(_):
    if not alive(state['lt']):
        return json_ok({'speaking': False})
    try:
        r = await lt_call('/is_speaking', {'sessionid': '0'})
        return json_ok({'speaking': bool(r.get('data'))})
    except Exception:
        return json_ok({'speaking': False})


async def push_start(request):
    body = await request.json()
    url = str(body.get('rtmp_url') or '')
    if not re.match(r'^rtmps?://\S+$', url):
        return json_err('rtmp_url must start with rtmp:// or rtmps://')
    if not alive(state['lt']):
        return json_err('start the avatar before going live', 409)
    stop_proc(state['push'])
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = open(LOG_DIR / 'push.log', 'ab')  # -loglevel warning: ffmpeg does not echo the URL (stream key) on success
    state['push'] = subprocess.Popen(['ffmpeg', '-nostdin', '-loglevel', 'warning', '-i', RTMP_LOCAL, '-c', 'copy', '-f', 'flv', url],
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    state['push_started'] = time.time()
    await asyncio.sleep(3)
    if alive(state['push']):
        return json_ok({'running': True})
    return json_err('relay exited, check the stream URL/key', 502)


async def push_stop(_):
    stop_proc(state['push'])
    state['push'] = None
    return json_ok()


async def whep(request):
    """Browser preview: Studio forwards the viewer's SDP offer here; SRS answers (play only)."""
    offer = await request.text()
    if not offer.startswith('v=0') or len(offer) > 20000:
        return json_err('expected an SDP offer')
    async with ClientSession(timeout=ClientTimeout(total=15)) as s:
        async with s.post(WHEP_URL, data=offer, headers={'Content-Type': 'application/sdp'}) as r:
            answer = await r.text()
            if r.status >= 300:
                return json_err(f'SRS WHEP {r.status}: {answer[:200]}', 502)
            return web.Response(text=answer, content_type='application/sdp', status=201)


def main():
    if len(TOKEN) < 24:
        raise SystemExit('NAKA_LIVE_TOKEN must be set (24+ characters)')
    app = web.Application(middlewares=[auth], client_max_size=1024 * 1024)
    app.add_routes([
        web.get('/ping', ping), web.get('/health', health),
        web.post('/start', start), web.post('/stop', stop),
        web.post('/say', say), web.post('/interrupt', interrupt), web.get('/speaking', speaking),
        web.post('/push/start', push_start), web.post('/push/stop', push_stop),
        web.post('/whep', whep),
    ])

    async def cleanup(_):
        stop_proc(state['push'])
        stop_proc(state['lt'])
    app.on_shutdown.append(cleanup)
    web.run_app(app, host=AGENT_HOST, port=AGENT_PORT, access_log=None)


if __name__ == '__main__':
    main()
