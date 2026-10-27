import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
async function files(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`, `${prefix}${e.name}/`) : `${prefix}${e.name}`))).flat()
}
const assets = (await files('dist')).filter(x => x !== 'sw.js').sort()
const hash = createHash('sha256')
for (const name of assets) hash.update(await readFile(`dist/${name}`))
const cacheName = `lookahan-${hash.digest('hex').slice(0, 16)}`
const source = `const NAME=${JSON.stringify(cacheName)};
const ASSETS=${JSON.stringify(assets.map(x => '/' + x))};
self.addEventListener('install',event=>{event.waitUntil(caches.open(NAME).then(cache=>cache.addAll(ASSETS)))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lookahan-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));return}
 if(ASSETS.includes(url.pathname))event.respondWith(caches.match(url.pathname).then(hit=>hit||fetch(req)));
});
`
await writeFile('dist/sw.js', source)
console.log(`Offline shell: ${assets.length} assets, ${cacheName}`)
