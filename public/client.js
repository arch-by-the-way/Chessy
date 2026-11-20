const URL_WS = 'wss://your.site/ws';
const KEY = 'session';
const TTL = 60_000;

const loadToken = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Date.now() - s.seen < TTL) return s.token;
  } catch {}
  localStorage.removeItem(KEY);
  return null;
};
const saveToken = (token) =>
  localStorage.setItem(KEY, JSON.stringify({ token, seen: Date.now() }));

let ws, retry = 0, token = null;
const send = (o) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));

function connect() {
  ws = new WebSocket(URL_WS);

  ws.onopen = () => {
    retry = 0;
    const t = loadToken();
    t ? send({ type: 'resume', token: t }) : showRegisterForm();
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'registered') { token = msg.token; saveToken(token); showGame(msg.nick); }
    if (msg.type === 'error' && msg.reason === 'bad_token') {
      localStorage.removeItem(KEY); token = null; showRegisterForm();
    }
  };

  ws.onclose = () => {                       // autoretry with backoff
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000));
  };
}

// updating timestamps every 5 seconds
setInterval(() => {
  if (token && ws?.readyState === WebSocket.OPEN) saveToken(token);
}, 5_000);

connect();