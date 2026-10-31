// Disposable CI deployment only: no host ports, existing env file or user volumes.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.CI !== 'true') throw new Error('This disposable smoke check is CI-only.');
const project = `helious-smoke-${randomBytes(8).toString('hex')}`;
const folder = await mkdtemp(join(tmpdir(), project));
const file = join(folder, 'compose.json');
const compose = (...args) =>
  execFileSync('docker', ['compose', '-p', project, '-f', file, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
const check = (source) => compose('exec', '-T', 'helious', 'node', '-e', source);
await writeFile(
  file,
  JSON.stringify({
    services: {
      helious: {
        image: 'helious:ci',
        init: true,
        read_only: true,
        tmpfs: ['/tmp:size=32m,mode=1777'],
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        networks: ['isolated'],
        environment: {
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          PORT: '3000',
          PUBLIC_URL: 'http://localhost:3000',
          COOKIE_SECURE: 'false',
          MONGO_URI: 'mongodb://mongo:27017/helious?replicaSet=rs0',
          HELIOUS_MASTER_KEY: randomBytes(32).toString('hex'),
          RESEND_API_KEY: 're_synthetic_unused',
          EMAIL_FROM: 'Helious <noreply@example.invalid>',
        },
        depends_on: { mongo: { condition: 'service_healthy' } },
      },
      mongo: {
        image: 'mongo:7.0',
        command: ['mongod', '--replSet', 'rs0', '--bind_ip_all'],
        networks: ['isolated'],
        volumes: ['data:/data/db', 'config:/data/configdb'],
        healthcheck: {
          test: [
            'CMD',
            'mongosh',
            '--quiet',
            '--eval',
            'try { rs.status() } catch (e) { if (e.code === 94) rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]}); else throw e; } quit(db.hello().isWritablePrimary ? 0 : 1)',
          ],
          interval: '2s',
          timeout: '5s',
          retries: 40,
        },
      },
    },
    volumes: { data: {}, config: {} },
    networks: { isolated: { internal: true } },
  }),
);
try {
  compose('up', '-d', '--wait', '--wait-timeout', '150');
  check(`(async()=>{
    for(const path of ['/api/health','/app/','/docs/','/docs/operations','/app/licenses/THIRD-PARTY-NOTICES.txt','/docs/licenses/THIRD-PARTY-NOTICES.txt']) {
      const r=await fetch('http://127.0.0.1:3000'+path,{signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw Error(path+': '+r.status);
    }
    for(const path of ['/api/vaults','/api/auth/me']) {
      const r=await fetch('http://127.0.0.1:3000'+path);if(r.status!==401)throw Error('Unprotected '+path);
    }
    const fs=await import('node:fs');
    if(!fs.existsSync('apps/server/dist/THIRD-PARTY-NOTICES.txt'))throw Error('Missing server notices');
    if(process.getuid()===0)throw Error('Root runtime');
    try {fs.writeFileSync('/app/should-not-write','x');throw Error('Writable root');}catch(e){if(e.code!=='EROFS'&&e.code!=='EACCES')throw e;}
  })().catch(e=>{console.error(e.message);process.exit(1)})`);
  compose(
    'exec',
    '-T',
    'mongo',
    'mongosh',
    '--quiet',
    'helious',
    '--eval',
    'db.smoke_marker.insertOne({_id:"restart",value:"synthetic"})',
  );
  compose('restart', 'helious');
  // Compose restart does not wait for readiness; poll inside the isolated app.
  check(
    `(async()=>{for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3000/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Restart readiness timed out');})().catch(e=>{console.error(e.message);process.exit(1)})`,
  );
  compose(
    'exec',
    '-T',
    'mongo',
    'mongosh',
    '--quiet',
    'helious',
    '--eval',
    'if(db.smoke_marker.findOne({_id:"restart"})?.value!=="synthetic")quit(1)',
  );
  console.log(
    'Isolated self-hosting startup, built UI, auth denial, runtime restrictions and restart persistence passed.',
  );
} finally {
  // Only this run's randomly named project and temporary volumes are removed.
  try {
    compose('down', '-v', '--remove-orphans');
  } finally {
    await rm(folder, { recursive: true });
  }
}
