# Universal Plugin Repo
### Universal plugin repository for Jellyfin Media Server

This is a development branch of UPR.

Goals for developmen include:
- Full migration to the obelo.us domain (opposed to direct linking to github)
- Reduced git commit spam by serving files directly
- Faster update times (1 hour, maybe less?)
- Better compatibility (Jellyfin version user agent forwarding)

# Security
Most sources come from [awesome-jellyfin](https://github.com/awesome-jellyfin/awesome-jellyfin)
The remainder are from reputable developers, and each source is reviewed before being added.
There is minimal risk in having even a known bad repository installed, as this project acts as a proxy between your server and a potentially malicious repository, helping to protect your IP. However, this protection no longer applies once you install a plugin, as the code is not proxied and could contain malware.

Make sure you only install plugins you recognise.

# Contribution
If you find a plugin that is not included, please take a few minutes to add it to sources.txt and create a pull request.
