import moment from './js/moment-es.js';

const EXT_MIME_MAPPINGS = {
    'mp3': 'audio/mpeg',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'exe': 'application/exe',
    'avi': 'video/x-msvideo',
    'torrent': 'application/x-bittorrent'
};

const RULE_FIELDS = ['mime', 'referrer', 'url', 'finalUrl', 'filename'];
const DATE_FIELD = 'date';
const DEFAULT_CONFLICT_ACTION = 'uniquify';
const VALID_CONFLICT_ACTIONS = new Set(['uniquify', 'overwrite', 'prompt']);
const downloadSessions = new Map();

function safeDecode(value) {
    if (typeof value !== 'string' || value.length === 0) {
        return value || '';
    }
    try {
        return decodeURI(value);
    } catch (error) {
        console.warn('Failed to decode value, using raw string instead.', { value, error });
        return value;
    }
}

function normalizeRulesets(rulesets) {
    if (Array.isArray(rulesets)) {
        return rulesets;
    }
    console.warn('Rulesets missing or invalid, defaulting to empty array.');
    return [];
}

function normalizeBlocklist(blocklist) {
    if (!Array.isArray(blocklist)) {
        if (blocklist !== undefined) {
            console.warn('Blocklist missing or invalid, defaulting to empty array.');
        }
        return [];
    }
    return blocklist.filter((pattern) => typeof pattern === 'string' && pattern.trim().length);
}

function matchesBlocklist(patterns, fields) {
    return patterns.some((pattern) => {
        let regex;
        try {
            regex = new RegExp(pattern, 'i');
        } catch (error) {
            console.warn('Invalid blocklist regex skipped', { pattern, error });
            return false;
        }
        return fields.some((value) => typeof value === 'string' && regex.test(value));
    });
}

function evaluateBlocklistForUrl(downloadId, url) {
    if (typeof url !== 'string' || !url.length) {
        return;
    }
    chrome.storage.local.get({ blocklist: [] }, ({ blocklist }) => {
        const normalizedBlocklist = normalizeBlocklist(blocklist);
        const session = downloadSessions.get(downloadId);
        if (!session) {
            return;
        }
        if (matchesBlocklist(normalizedBlocklist, [url])) {
            session.blocklisted = true;
            session.blocklistedUrl = url;
        }
    });
}

function ensureDownloadSession(downloadItem) {
    let session = downloadSessions.get(downloadItem.id);
    if (!session) {
        session = {};
        downloadSessions.set(downloadItem.id, session);
    }

    if (session.initialFilename === undefined && typeof downloadItem.filename === 'string' && downloadItem.filename.length) {
        session.initialFilename = downloadItem.filename;
    }
    if (typeof downloadItem.filename === 'string' && downloadItem.filename.length) {
        session.lastKnownFilename = downloadItem.filename;
    }
    return session;
}

function clearDownloadSession(downloadId) {
    downloadSessions.delete(downloadId);
}

function deferSuggestion(downloadItem, suggestFn) {
    const current = (typeof downloadItem.filename === 'string' && downloadItem.filename.length)
        ? downloadItem.filename
        : undefined;
    if (current) {
        suggestFn({
            filename: current
        });
    } else {
        console.warn('No existing filename found when deferring suggestion; falling back to default.', {
            downloadId: downloadItem.id
        });
        suggestFn();
    }
}

chrome.downloads.onCreated.addListener((item) => {
    if (typeof item.id !== 'number') {
        return;
    }
    const session = ensureDownloadSession(item);
    if (typeof item.filename === 'string' && item.filename.length) {
        session.initialFilename = item.filename;
    }
    evaluateBlocklistForUrl(item.id, item.url);
});

chrome.downloads.onChanged.addListener((delta) => {
    const session = downloadSessions.get(delta.id);
    if (session && delta.filename && typeof delta.filename.current === 'string') {
        session.lastKnownFilename = delta.filename.current;
    }
    if (delta.url && typeof delta.url.current === 'string') {
        evaluateBlocklistForUrl(delta.id, delta.url.current);
    }
    if (delta.finalUrl && typeof delta.finalUrl.current === 'string') {
        evaluateBlocklistForUrl(delta.id, delta.finalUrl.current);
    }
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        clearDownloadSession(delta.id);
    }
});

chrome.downloads.onErased.addListener((downloadId) => {
    clearDownloadSession(downloadId);
});

chrome.downloads.onDeterminingFilename.addListener(function (downloadItem, suggest) {

    console.log("Downloading item %o", downloadItem);

    const session = ensureDownloadSession(downloadItem);
    if (session.blocklisted) {
        console.log('Download skipped due to blocklist rule (cached).', {
            downloadId: downloadItem.id,
            url: session.blocklistedUrl || downloadItem.url
        });
        deferSuggestion(downloadItem, suggest);
        return;
    }

    chrome.storage.local.get({ rulesets: [], blocklist: [] }, ({ rulesets, blocklist }) => {
        const normalizedBlocklist = normalizeBlocklist(blocklist);
        const downloadUrl = typeof downloadItem.url === 'string' ? downloadItem.url : '';

        if (!session.blocklisted && matchesBlocklist(normalizedBlocklist, [downloadUrl])) {
            session.blocklisted = true;
            session.blocklistedUrl = downloadUrl;
        }

        if (session.blocklisted) {
            console.log('Download skipped due to blocklist rule.', {
                downloadId: downloadItem.id,
                url: session.blocklistedUrl || downloadUrl
            });
            deferSuggestion(downloadItem, suggest);
            return;
        }

        const normalizedRules = normalizeRulesets(rulesets);

        const baselineFilename = session.initialFilename || '';
        const currentFilename = downloadItem.filename || '';
        session.lastKnownFilename = currentFilename;

        const item = {
            'mime': downloadItem.mime || '',
            'referrer': safeDecode(downloadItem.referrer),
            'url': safeDecode(downloadItem.url),
            'finalUrl': safeDecode(downloadItem.finalUrl || downloadItem.url),
            'filename': downloadItem.filename || '',
            'startTime': downloadItem.startTime ? new Date(downloadItem.startTime) : new Date()
        };

        if (!session.suggestedByUs && baselineFilename && currentFilename && baselineFilename !== currentFilename) {
            console.log('Filename already modified by another extension, skipping rename.', {
                downloadId: downloadItem.id,
                baselineFilename: baselineFilename,
                currentFilename: currentFilename
            });
            deferSuggestion(downloadItem, suggest);
            return;
        }
    
        // Octet-stream workaround
        if (downloadItem.mime == 'application/octet-stream' && typeof downloadItem.filename === 'string') {
            const matches = downloadItem.filename.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
            const extension = matches && matches[1];
    
            if (extension && EXT_MIME_MAPPINGS[extension]) {
                item.mime = EXT_MIME_MAPPINGS[extension];
            }
        }

        let suggestion = undefined;
    
        normalizedRules.every(function (rule) {
            if (typeof rule !== 'object' || rule === null) {
                console.warn('Skipping invalid rule entry:', rule);
                return true;
            }

            if (!rule.enabled) {
                console.log("Rule disabled: %o", rule);
                return true; // continue to the next rule
            }

            if (typeof rule.pattern !== 'string' || !rule.pattern.trim().length) {
                console.warn('Skipping rule without a valid pattern:', rule);
                return true;
            }
    
            var substitutions = {};
    
            var success = RULE_FIELDS.every(function (field) {
                if (!rule[field]) {
                    substitutions[field] = [item[field]];
                    return true; // skip this and continue to the next field
                }
    
                let regex;
                try {
                    regex = new RegExp(rule[field], 'i');
                } catch (error) {
                    console.warn('Invalid regex provided in rule field', { field: field, rule: rule, error: error });
                    return false;
                }

                var matches = regex.exec(item[field] || '');
                if (!matches) {
                    return false; // rule failed, break
                }
                matches.shift();
                substitutions[field] = [item[field]].concat(matches);
                return true;
            });
    
            if (!success) {
                console.log("Rule didn't match: %o", rule);
                return true; // continue to the next rule
            }
    
            console.log("Rule matched: %o", rule);
    
            let result = true;
    
            let filename = rule['pattern'].replace(/\$\{(\w+)(?::(.+?))?\}/g, function (orig, field, idx) {
                if (field === DATE_FIELD) {
                    if (idx) {
                        return moment(item.startTime).format(idx);
                    } else {
                        return moment(item.startTime).format("YYYY-MM-DD");
                    }
                }
    
                if (!substitutions[field]) {
                    console.log('Invalid field %s', field);
                    result = false;
                    return orig;
                }
    
                if (idx) {
                    if (!substitutions[field][idx]) {
                        console.log('Invalid index %s for field %s', idx, field);
                        result = false;
                        return orig;
                    }
                    return substitutions[field][idx];
                }
                return substitutions[field][0];
            });
    
            // if no exact filename specified use the original one
            if (/\/$/.test(filename)) {
                filename = filename + substitutions.filename[0];
            }
    
            // remove trailing slashes
            filename = filename.replace(/^\/+/, '');
    
            let conflictAction = rule['conflict-action'];
            if (!VALID_CONFLICT_ACTIONS.has(conflictAction)) {
                conflictAction = DEFAULT_CONFLICT_ACTION;
            }
    
            if (result) {
                if (filename === currentFilename) {
                    console.log('Filename already matches desired value; skipping suggestion.', {
                        downloadId: downloadItem.id,
                        filename: filename
                    });
                    return true;
                }
                suggestion = {
                    filename: filename,
                    conflictAction: conflictAction
                };
                session.suggestedByUs = true;
                session.lastKnownFilename = filename;
                return false; // suggestion found, do not continue to the next rule
            }
        });

        if (suggestion !== undefined) {
            console.log("Selected suggestion: %s", JSON.stringify(suggestion));
            suggest(suggestion);
        } else {
            console.log("No matching rule was found")
            deferSuggestion(downloadItem, suggest);
        }
    });

    return true;
});

async function createOffscreen() {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }
  
    await chrome.offscreen.createDocument({
      url: './offscreen.html',
      reasons: ['LOCAL_STORAGE'],
      justification:
        'migrate from localStorage config to storage.local',
    });
  
    console.debug('Offscreen iframe loaded');
}

chrome.storage.local.get(['version', 'showChangelog']).then(
    ( values ) => {
        if (values['version'] === undefined) {
            // migrate from localStorate
            createOffscreen().then(
                () => {
                    chrome.runtime.sendMessage('getRulesetsFromLS', (response) => {
                        console.log('received old rule sets: %s', response);
                        if (response !== undefined) {
                            // if has old rule sets to migrate
                            chrome.storage.local.set({
                                'rulesets': JSON.parse(response),
                                'version': chrome.runtime.getManifest().version,
                                'showChangelog': true
                            }).then(
                                () => {
                                    chrome.runtime.sendMessage('removeRulesetsFromLS', (response) => {
                                        console.log('rule sets migrated');
                                        chrome.offscreen.closeDocument();
                                        chrome.tabs.create({ url: "options.html" });        
                                    });
                                }
                            );
                        } else {
                            // if just installed
                            chrome.storage.local.set({
                                'version': chrome.runtime.getManifest().version,
                                'showChangelog': true
                            }).then(
                                () =>  {
                                    chrome.offscreen.closeDocument();
                                    chrome.tabs.create({ url: "options.html" });        
                                }
                            );
                        }
                    });
                }
            );
        } else {
            // all migrated
            var version = values['version'];
            if (version === undefined || version != chrome.runtime.getManifest().version) {
                chrome.storage.local.set({
                    'version': chrome.runtime.getManifest().version,
                    'showChangelog': true
                }).then(
                    () =>  {
                        chrome.tabs.create({ url: "options.html" });        
                    }
                );
            }
        }
    }
);
