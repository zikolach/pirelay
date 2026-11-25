import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [, , root, requested] = process.argv;
const agent = join(root, 'agent');
const state = join(root, 'state');
const pi = join(root, 'node_modules/.bin/pi');
const outbox = join(state, 'outbox.jsonl');
const sessionId = randomUUID();
const sessionFile = join(root, 'session.jsonl');
const sessionKey = `${sessionId}:${sessionFile}`;
const prompt = `Incoming Telegram message ${randomUUID()}`;
const reply = `Offline provider reply ${randomUUID()}`;
const secret = randomUUID();
const timestamp = new Date().toISOString();
const json = (path, value) => writeFile(path, JSON.stringify(value) + '\n');
await Promise.all([mkdir(agent), mkdir(state)]);
const binding = {sessionKey, sessionId, sessionFile, sessionLabel:'Smoke', chatId:123, userId:456, boundAt:timestamp, lastSeenAt:timestamp};
await writeFile(sessionFile, [
  {type:'session', version:3, id:sessionId, timestamp, cwd:root},
  {type:'custom', id:'00000001', parentId:null, timestamp, customType:'relay-binding', data:{version:1, binding}},
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
await json(join(agent, 'settings.json'), {packages:[join(root, 'node_modules/@zylab/pirelay')]});
await json(join(state,'state.json'), {setup:{botId:1, botUsername:'offline_bot', botDisplayName:'Offline', validatedAt:timestamp}, pendingPairings:{}, bindings:{[sessionKey]:{...binding, status:'active'}}, channelBindings:{}});

let providerCalled = false;
const provider = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  if (req.url !== '/v1/chat/completions' || !data.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(prompt))) {
    res.writeHead(400).end('Expected relay prompt'); return;
  }
  providerCalled = true;
  res.writeHead(200, {'content-type':'text/event-stream'});
  for (const [delta, finish_reason] of [[{role:'assistant', content:reply}, null], [{}, 'stop']]) {
    res.write(`data: ${JSON.stringify({id:'offline', object:'chat.completion.chunk', created:1, model:'offline', choices:[{index:0, delta, finish_reason}]})}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
let child;
let log = '';
try {
  await json(join(agent, 'models.json'), {providers:{smoke:{baseUrl:`http://127.0.0.1:${provider.address().port}/v1`, api:'openai-completions', apiKey:'offline', models:[{id:'offline', name:'Offline'}]}}});
  const env = {HOME:root, PATH:process.env.PATH, PI_CODING_AGENT_DIR:agent, PI_OFFLINE:'1', PI_RELAY_COMMUNICATION_DIAGNOSTICS:'1', TELEGRAM_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456', PI_RELAY_STATE_DIR:state, TELEGRAM_TUNNEL_BROKER_SKIP_POLLING:'1', PI_RELAY_BROKER_TEST_INGRESS_SECRET:secret, PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH:outbox};
  const version = execFileSync(pi, ['--version'], {cwd:root,env,encoding:'utf8'}).trim();
  if (requested !== 'latest') assert.equal(version, requested);
  child = spawn(pi, ['--mode','rpc','--session',sessionFile,'--model','smoke/offline','--no-tools'], {cwd:root, env, stdio:'pipe'});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { log = (log + b).slice(-16000); });
  child.stdin.write('{"type":"get_commands","id":"ready"}\n');
  await until(() => log.includes('"id":"ready"') && log.includes('"name":"relay"'), 'packed relay command registration');
  const diagnostics = join(state, 'logs/communication.jsonl');
  await until(async () => {
    const entries = await readFile(diagnostics, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
    return entries.split('\n').slice(0, -1).some(line => {
      const event = JSON.parse(line);
      return event.event === 'route.reconcile' && event.outcome === 'ok' && event.details?.routeCount === 1 && event.details?.rejectedCount === 0;
    });
  }, 'bound route registration');
  const socketName = (await readdir(state)).find(n => n.endsWith('.sock'));
  assert.ok(socketName, 'PiRelay broker socket');
  const socket = connect(join(state,socketName));
  try {
    await once(socket, 'connect');
    socket.write(JSON.stringify({type:'request', requestId:'inbound', action:'testProcessInbound', testIngressSecret:secret, message:{updateId:1, messageId:1, text:prompt, chat:{id:123,type:'private'}, user:{id:456,username:'owner'}}}) + '\n');
    await until(async () => {
      const text = await readFile(outbox,'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
      return text.trim().split('\n').filter(Boolean).map(s => JSON.parse(s)).some(e => e.method === 'sendMessage' && e.chatId === 123 && e.text.includes(reply));
    }, 'provider reply delivered to bound Telegram chat');
    assert.ok(providerCalled);
    console.log(`Packed PiRelay: Telegram → Pi ${version} → loopback provider → Telegram passed`);
  } finally { socket.destroy(); }
} catch (error) {
  console.error(log, await readFile(outbox,'utf8').catch(() => 'No Telegram output'));
  console.error(await readFile(join(state, 'logs/communication.jsonl'), 'utf8').catch(() => 'No diagnostics'));
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child,'exit'); child.kill('SIGKILL'); await exit; }
  for (const file of await readdir(state)) if (file.endsWith('.pid')) {
    try {
      const pid = Number(await readFile(join(state,file),'utf8'));
      if (Number.isInteger(pid) && pid > 1) process.kill(pid);
    } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ESRCH') throw e; }
  }
  provider.closeAllConnections(); provider.close();
}

async function until(check, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    assert.equal(child.exitCode, null, 'Pi exited prematurely');
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
