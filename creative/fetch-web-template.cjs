// Download only the web template from the official 1.3 GB ZIP using HTTP ranges.
const fs = require('node:fs');
const zlib = require('node:zlib');
const url = 'https://github.com/godotengine/godot-builds/releases/download/4.5-stable/Godot_v4.5-stable_export_templates.tpz';
async function range(start,end) {
  const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`}});
  if(r.status!==206)throw Error(`Range request returned ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
(async()=>{
 const tail=await range(1356853963-65536,1356853962);
 const e=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 const dir=await range(tail.readUInt32LE(e+16),tail.readUInt32LE(e+16)+tail.readUInt32LE(e+12)-1);
 for(let p=0;p<dir.length;) {
  const n=dir.readUInt16LE(p+28),extra=dir.readUInt16LE(p+30),comment=dir.readUInt16LE(p+32);
  const name=dir.subarray(p+46,p+46+n).toString();
  if(name.endsWith('/web_nothreads_release.zip')) {
   const start=dir.readUInt32LE(p+42),size=dir.readUInt32LE(p+20),method=dir.readUInt16LE(p+10);
   const head=await range(start,start+29); const dataStart=start+30+head.readUInt16LE(26)+head.readUInt16LE(28);
   console.log(`Downloading ${name}: ${size} bytes`);
   const data=await range(dataStart,dataStart+size-1);
   fs.mkdirSync('.tools/web-template',{recursive:true});
   fs.writeFileSync('.tools/web-template/web_nothreads_release.zip',method===8?zlib.inflateRawSync(data):data);
   console.log('Web template ready'); return;
  }
  p+=46+n+extra+comment;
 }
 throw Error('web_nothreads_release.zip missing');
})().catch(e=>{console.error(e);process.exitCode=1});
