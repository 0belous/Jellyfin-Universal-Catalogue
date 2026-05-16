const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const REDIRECT_URL = 'https://github.com/0belous/Jellyfin-Universal-Catalogue';
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;

const ROOT_DIR = __dirname;
const PLUGINS_DIR = path.resolve(ROOT_DIR, './plugins');
const IMAGES_DIR = path.join(PLUGINS_DIR, 'images');
const KNOWN_AGENTS_FILE = path.join(PLUGINS_DIR, '.known_user_agents.json');

const updateInProgress = new Set();
const knownAgents = new Map();

function nowIso() {
	return new Date().toISOString();
}

function isJellyfinUserAgent(ua) {
	return /^jellyfin/i.test(ua);
}

function normalizeUserAgent(rawUserAgent) {
	const ua = String(rawUserAgent || '').trim();
	if (!ua) return null;

	const capture = ua.match(/^jellyfin(?:-server)?\/([^\s;]+)/i);
	const source = capture?.[1] || ua;
	const cleaned = source.replace(/[^a-zA-Z0-9._-]/g, '');
	return cleaned || null;
}

function getManifestFallback(userAgentId) {
	const safeAgent = userAgentId || 'unknown';
	const checksum = require('crypto').randomBytes(16).toString('hex');
	const timestamp = new Date().toISOString();
	const targetAbi = safeAgent && !safeAgent.endsWith('.0') ? `${safeAgent}.0` : safeAgent;

	return [
		{
			guid: crypto.randomUUID ? crypto.randomUUID() : hashString('upr-dummy-' + timestamp),
			name: 'Jellyfin Universal Catalogue',
			description: `Your user agent ${safeAgent} has not been seen yet, Please wait a moment and refresh the plugins page.`,
			overview: `Please wait for manifest: ${safeAgent}`,
			owner: 'Obelous',
			category: 'Miscellaneous',
			image: 'upr-loading.png',
			imageUrl: 'https://dl.obelous.dev/public/upr-loading.png',
			versions: [
				{
					version: '0.0.0',
					changelog: 'Placeholder',
					targetAbi: targetAbi || '',
					sourceUrl: 'https://github.com/0belous/Jellyfin-Universal-Catalogue',
					checksum: checksum,
					timestamp: timestamp
				}
			]
		}
	];
}

async function ensurePluginsDir() {
	await fs.mkdir(PLUGINS_DIR, { recursive: true });
}

async function loadKnownAgents() {
	await ensurePluginsDir();

	try {
		const raw = await fs.readFile(KNOWN_AGENTS_FILE, 'utf8');
		const parsed = JSON.parse(raw);
		for (const [agent, timestamp] of Object.entries(parsed || {})) {
			if (typeof agent !== 'string' || typeof timestamp !== 'string') continue;
			knownAgents.set(agent, timestamp);
		}
	} catch (error) {
		if (error.code !== 'ENOENT') {
			console.error('Failed to load known user agents:', error.message);
		}
	}

	try {
		const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name === 'images') continue;
			if (!knownAgents.has(entry.name)) {
				const fullPath = path.join(PLUGINS_DIR, entry.name);
				let seenAt = nowIso();
				try {
					const stat = await fs.stat(fullPath);
					seenAt = stat.mtime.toISOString();
				} catch {
				}
				knownAgents.set(entry.name, seenAt);
			}
		}
	} catch (error) {
		console.error('Failed to scan plugin directories:', error.message);
	}
}

async function saveKnownAgents() {
	const payload = {};
	for (const [agent, timestamp] of knownAgents.entries()) {
		payload[agent] = timestamp;
	}
	await fs.writeFile(KNOWN_AGENTS_FILE, JSON.stringify(payload, null, 2));
}

async function removeAgentData(agentId) {
	const agentDir = path.join(PLUGINS_DIR, agentId);
	try {
		await fs.rm(agentDir, { recursive: true, force: true });
	} catch (error) {
		console.error(`Failed to remove expired plugin directory for ${agentId}:`, error.message);
	}
}

async function pruneExpiredAgents() {
	const cutoff = Date.now() - ONE_MONTH_MS;
	let changed = false;

	for (const [agentId, seenAt] of knownAgents.entries()) {
		const seenTime = new Date(seenAt).getTime();
		if (!Number.isFinite(seenTime) || seenTime < cutoff) {
			knownAgents.delete(agentId);
			changed = true;
			await removeAgentData(agentId);
			console.log(`Pruned expired user agent: ${agentId}`);
		}
	}

	if (changed) {
		await saveKnownAgents();
	}
}

function markSeen(agentId) {
	knownAgents.set(agentId, nowIso());
}

async function runUpdateForAgent(agentId, regenImages = false) {
	if (updateInProgress.has(agentId)) {
		return;
	}

	updateInProgress.add(agentId);

	try {
		await ensurePluginsDir();
		try { await fs.mkdir(path.join(PLUGINS_DIR, agentId), { recursive: true }); } catch {}
	} catch (err) {
		console.error('Failed to ensure plugin/images directories before update:', err.message);
	}

	const args = [path.join(ROOT_DIR, 'update.js'), agentId, regenImages ? 'true' : 'false'];
	const proc = spawn(process.execPath, args, {
		cwd: ROOT_DIR,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	proc.stdout.on('data', (chunk) => {
		process.stdout.write(`[update:${agentId}] ${chunk}`);
	});

	proc.stderr.on('data', (chunk) => {
		process.stderr.write(`[update:${agentId}] ${chunk}`);
	});

	proc.on('close', async (code) => {
		updateInProgress.delete(agentId);
		console.log(`update.js finished for ${agentId} with code ${code}`);
		if (code === 0) {
			markSeen(agentId);
			try {
				await saveKnownAgents();
			} catch (error) {
				console.error('Failed to persist known user agents:', error.message);
			}
		}
	});
}

async function runHourlyUpdates() {
	await pruneExpiredAgents();
	for (const agentId of knownAgents.keys()) {
		runUpdateForAgent(agentId, false);
	}
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function sendJson(res, statusCode, payload) {
	const body = JSON.stringify(payload, null, 2);
	res.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Length': Buffer.byteLength(body)
	});
	res.end(body);
}

function sendRedirect(res, to) {
	res.writeHead(302, { Location: to });
	res.end();
}

async function serveFile(res, filePath) {
	try {
		const stat = await fs.stat(filePath);
		const ext = path.extname(filePath).toLowerCase();
		const mimeTypes = {
			'.json': 'application/json; charset=utf-8',
			'.svg': 'image/svg+xml; charset=utf-8',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.gif': 'image/gif',
			'.webp': 'image/webp',
			'.ico': 'image/x-icon'
		};
		const mime = mimeTypes[ext] || 'application/octet-stream';
		res.writeHead(200, {
			'Content-Type': mime,
			'Content-Length': stat.size,
			'Cache-Control': 'no-store'
		});
		const data = await fs.readFile(filePath);
		res.end(data);
	} catch {
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('Not found');
	}
}

async function servePluginAsset(res, reqPath) {
	const match = reqPath.match(/^\/([^/]+)\/(.+)$/);
	if (!match) {
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('Not found');
		return;
	}

	const agentId = match[1];
	const assetPath = match[2];
	const agentDir = path.resolve(PLUGINS_DIR, agentId);
	const absolute = path.resolve(agentDir, assetPath);

	if (!absolute.startsWith(agentDir + path.sep) && absolute !== agentDir) {
		res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('Bad request');
		return;
	}

	await serveFile(res, absolute);
}

async function handleManifestRequest(req, res, manifestName) {
	const ua = req.headers['user-agent'] || '';
	if (!isJellyfinUserAgent(ua)) {
		sendRedirect(res, REDIRECT_URL);
		return;
	}

	const agentId = normalizeUserAgent(ua);
	if (!agentId) {
		sendJson(res, 400, { error: 'Unable to parse Jellyfin user agent' });
		return;
	}

	markSeen(agentId);
	await saveKnownAgents();

	const manifestPath = path.join(PLUGINS_DIR, agentId, manifestName);
	if (await fileExists(manifestPath)) {
		await serveFile(res, manifestPath);
		return;
	}

	runUpdateForAgent(agentId, false);
	sendJson(res, 200, getManifestFallback(agentId));
}

async function start() {
	await loadKnownAgents();
	await pruneExpiredAgents();

	for (const agentId of knownAgents.keys()) {
		runUpdateForAgent(agentId, false);
	}

	setInterval(() => {
		runHourlyUpdates().catch((error) => {
			console.error('Hourly update cycle failed:', error.message);
		});
	}, HOURLY_MS);

	const server = http.createServer((req, res) => {
		const reqPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
		const routePath = reqPath.startsWith('/plugins/') ? reqPath.slice('/plugins'.length) : reqPath;

		if (req.method !== 'GET') {
			res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Method not allowed');
			return;
		}

		if (routePath === '/upr') {
			handleManifestRequest(req, res, 'manifest.json').catch((error) => {
				console.error('Failed to handle manifest.json:', error.message);
				sendJson(res, 500, { error: 'Internal server error' });
			});
			return;
		}

		if (/^\/[^/]+\/.+/.test(routePath)) {
			servePluginAsset(res, routePath).catch((error) => {
				console.error('Failed to serve plugin asset:', error.message);
				res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('Internal server error');
			});
			return;
		}

		sendRedirect(res, REDIRECT_URL);
	});

	server.listen(PORT, HOST, () => {
		console.log(`Universal catalogue server listening on http://${HOST}:${PORT}`);
		console.log(`Serving plugin manifests from ${PLUGINS_DIR}`);
	});
}

start().catch((error) => {
	console.error('Failed to start server:', error);
	process.exitCode = 1;
});
