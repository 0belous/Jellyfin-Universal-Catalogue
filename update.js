const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
let userAgent = "Jellyfin-Server/10.11.4"; // Required for some repositories

const imagesDir = path.join(__dirname, 'images');
const imageBaseUrl = 'https://raw.githubusercontent.com/0belous/universal-plugin-repo/refs/heads/main/images/';

async function getLatestJellyfinVersion() {
    const response = await fetch('https://api.github.com/repos/jellyfin/jellyfin/releases/latest', {
        headers: { 'User-Agent': 'Node-Fetch' }
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    return data.tag_name.replace('v', '');
}

async function getSources(sourceFile){
    let sources = [];
    try {
        const fileContent = await fs.readFile(sourceFile, 'utf8');
        sources = fileContent.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
    } catch (err) {
        console.error(`Error reading ${sourceFile}:`, err.message);
        return [];
    }

    let pluginMap = new Map();

    for (const url of sources) {
        try {
            console.log(`Fetching ${url}...`);
            const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const json = await response.json();
            for (const plugin of json) {
                const guid = plugin.guid || plugin.Guid;
                if (!guid) continue;
                if (pluginMap.has(guid)) {
                    console.log(`    -> Merging duplicate: ${plugin.name}`);
                    const existing = pluginMap.get(guid);
                    const combinedVersions = [...existing.versions, ...plugin.versions];
                    existing.versions = Array.from(new Map(combinedVersions.map(v => [v.version, v])).values());
                } else {
                    plugin._metaSourceUrl = url;
                    pluginMap.set(guid, plugin);
                }
            }
        } catch (error) {
            console.error(`Error processing ${url}: ${error.message}`);
        }
    }
    return Array.from(pluginMap.values());
}

async function clearImagesFolder() {
    try {
        await fs.rm(imagesDir, { recursive: true, force: true });
        await fs.mkdir(imagesDir, { recursive: true });
    } catch (err) {
        console.error('Error clearing images folder:', err);
    }
}

async function downloadImage(url, filename) {
    console.log(`Downloading image: ${url} as ${filename}`);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const buffer = await res.arrayBuffer();
        await fs.writeFile(path.join(imagesDir, filename), Buffer.from(buffer));
        return true;
    } catch (err) {
        console.error(`Error downloading image ${url}:`, err.message);
        return false;
    }
}

function getImageExtension(url) {
    const ext = path.extname(new URL(url).pathname);
    return ext || '.png';
}

function getPluginId(plugin) {
    return plugin.id || plugin.Id || plugin.pluginId || plugin.name || null;
}

function hashString(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

function createDummyPlugin() {
    const timestamp = new Date().toISOString();
    const targetAbi = '10.11.0.0';
    const checksum = crypto.randomBytes(16).toString('hex');

    return {
        guid: crypto.randomUUID ? crypto.randomUUID() : hashString('upr-dummy-' + timestamp),
        name: '! Deprecation Warning',
        description: `You have stopped receiving updates. See here for more details: https://github.com/0belous/Jellyfin-Universal-Catalogue/blob/main/deprecation.md`,
        overview: `Deprecation Warning`,
        owner: 'Obelous',
        category: 'Miscellaneous',
        image: 'upr-main.png',
        imageUrl: 'https://dl.obelous.dev/public/upr-main.png',
        _metaSourceUrl: 'internal',
        versions: [
            {
                version: '0.0.0',
                changelog: 'Placeholder',
                targetAbi: targetAbi,
                sourceUrl: 'https://github.com/0belous/Jellyfin-Universal-Catalogue',
                checksum: checksum,
                timestamp: timestamp
            }
        ]
    };
}

function findGithubUrl(obj) {
    if (!obj) return null;
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            const match = obj[key].match(/https?:\/\/github\.com\/[^\/]+\/[^\/]+/);
            if (match) {
                return match[0];
            }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            const url = findGithubUrl(obj[key]);
            if (url) return url;
        }
    }
    return null;
}

function sanitizePlugins(plugins) {
    return plugins.map(plugin => {
        const guid = (plugin.guid || plugin.Guid || "").toLowerCase();
        
        if (plugin.versions) {
            plugin.versions.forEach(v => {
                if (v.dependencies) {
                    v.dependencies = v.dependencies.filter(depId => depId.toLowerCase() !== guid);
                }
                if (!v.targetAbi || v.targetAbi.trim() === "") {
                    v.targetAbi = "10.11.0.0"; 
                }
            });
            plugin.versions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
        const descProp = ['description', 'Description', 'overview'].find(p => plugin[p]);
        if (descProp) {
            plugin[descProp] = plugin[descProp]
                .replace(/@\[renovate\[bot\]\].*$/gs, "")
                .replace(/\n\s*\n/g, '\n')
                .trim();
        }
        const { guid: g, name, ...rest } = plugin;
        return { guid: g, name, ...rest };
    });
}

async function processDescriptions(pluginData) {
    try {
        const genTime = new Date().toISOString().substring(11, 16) + ' UTC';
        for (const plugin of pluginData) {
            const repoUrl = findGithubUrl(plugin);
            const sourceUrl = plugin._metaSourceUrl || 'Unknown';
            let appendText = `  \n  \nUniversal Repo:  \nGenerated: ${genTime}  \nSource: ${sourceUrl}`;
            delete plugin._metaSourceUrl;
            if (repoUrl) {
                appendText += `  \nGithub: ${repoUrl}`;
            }

            const descriptionProp = ['description', 'Description', 'overview'].find(p => plugin[p]);

            if (descriptionProp) {
                if (!plugin[descriptionProp].includes("Universal Repo:")) {
                    plugin[descriptionProp] += appendText;
                }
            } else {
                plugin.description = appendText.trim();
            }
        }
    console.log(`Sucessfully injected source URLs`);
    } catch (err) {
        console.error('Error processing descriptions:', err);
    }
}

async function processImages(pluginData) {
    for (const plugin of pluginData) {
        if (plugin.imageUrl) {
            const ext = getImageExtension(plugin.imageUrl);
            let pluginId = getPluginId(plugin);
            if (!pluginId) {
                pluginId = hashString(plugin.imageUrl);
            }
            const filename = `${pluginId}${ext}`;
            const success = await downloadImage(plugin.imageUrl, filename);
            if (success) {
                plugin.imageUrl = imageBaseUrl + filename;
                console.log(`    -> Updated manifest imageUrl for plugin ${pluginId}`);
            }
        }
    }
}

async function writeManifest(dataToWrite, outputFile){
    if (!dataToWrite || dataToWrite.length === 0) {
        console.log(`No data to write to manifest ${outputFile}. Aborting.`);
        return;
    }
    try {
        const manifestJson = JSON.stringify(dataToWrite, null, 2);
        await fs.writeFile(outputFile, manifestJson);
    } catch (err) {
        console.error(`Error writing manifest file ${outputFile}:`, err);
    }
    console.log(`\nSuccessfully created ${outputFile} with ${dataToWrite.length} total plugins`);
}

async function processList(sourceFile, outputFile) {
    let plugins = await getSources(sourceFile);
    if (plugins.length > 0) {
        plugins.unshift(createDummyPlugin());
        plugins = sanitizePlugins(plugins);
        await processDescriptions(plugins);
        await processImages(plugins);
        await writeManifest(plugins, outputFile);
    }
}

async function main() {
    userAgent = `Jellyfin-Server/${await getLatestJellyfinVersion()}`;
    await clearImagesFolder();
    await processList('sources.txt', 'manifest.json');
}

main();
