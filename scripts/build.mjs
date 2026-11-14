import {mkdir,copyFile} from 'node:fs/promises';
import sharp from 'sharp';

// Serve the pinned PDF reader from the store's own domain on every deployment.
const target=new URL('../public/vendor/pdfjs/',import.meta.url);
await mkdir(target,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.min.mjs']){
 await copyFile(new URL('../node_modules/pdfjs-dist/build/'+file,import.meta.url),new URL(file,target));
}
console.log('PDF reader assets prepared.');

// One transparent brand asset supplies all browser and device icons.
const logo=new URL('../public/assets/akili-store-logo.webp',import.meta.url);
await sharp(logo.pathname).png().toFile(new URL('../public/assets/akili-store-logo.png',import.meta.url).pathname);
for(const [file,size] of [['favicon.png',64],['apple-touch-icon.png',180],['assets/akili-store-icon-192.png',192],['assets/akili-store-icon-512.png',512]]){
 await sharp(logo.pathname).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(new URL('../public/'+file,import.meta.url).pathname);
}
console.log('AKILI STORE brand icons prepared.');
