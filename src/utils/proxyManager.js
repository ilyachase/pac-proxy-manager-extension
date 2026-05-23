import indexedDBStorage from './indexedDB.js';

export class ProxyManager {
    constructor() {
        this.isProxyActive = false;
        this.lastAppliedPac = null;
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

                    const scheme = url.protocol.replace(':', '').toLowerCase();

                    const schemeMap = {
                        http: 'PROXY',
                        https: 'HTTPS',
                        socks: 'SOCKS',
                        socks4: 'SOCKS',
                        socks5: 'SOCKS5'
                    };

                    const protocol = schemeMap[scheme] || 'PROXY';

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
                    return `PROXY ${proxy.url}`;
                }
            })
            .join('; ');

        const hasUserProxies = proxyServers.length > 0 && userProxiesEnabled;
        const userProxyString = hasUserProxies ? userProxyList : '';

        const enabledPacScripts = pacScripts.filter((script) => script.enabled);

        // Initialize each user PAC script ONCE in an IIFE so that any heavy
        // setup (regex compilation, large lookup tables, etc.) doesn't re-run
        // on every URL Chrome asks us to resolve. The IIFE captures the outer
        // FindProxyForURL to detect user scripts that forgot to declare their
        // own (in which case we fall back to DIRECT instead of recursing into
        // ourselves).
        const pacScriptInits = enabledPacScripts
            .map((script, index) => {
                return `
var userPacScript${index} = (function (__outerFindProxyForURL) {
  try {
    ${script.content}
    if (typeof FindProxyForURL === 'function' && FindProxyForURL !== __outerFindProxyForURL) {
      return FindProxyForURL;
    }
  } catch (e) {}
  return function () { return "DIRECT"; };
})(typeof FindProxyForURL === 'function' ? FindProxyForURL : null);`;
            })
            .join('\n');

        const pacScriptCalls = enabledPacScripts
            .map(
                (_script, index) => `
  try {
    var pacResult${index} = userPacScript${index}(url, host);
    if (pacResult${index} && pacResult${index} !== "DIRECT") {
      if (hasUserProxies && ${overridePacScript}) {
        return userProxyString + "; DIRECT";
      } else {
        return pacResult${index};
      }
    }
  } catch (e) {
  }`
            )
            .join('\n');

        // 'no' exceptions are always honoured (they only need DIRECT and don't
        // require a user proxy). 'yes' exceptions still require user proxies.
        const exceptionsJson = JSON.stringify(domainExceptions || {});
        const exceptionsBlock = `
  const domainExceptions = ${exceptionsJson};

  function checkDomainException(domain) {
    if (!Object.prototype.hasOwnProperty.call(domainExceptions, domain)) return null;
    const option = domainExceptions[domain];
    if (option === 'no') return "DIRECT";
    if (option === 'yes' && hasUserProxies) return userProxyString + "; DIRECT";
    return null;
  }

  let exceptionResult = checkDomainException(host);
  if (exceptionResult !== null) return exceptionResult;

  for (const domain in domainExceptions) {
    if (domain.charCodeAt(0) === 42 && domain.charCodeAt(1) === 46) {
      const baseDomain = domain.slice(2);
      if (host === baseDomain || (host.length > baseDomain.length && host.slice(-baseDomain.length - 1) === '.' + baseDomain)) {
        exceptionResult = checkDomainException(domain);
        if (exceptionResult !== null) return exceptionResult;
      }
    }
  }
`;

        return `
${pacScriptInits}

const __pacCacheLimit = 1024;
const __pacCache = Object.create(null);
const __pacCacheOrder = [];

function FindProxyForURL(url, host) {
  const schemeEnd = url.indexOf(':');
  const cacheKey = (schemeEnd > 0 ? url.substring(0, schemeEnd) : '') + '|' + host;

  if (cacheKey in __pacCache) {
    return __pacCache[cacheKey];
  }

  const result = __resolveProxy(url, host);

  __pacCache[cacheKey] = result;
  __pacCacheOrder.push(cacheKey);
  if (__pacCacheOrder.length > __pacCacheLimit) {
    const evicted = __pacCacheOrder.shift();
    delete __pacCache[evicted];
  }

  return result;
}

function __resolveProxy(url, host) {
  const hasUserProxies = ${hasUserProxies};
  const userProxyString = "${userProxyString}";
${exceptionsBlock}
${pacScriptCalls}

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
                if (this.isProxyActive || this.lastAppliedPac !== null) {
                    await chrome.proxy.settings.clear({ scope: 'regular' });
                }
                this.isProxyActive = false;
                this.lastAppliedPac = null;
                return;
            }

            const pacScript = this.generateCombinedPacScript(
                domainExceptions,
                proxies,
                pacScripts,
                userProxiesEnabled,
                overridePacScript
            );

            // Skip re-applying identical PAC. chrome.proxy.settings.set tears
            // down existing sockets and clears the PAC result cache, so doing
            // it on every storage change (even no-op) can cause timeouts on
            // in-flight loads.
            if (this.isProxyActive && pacScript === this.lastAppliedPac) {
                return;
            }

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
            this.lastAppliedPac = pacScript;
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
                this.lastAppliedPac = null;
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
