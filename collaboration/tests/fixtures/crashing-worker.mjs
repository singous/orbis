import { parentPort } from 'node:worker_threads';
parentPort.on('message', () => { throw new Error('Synthetic transform worker failure'); });
