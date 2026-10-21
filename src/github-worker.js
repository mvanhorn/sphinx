import { runStampWorker } from './github.js';

// Detached from Git's hook so pushes never wait on GitHub.
await runStampWorker(process.argv[2]);
