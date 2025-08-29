import indexedDBStorage from './utils/indexedDB.js';
import { ProxyManager } from './utils/proxyManager.js';

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
