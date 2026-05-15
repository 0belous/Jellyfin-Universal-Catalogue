# Jellyfin Universal Catalogue

A universal plugin repository for **Jellyfin Media Server**. This project aggregates plugin feeds, de-duplicates entries, normalizes assets, and publishes a single catalogue URL that is easier for end users to install and maintain.

## Table of Contents
- [Why this repo exists](#why-this-repo-exists)
- [Repository URLs](#repository-urls)
- [How installation works](#how-installation-works)
- [How this project is maintained](#how-this-project-is-maintained)
- [Project structure](#project-structure)
- [Security notes](#security-notes)
- [Contributing](#contributing)

## Why this repo exists
Managing multiple Jellyfin plugin repositories can get messy fast. This project provides:
- **one primary catalogue URL** for regular plugins
- an optional **NSFW catalogue URL**
- automatic feed updates and duplicate merging
- a simpler setup flow for self-hosted Jellyfin users

## Repository URLs
### Main catalogue
```text
https://obelo.us/upr
```

### Optional NSFW catalogue
```text
https://obelo.us/uprn
```

## How installation works
1. Open the Jellyfin admin dashboard.
2. Go to the plugin or catalogue repository settings.
3. Remove outdated repository entries if you previously added multiple plugin feeds.
4. Add the main catalogue URL shown above.
5. Save the configuration and refresh your available plugins.
6. Optionally add the NSFW catalogue if you explicitly want that separate feed.

## How this project is maintained
The update pipeline is driven by `update.js`.

It does the following:
- reads source repository lists from `sources.txt` and `sourcesnsfw.txt`
- fetches upstream plugin JSON feeds
- merges duplicate plugins by GUID
- keeps plugin versions grouped cleanly
- downloads and refreshes image assets
- outputs normalized manifests for Jellyfin clients

## Project structure
```text
.
├── README.md           # Project overview and setup instructions
├── update.js           # Aggregation and manifest generation script
├── sources.txt         # Upstream plugin feed list
├── sourcesnsfw.txt     # Optional NSFW feed list
├── manifest.json       # Generated main catalogue manifest
├── manifestnsfw.json   # Generated NSFW catalogue manifest
├── images/             # Downloaded plugin artwork/assets
└── package.json        # Node project metadata
```

## Security notes
Most upstream sources come from reputable community-maintained Jellyfin plugin repositories, including entries referenced from [awesome-jellyfin](https://github.com/awesome-jellyfin/awesome-jellyfin).

A few practical notes:
- this project helps reduce direct exposure to many separate repository endpoints
- plugin metadata is reviewed before inclusion
- installing a plugin still means trusting that plugin's code
- users should continue to install only plugins they recognize or have reviewed

## Contributing
If you want to add a missing plugin source:
1. update `sources.txt` or `sourcesnsfw.txt`
2. regenerate the manifests
3. open a pull request with the new source and any context maintainers should know

A future enhancement could be a short developer section with the exact command used to run `update.js` and publish refreshed manifests.
