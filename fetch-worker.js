const { parentPort } = require('worker_threads');

parentPort.on('message', async (message) => {
	const { id, url, userAgent } = message;
	
	try {
		const response = await fetch(url, { 
			headers: { 'User-Agent': 'Jellyfin-Server/' + userAgent } 
		});
		
		if (!response.ok) {
			throw new Error(`Status: ${response.status}`);
		}
		
		const json = await response.json();
		parentPort.postMessage({ id, success: true, data: json, url });
	} catch (error) {
		parentPort.postMessage({ 
			id, 
			success: false, 
			error: error.message,
			url
		});
	}
});
