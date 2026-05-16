const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
let userAgent = process.argv[2];
let regenImages = ['true', '1', 'yes'].includes(String(process.argv[3]).toLowerCase());
const agentDirName = userAgent || 'unknown';

const pluginDir = path.join('./plugins', agentDirName);
const imageBaseUrl = `https://test.obelous.dev/plugins/${encodeURIComponent(agentDirName)}/`;
const fallbackImageUrl = 'https://dl.obelous.dev/public/upr-main.png';

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
            const response = await fetch(url, { headers: { 'User-Agent': 'Jellyfin-Server/'+userAgent } });
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
        const entries = await fs.readdir(pluginDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === 'manifest.json') continue;
            await fs.rm(path.join(pluginDir, entry.name), { recursive: true, force: true });
        }
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
        await fs.writeFile(path.join(pluginDir, filename), Buffer.from(buffer));
        return true;
    } catch (err) {
        console.error(`Error downloading image ${url}:`, err.message);
        return false;
    }
}

async function imageExists(filename) {
    try {
        await fs.access(path.join(pluginDir, filename));
        return true;
    } catch {
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

function sanitizeImageName(name) {
    return String(name).replace(/\s+/g, '');
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
        if (!plugin.imageUrl) {
            plugin.imageUrl = fallbackImageUrl;
            console.log(`    -> Using fallback imageUrl for plugin ${getPluginId(plugin) || 'unknown'}`);
            continue;
        }

        if (plugin.imageUrl) {
            const ext = getImageExtension(plugin.imageUrl);
            let pluginId = getPluginId(plugin);
            if (!pluginId) {
                pluginId = hashString(plugin.imageUrl);
            }
            const legacyFilename = `${pluginId}${ext}`;
            const filename = `${sanitizeImageName(pluginId)}${ext}`;
            const shouldDownload = regenImages || !(await imageExists(filename));

            if (filename !== legacyFilename && !shouldDownload && await imageExists(legacyFilename)) {
                try {
                    await fs.rename(path.join(pluginDir, legacyFilename), path.join(pluginDir, filename));
                    console.log(`    -> Renamed image asset to remove spaces: ${legacyFilename} -> ${filename}`);
                } catch (err) {
                    console.error(`Error renaming image ${legacyFilename}:`, err.message);
                }
            }

            if (shouldDownload) {
                const success = await downloadImage(plugin.imageUrl, filename);
                if (!success) {
                    plugin.imageUrl = fallbackImageUrl;
                    console.log(`    -> Using fallback imageUrl for plugin ${pluginId}`);
                    continue;
                }
            } else {
                console.log(`Skipping existing image: ${filename}`);
            }
            if (shouldDownload || await imageExists(filename)) {
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
        plugins = sanitizePlugins(plugins);
        await processDescriptions(plugins);
        await processImages(plugins);
        await writeManifest(plugins, outputFile);
    }
}

async function main() {
    try{await fs.mkdir('./plugins/')}catch(err){}
    try{await fs.mkdir(pluginDir, { recursive: true })}catch(err){}
    if(regenImages)await clearImagesFolder();
    await processList('sources.txt', path.join('./plugins', agentDirName, 'manifest.json'));
}

main();
