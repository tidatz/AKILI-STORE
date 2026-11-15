import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadMime,uploadBinary} from '../public/uploads.js';

test('file contents identify PDFs on phones with empty or inaccurate MIME types',async()=>{
 for(const type of ['', 'application/octet-stream','application/x-pdf'])assert.equal(await uploadMime(new Blob(['\ufeff%PDF-1.7\n'],{type}),'pdf'),'application/pdf');
});
test('real image signatures identify PNG, JPEG and WebP independently of filename or MIME',async()=>{
 assert.equal(await uploadMime(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])]),'cover'),'image/png');
 assert.equal(await uploadMime(new Blob([new Uint8Array([255,216,255,224])]),'cover'),'image/jpeg');
 assert.equal(await uploadMime(new Blob(['RIFF1234WEBP']),'cover'),'image/webp');
});
test('unrelated and empty files are rejected accurately before upload',async()=>{
 await assert.rejects(()=>uploadMime(new Blob(['not a PDF'],{type:'application/pdf'}),'pdf'),/halijatambulika/);
 await assert.rejects(()=>uploadMime(new Blob([]),'pdf'),/MB 50/);
});
test('transient upload failures retry the same signed URL with progress and bounded attempts',async()=>{
 const previous=global.XMLHttpRequest,calls=[],progress=[];let attempt=0;
 global.XMLHttpRequest=class{
  upload={};open(method,url){this.method=method;this.url=url;}setRequestHeader(){}send(file){calls.push({url:this.url,file});this.upload.onprogress({lengthComputable:true,loaded:5,total:10});this.status=++attempt===1?503:200;this.onload();}
 };
 try{await uploadBinary('https://storage.test/signed',new Blob(['bytes']),'application/pdf',p=>progress.push(p));assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);assert.ok(progress.includes(50));}finally{global.XMLHttpRequest=previous;}
});
test('permanent storage rejections are not repeatedly retried',async()=>{
 const previous=global.XMLHttpRequest;let calls=0;
 global.XMLHttpRequest=class{upload={};open(){}setRequestHeader(){}send(){calls++;this.status=413;this.onload();}};
 try{await assert.rejects(()=>uploadBinary('https://storage.test/signed',new Blob(['bytes']),'application/pdf'),/ukubwa/);assert.equal(calls,1);}finally{global.XMLHttpRequest=previous;}
});
