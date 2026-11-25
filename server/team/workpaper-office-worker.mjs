import {parentPort,workerData} from 'node:worker_threads';
import {analyzeOfficeTask} from './workpaper-office-analysis.mjs';
try{const form=await analyzeOfficeTask(workerData);if(Buffer.byteLength(JSON.stringify(form))>32*1024*1024)throw Error('Form exceeds 32MiB');parentPort.postMessage({form});}catch{parentPort.postMessage({error:true});}