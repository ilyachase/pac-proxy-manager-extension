// IndexedDB Storage for PAC Scripts
class IndexedDBStorage {
    constructor() {
        this.dbName = 'PacProxyManagerDB';
        this.version = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('pacScripts')) {
                    const store = db.createObjectStore('pacScripts', { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('enabled', 'enabled', { unique: false });
                }
            };
        });
    }

    async ensureDB() {
        if (!this.db) {
            await this.init();
        }
        return this.db;
    }

    async getPacScripts() {
        const db = await this.ensureDB();
        const transaction = db.transaction(['pacScripts'], 'readonly');
        const store = transaction.objectStore('pacScripts');

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

const indexedDBStorage = new IndexedDBStorage();

class ProxyManager {
    constructor() {
        this.isProxyActive = false;
        this.init().catch(() => {});
    }

    async init() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                const relevantChanges = ['domainExceptions', 'proxies', 'proxyActive', 'overridePacScript'];
                const hasRelevantChanges = relevantChanges.some((key) => changes[key]);

                if (hasRelevantChanges) {
                    this.updateProxySettings().catch(() => {});
                }
            }
        });

        const pacScripts = await indexedDBStorage.getPacScripts();
        const hasEnabledPacScripts = pacScripts.filter((script) => script.enabled).length > 0;

        if (hasEnabledPacScripts) {
            await this.updateProxySettings();
        }
    }

    generateCombinedPacScript(
        domainExceptions,
        proxyServers,
        pacScripts,
        userProxiesEnabled,
        overridePacScript = true
    ) {
        const userProxyList = proxyServers
            .map((proxy) => {
                try {
                    const url = new URL(proxy.url);

                    // remove ":" from the end of protocol
                    const scheme = url.protocol.replace(':', '').toLowerCase();

                    // URL scheme → PAC keyword mapping
                    const schemeMap = {
                        http: 'PROXY',
                        https: 'HTTPS',
                        socks: 'SOCKS', // chrome treats it as SOCKS v4
                        socks4: 'SOCKS',
                        socks5: 'SOCKS5'
                    };

                    const protocol = schemeMap[scheme] || 'PROXY';

                    // default ports
                    const defaultPortMap = {
                        http: '80',
                        https: '443',
                        socks: '1080',
                        socks4: '1080',
                        socks5: '1080'
                    };

                    const port = url.port || defaultPortMap[scheme] || '80';

                    return `${protocol} ${url.hostname}:${port}`;
                } catch (_e) {
                    // if invalid URL - keep as HTTP-proxy
                    return `PROXY ${proxy.url}`;
                }
            })
            .join('; ');

        const hasUserProxies = proxyServers.length > 0 && userProxiesEnabled;
        const userProxyString = hasUserProxies ? userProxyList : '';

        const enabledPacScripts = pacScripts.filter((script) => script.enabled);

        const pacScriptFunctions = enabledPacScripts
            .map((script, index) => {
                return `
function userPacScript${index}(url, host) {
  try {
    ${script.content}
    return FindProxyForURL(url, host);
  } catch (e) {
    return "DIRECT";
  }
}`;
            })
            .join('\n');

        return `
${pacScriptFunctions}

function FindProxyForURL(url, host) {
  const hasUserProxies = ${hasUserProxies};
  const userProxyString = "${userProxyString}";
  
  ${
      hasUserProxies
          ? `
  const domainExceptions = ${JSON.stringify(domainExceptions || {})};
  
  function checkDomainException(domain) {
    if (domainExceptions[domain]) {
      const option = domainExceptions[domain];
      if (option === 'yes') {
        return userProxyString + "; DIRECT";
      }
      if (option === 'no') {
        return "DIRECT";
      }
    }
    return null;
  }
  
  let exceptionResult = checkDomainException(host);
  if (exceptionResult !== null) return exceptionResult;
  
  for (const domain in domainExceptions) {
    if (domain.startsWith('*.')) {
      const baseDomain = domain.slice(2);
      if (host === baseDomain || host.endsWith('.' + baseDomain)) {
        exceptionResult = checkDomainException(domain);
        if (exceptionResult !== null) return exceptionResult;
      }
    }
  }
  
  `
          : `
  `
  }
  ${enabledPacScripts
      .map(
          (_script, index) => `
  try {
    const pacResult${index} = userPacScript${index}(url, host);
    if (pacResult${index} !== "DIRECT") {
      if (hasUserProxies && ${overridePacScript}) {
        return userProxyString + "; DIRECT";
      } else {
        return pacResult${index};
      }
    }
  } catch (e) {
  }`
      )
      .join('\n')}
  
  return "DIRECT";
}`;
    }

    async updateProxySettings(providedProxies = null) {
        try {
            const result = await chrome.storage.local.get([
                'domainExceptions',
                'proxies',
                'proxyActive',
                'overridePacScript'
            ]);

            const domainExceptions = result.domainExceptions || {};
            const proxies = providedProxies || result.proxies || [];
            const overridePacScript = result.overridePacScript !== false;
            const pacScripts = await indexedDBStorage.getPacScripts();
            const enabledPacScripts = pacScripts.filter((script) => script.enabled);

            const userProxiesEnabled = result.proxyActive && proxies.length > 0;
            const hasEnabledPacScripts = enabledPacScripts.length > 0;

            if (!hasEnabledPacScripts && !userProxiesEnabled) {
                await chrome.proxy.settings.clear({ scope: 'regular' });
                this.isProxyActive = false;
                return;
            }

            if (hasEnabledPacScripts || userProxiesEnabled) {
                const pacScript = this.generateCombinedPacScript(
                    domainExceptions,
                    proxies,
                    pacScripts,
                    userProxiesEnabled,
                    overridePacScript
                );

                await chrome.proxy.settings.set({
                    value: {
                        mode: 'pac_script',
                        pacScript: {
                            data: pacScript
                        }
                    },
                    scope: 'regular'
                });

                this.isProxyActive = true;
            }
        } catch (_error) {
            // Silently ignore errors
        }
    }

    async activateProxy(proxies = null) {
        try {
            if (proxies) {
                await chrome.storage.local.set({
                    proxies: proxies,
                    proxyActive: true
                });
            } else {
                await chrome.storage.local.set({ proxyActive: true });
            }
            this.isProxyActive = true;
            await this.updateProxySettings(proxies);
            return true;
        } catch (_error) {
            return false;
        }
    }

    async deactivateProxy() {
        try {
            await chrome.storage.local.set({ proxyActive: false });

            const pacScripts = await indexedDBStorage.getPacScripts();
            const hasEnabledPacScripts = pacScripts.filter((script) => script.enabled).length > 0;

            if (hasEnabledPacScripts) {
                await this.updateProxySettings();
            } else {
                await chrome.proxy.settings.clear({ scope: 'regular' });
                this.isProxyActive = false;
            }

            return true;
        } catch (_error) {
            return false;
        }
    }

    async getProxyStatus() {
        const settings = await chrome.proxy.settings.get({ incognito: false });
        const result = await chrome.storage.local.get(['proxies', 'proxyActive', 'overridePacScript']);
        const pacScripts = await indexedDBStorage.getPacScripts();
        const enabledPacScripts = pacScripts.filter((script) => script.enabled);

        const userProxiesEnabled = result.proxyActive && (result.proxies || []).length > 0;
        const hasEnabledPacScripts = enabledPacScripts.length > 0;

        return {
            isActive: result.proxyActive || false,
            userProxiesEnabled,
            hasEnabledPacScripts,
            overridePacScript: result.overridePacScript !== false,
            settings,
            isBlocked: settings.levelOfControl === 'controlled_by_other_extensions'
        };
    }
}

// Export for testing (browser-compatible)
if (typeof globalThis !== 'undefined') {
    globalThis._testExports = { ProxyManager, IndexedDBStorage };
}

const proxyManager = new ProxyManager();

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const handleAsync = async () => {
        try {
            switch (request.action) {
                case 'activateProxy': {
                    const activateResult = await proxyManager.activateProxy(request.proxies);
                    sendResponse(activateResult);
                    break;
                }

                case 'deactivateProxy': {
                    const deactivateResult = await proxyManager.deactivateProxy();
                    sendResponse(deactivateResult);
                    break;
                }

                case 'togglePacScript': {
                    try {
                        const script = await indexedDBStorage
                            .getPacScripts()
                            .then((scripts) => scripts.find((s) => s.id === request.scriptId));
                        if (script) {
                            script.enabled = request.enabled;
                            await indexedDBStorage.updatePacScript(script);
                            await proxyManager.updateProxySettings();
                            sendResponse(true);
                        } else {
                            sendResponse(false);
                        }
                    } catch (_error) {
                        sendResponse(false);
                    }
                    break;
                }

                case 'getProxyStatus': {
                    const status = await proxyManager.getProxyStatus();
                    sendResponse(status);
                    break;
                }

                case 'updateProxySettings':
                    await proxyManager.updateProxySettings();
                    sendResponse(true);
                    break;

                case 'pacScriptsUpdated':
                    await proxyManager.updateProxySettings();
                    sendResponse(true);
                    break;

                default:
                    sendResponse({ error: 'Unknown action' });
            }
        } catch (error) {
            sendResponse({ error: error.message });
        }
    };

    handleAsync();
    return true;
});
