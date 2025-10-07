const WORKER_COUNT = 6;
const workers = [];
const idleWorkers = [];
const taskQueue = [];

class WasmWorker {
	constructor(id) {
		this.id = id;
		this.worker = new Worker("offscreen-worker.js");
		this.busy = false;

		this.worker.onmessage = (e) => {
			this.busy = false;
			this._resolve(e.data);
			
			idleWorkers.push(this);

			dispatchQueuedTask();
		};
	}

	run(data) {
		this.busy = true;
		return new Promise((resolve) => {
			this._resolve = resolve;
			this.worker.postMessage(data);
		})
	}
}

/**
 * Sets workers to run the new bundle format verification function in parallel,
 * since WebAssembly itself computes sequentially
 */
function initWorkerPool() {
	for (let i = 0; i < WORKER_COUNT; i++) {
		const w = new WasmWorker(i);
		workers.push(w);
		idleWorkers.push(w);
	}
}

/**
 * Distributes new tasks to idle workers or stores them in a queue if all workers are busy
 * @param {object} data Data that the worker will evaluate. (In our case the combination of script, bundle, email and issuer)
 * @returns A promise to return the result of the evaluation 
 */
function runTaskInPool(data) {
	return new Promise((resolve) => {
		const available = idleWorkers.shift();
		if (available) {
			available.run(data).then(resolve);
		} else {
			taskQueue.push({ data, resolve });
		}
	});

}

/**
 * Distributes an open task to idle workers. 
 * @returns undefined
 */
function dispatchQueuedTask() {
	if (taskQueue.length === 0 || idleWorkers.length === 0) return;

	const { data, resolve } = taskQueue.shift();
	const worker = idleWorkers.shift();

	worker.run(data).then(resolve);
}