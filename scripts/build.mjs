import {mkdir,copyFile} from 'node:fs/promises';

// Serve the pinned PDF reader from the store's own domain on every deployment.
const target=new URL('../public/vendor/pdfjs/',import.meta.url);
await mkdir(target,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.min.mjs']){
 await copyFile(new URL('../node_modules/pdfjs-dist/build/'+file,import.meta.url),new URL(file,target));
}
console.log('PDF reader assets prepared.');
