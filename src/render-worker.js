import { parentPort, workerData } from 'node:worker_threads';
import { renderTrack } from './project.js';

try {
  let lastProgress = 0;
  const result = await renderTrack(workerData.directory, workerData.trackId, {
    stems: Boolean(workerData.stems),
    progress: value => {
      const progress = typeof value === 'number' ? value : value?.fraction ?? value?.progress ?? 0;
      if (progress >= 1 || Date.now() - lastProgress > 100) {
        lastProgress = Date.now(); parentPort.postMessage({ type: 'progress', progress });
      }
    },
  });
  parentPort.postMessage({ type: 'done', result: { revision: result.revision, duration: result.duration, stemsDir: result.stemsDir } });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message });
}
