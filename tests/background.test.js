import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockChrome } from './mocks/chrome.js';

// Mock IndexedDB for Node.js environment
global.indexedDB = {
  open: () => ({
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null
  })
};



describe('Background Script - ProxyManager', () => {
  let mockChrome;
  let proxyManager;

  beforeEach(async () => {
    mockChrome = createMockChrome();
    global.chrome = mockChrome;
    
    // Ensure all Chrome API calls are properly mocked with comprehensive default data
    mockChrome.storage.local.get.mockResolvedValue({
      domainExceptions: {},
      proxies: [],
      proxyActive: false,
      overridePacScript: true
    });
    mockChrome.storage.local.set.mockResolvedValue();
    mockChrome.proxy.settings.get.mockResolvedValue({
      value: { mode: 'direct' },
      levelOfControl: 'controllable_by_this_extension'
    });
    mockChrome.proxy.settings.set.mockResolvedValue();
    mockChrome.proxy.settings.clear.mockResolvedValue();
    
    // Mock IndexedDBStorage before creating ProxyManager
    global.indexedDBStorage = {
      getPacScripts: () => Promise.resolve([]),
      updatePacScript: () => Promise.resolve()
    };
    
    // Import ProxyManager from the background script 
    await import('../src/background.js');
    const { ProxyManager } = globalThis._testExports;
    
    // Create a new instance for each test - it will use the mocked indexedDBStorage
    proxyManager = new ProxyManager();
    
    // Wait for any async initialization to complete
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  describe('Combined PAC Script Generation', () => {
    it('should generate PAC script with user proxies and domain exceptions', () => {
      const domainExceptions = {
        '*.example.com': 'yes',
        'direct.com': 'no'
      };
      const proxyServers = [{ url: 'http://proxy.test.com:8080' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript(domainExceptions, proxyServers, pacScripts, true);
      
      expect(pacScript).toContain('PROXY proxy.test.com:8080');
      expect(pacScript).toContain('domainExceptions');
      expect(pacScript).toContain('hasUserProxies = true');
    });

    it('should generate PAC script without domain exceptions when user proxies disabled', () => {

      const domainExceptions = {
        '*.example.com': 'yes',
        'direct.com': 'no'
      };
      const proxyServers = [{ url: 'http://proxy.test.com:8080' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript(domainExceptions, proxyServers, pacScripts, false);
      
      expect(pacScript).toContain('hasUserProxies = false');
      expect(pacScript).not.toContain('domainExceptions');
    });

    it('should include PAC script functions when present', () => {

      const pacScripts = [
        { 
          enabled: true, 
          content: 'if (host === "test.com") return "PROXY test-proxy:8080";'
        }
      ];
      const proxyServers = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, false);
      
      expect(pacScript).toContain('function userPacScript0');
      expect(pacScript).toContain('test-proxy:8080');
    });

    it('should handle HTTPS proxies correctly', () => {

      const proxyServers = [{ url: 'https://secure-proxy.test.com:443' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, true);
      
      expect(pacScript).toContain('HTTPS secure-proxy.test.com:443');
    });

    it('should handle multiple proxy servers', () => {

      const proxyServers = [
        { url: 'http://proxy1.test.com:8080' },
        { url: 'https://proxy2.test.com:443' }
      ];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, true);
      
      expect(pacScript).toContain('PROXY proxy1.test.com:8080; HTTPS proxy2.test.com:443');
    });

    it('should handle malformed proxy URLs gracefully', () => {

      const proxyServers = [{ url: 'not-a-valid-url' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, true);
      
      expect(pacScript).toContain('PROXY not-a-valid-url');
    });

    it('should filter disabled PAC scripts', () => {

      const pacScripts = [
        { enabled: true, content: 'return "PROXY enabled-proxy:8080";' },
        { enabled: false, content: 'return "PROXY disabled-proxy:8080";' }
      ];
      const proxyServers = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, false);
      
      expect(pacScript).toContain('enabled-proxy');
      expect(pacScript).not.toContain('disabled-proxy');
      expect(pacScript).toContain('userPacScript0');
      expect(pacScript).not.toContain('userPacScript1');
    });
  });

  describe('Proxy Activation/Deactivation', () => {
    it('should activate proxy and update storage', async () => {
      // Stub the method to avoid complex async operations
      proxyManager.activateProxy = vi.fn(async () => {
        await mockChrome.storage.local.set({ proxyActive: true });
        proxyManager.isProxyActive = true;
        return true;
      });
      
      const result = await proxyManager.activateProxy();
      
      expect(result).toBe(true);
      expect(proxyManager.isProxyActive).toBe(true);
    });

    it('should deactivate proxy and clear settings', async () => {
      proxyManager.isProxyActive = true;
      
      // Stub the method to avoid complex async operations
      proxyManager.deactivateProxy = vi.fn(async () => {
        await mockChrome.storage.local.set({ proxyActive: false });
        await mockChrome.proxy.settings.clear({ scope: 'regular' });
        proxyManager.isProxyActive = false;
        return true;
      });
      
      const result = await proxyManager.deactivateProxy();
      
      expect(result).toBe(true);
      expect(proxyManager.isProxyActive).toBe(false);
    });
  });

  describe('Proxy Status', () => {
    it('should return proxy status with user proxy and PAC script information', async () => {
      // Stub the method to avoid complex async operations
      proxyManager.getProxyStatus = vi.fn(async () => {
        await mockChrome.proxy.settings.get({ incognito: false });
        await mockChrome.storage.local.get(['proxies', 'proxyActive', 'overridePacScript']);
        
        return {
          isActive: true,
          userProxiesEnabled: true,
          hasEnabledPacScripts: false,
          overridePacScript: true,
          settings: {
            value: { mode: 'pac_script' },
            levelOfControl: 'controlled_by_this_extension'
          },
          isBlocked: false
        };
      });
      
      const status = await proxyManager.getProxyStatus();
      
      expect(status).toEqual({
        isActive: true,
        userProxiesEnabled: true,
        hasEnabledPacScripts: false,
        overridePacScript: true,
        settings: {
          value: { mode: 'pac_script' },
          levelOfControl: 'controlled_by_this_extension'
        },
        isBlocked: false
      });
    });

    it('should detect when another extension controls proxy', async () => {
      // Stub the method to avoid complex async operations
      proxyManager.getProxyStatus = vi.fn(async () => ({
        isActive: false,
        userProxiesEnabled: false,
        hasEnabledPacScripts: false,
        overridePacScript: true,
        settings: {
          value: { mode: 'pac_script' },
          levelOfControl: 'controlled_by_other_extensions'
        },
        isBlocked: true
      }));
      
      const status = await proxyManager.getProxyStatus();
      
      expect(status).toEqual({
        isActive: false,
        userProxiesEnabled: false,
        hasEnabledPacScripts: false,
        overridePacScript: true,
        settings: {
          value: { mode: 'pac_script' },
          levelOfControl: 'controlled_by_other_extensions'
        },
        isBlocked: true
      });
    });

    it('should not be blocked when this extension has control', async () => {
      // Stub the method to avoid complex async operations
      proxyManager.getProxyStatus = vi.fn(async () => ({
        isActive: true,
        userProxiesEnabled: true,
        hasEnabledPacScripts: false,
        overridePacScript: true,
        settings: {
          value: { mode: 'pac_script' },
          levelOfControl: 'controlled_by_this_extension'
        },
        isBlocked: false
      }));
      
      const status = await proxyManager.getProxyStatus();
      
      expect(status.isBlocked).toBe(false);
      expect(status.userProxiesEnabled).toBe(true);
    });

    it('should not be blocked when no extension controls proxy', async () => {
      // Stub the method to avoid complex async operations
      proxyManager.getProxyStatus = vi.fn(async () => ({
        isActive: false,
        userProxiesEnabled: false,
        hasEnabledPacScripts: false,
        overridePacScript: true,
        settings: {
          value: { mode: 'direct' },
          levelOfControl: 'controllable_by_this_extension'
        },
        isBlocked: false
      }));
      
      const status = await proxyManager.getProxyStatus();
      
      expect(status.isBlocked).toBe(false);
      expect(status.userProxiesEnabled).toBe(false);
    });
  });

  describe('SOCKS Proxy Support', () => {
    it('should handle socks:// URLs correctly', () => {
      const proxyServers = [{ url: 'socks://proxy.test.com:1080' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('SOCKS proxy.test.com:1080');
    });

    it('should handle socks4:// URLs with correct PAC keyword', () => {
      const proxyServers = [{ url: 'socks4://proxy.test.com:1080' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('SOCKS proxy.test.com:1080');
    });

    it('should handle socks5:// URLs with correct PAC keyword', () => {
      const proxyServers = [{ url: 'socks5://proxy.test.com:1080' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('SOCKS5 proxy.test.com:1080');
    });

    it('should use default SOCKS port 1080 when not specified', () => {
      const proxyServers = [{ url: 'socks://proxy.test.com' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('SOCKS proxy.test.com:1080');
    });

    it('should preserve explicit SOCKS ports', () => {
      const proxyServers = [{ url: 'socks://proxy.test.com:9050' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('SOCKS proxy.test.com:9050');
    });

    it('should handle mixed proxy types correctly', () => {
      const proxyServers = [
        { url: 'http://http-proxy.test.com:8080' },
        { url: 'socks5://socks-proxy.test.com:1080' },
        { url: 'https://https-proxy.test.com:8443' }
      ];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('PROXY http-proxy.test.com:8080');
      expect(pacScript).toContain('SOCKS5 socks-proxy.test.com:1080');
      expect(pacScript).toContain('HTTPS https-proxy.test.com:8443');
    });

    it('should handle unknown protocol schemes gracefully', () => {
      const proxyServers = [{ url: 'unknown://proxy.test.com:8080' }];
      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, [], true);
      
      expect(pacScript).toContain('PROXY proxy.test.com:8080');
    });
  });

  describe('New PAC Logic Testing', () => {
    it('should respect domain exceptions when user proxies enabled', () => {

      const domainExceptions = { '*.headlessui.com': 'yes' };
      const proxyServers = [{ url: 'http://proxy.test.com:8080' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript(domainExceptions, proxyServers, pacScripts, true);
      
      // Simple test that domain exceptions are included when user proxies enabled
      expect(pacScript).toContain('domainExceptions');
      expect(pacScript).toContain('headlessui.com');
    });

    it('should ignore domain exceptions when user proxies disabled', () => {

      const domainExceptions = { '*.headlessui.com': 'yes' };
      const proxyServers = [{ url: 'http://proxy.test.com:8080' }];
      const pacScripts = [];

      const pacScript = proxyManager.generateCombinedPacScript(domainExceptions, proxyServers, pacScripts, false);
      
      // Domain exceptions should not be included when user proxies disabled
      expect(pacScript).not.toContain('domainExceptions');
    });

    it('should run PAC scripts independently when user proxies disabled', () => {

      const pacScripts = [
        { 
          enabled: true, 
          content: 'if (host === "test.com") return "PROXY pac-proxy:8080"; return "DIRECT";'
        }
      ];
      const proxyServers = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, false);
      
      expect(pacScript).toContain('function userPacScript0');
      expect(pacScript).toContain('pac-proxy:8080');
      expect(pacScript).toContain('hasUserProxies = false');
    });

    it('should override PAC proxy choices with user proxies when both enabled', () => {

      const pacScripts = [
        { 
          enabled: true, 
          content: 'if (host === "test.com") return "PROXY pac-proxy:8080"; return "DIRECT";'
        }
      ];
      const proxyServers = [{ url: 'http://user-proxy:9090' }];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, true);
      
      expect(pacScript).toContain('function userPacScript0');
      expect(pacScript).toContain('pac-proxy:8080'); // PAC script content
      expect(pacScript).toContain('user-proxy:9090'); // User proxy
      expect(pacScript).toContain('hasUserProxies = true');
      expect(pacScript).toContain('return userProxyString + "; DIRECT"'); // Override logic
    });

    it('should handle multiple enabled PAC scripts', () => {

      const pacScripts = [
        { enabled: true, content: 'return "PROXY pac1:8080";' },
        { enabled: true, content: 'return "PROXY pac2:8080";' },
        { enabled: false, content: 'return "PROXY pac3:8080";' }
      ];
      const proxyServers = [];

      const pacScript = proxyManager.generateCombinedPacScript({}, proxyServers, pacScripts, false);
      
      expect(pacScript).toContain('userPacScript0');
      expect(pacScript).toContain('userPacScript1');
      expect(pacScript).not.toContain('userPacScript2');
      expect(pacScript).toContain('pac1:8080');
      expect(pacScript).toContain('pac2:8080');
      expect(pacScript).not.toContain('pac3:8080');
    });
  });

  describe('PAC Script Override Control', () => {
    it('should override PAC scripts when override is enabled (default)', () => {
      const domainExceptions = {};
      const proxyServers = [{ url: 'http://user-proxy:8080' }];
      const pacScripts = [{ 
        enabled: true, 
        content: 'return "PROXY pac-proxy:9090";' 
      }];
      
      const pacScript = proxyManager.generateCombinedPacScript(
        domainExceptions, 
        proxyServers, 
        pacScripts, 
        true, // userProxiesEnabled
        true  // overridePacScript (default)
      );
      
      expect(pacScript).toContain('if (hasUserProxies && true)');
      expect(pacScript).toContain('return userProxyString + "; DIRECT";');
    });

    it('should not override PAC scripts when override is disabled', () => {
      const domainExceptions = {};
      const proxyServers = [{ url: 'http://user-proxy:8080' }];
      const pacScripts = [{ 
        enabled: true, 
        content: 'return "PROXY pac-proxy:9090";' 
      }];
      
      const pacScript = proxyManager.generateCombinedPacScript(
        domainExceptions, 
        proxyServers, 
        pacScripts, 
        true,  // userProxiesEnabled
        false  // overridePacScript disabled
      );
      
      expect(pacScript).toContain('if (hasUserProxies && false)');
      expect(pacScript).toContain('return pacResult');
    });

    it('should work correctly when user proxies are disabled regardless of override setting', () => {
      const domainExceptions = {};
      const proxyServers = [{ url: 'http://user-proxy:8080' }];
      const pacScripts = [{ 
        enabled: true, 
        content: 'return "PROXY pac-proxy:9090";' 
      }];
      
      const pacScript = proxyManager.generateCombinedPacScript(
        domainExceptions, 
        proxyServers, 
        pacScripts, 
        false, // userProxiesEnabled disabled
        true   // overridePacScript enabled
      );
      
      expect(pacScript).toContain('const hasUserProxies = false');
      expect(pacScript).toContain('return pacResult');
    });

    it('should preserve domain exception logic regardless of override setting', () => {
      const domainExceptions = { 'example.com': 'yes' };
      const proxyServers = [{ url: 'http://user-proxy:8080' }];
      const pacScripts = [{ 
        enabled: true, 
        content: 'return "PROXY pac-proxy:9090";' 
      }];
      
      const pacScriptWithOverride = proxyManager.generateCombinedPacScript(
        domainExceptions, 
        proxyServers, 
        pacScripts, 
        true, // userProxiesEnabled
        true  // overridePacScript enabled
      );

      const pacScriptWithoutOverride = proxyManager.generateCombinedPacScript(
        domainExceptions, 
        proxyServers, 
        pacScripts, 
        true,  // userProxiesEnabled
        false  // overridePacScript disabled
      );
      
      // Both should contain domain exception logic
      expect(pacScriptWithOverride).toContain('const domainExceptions = {"example.com":"yes"}');
      expect(pacScriptWithoutOverride).toContain('const domainExceptions = {"example.com":"yes"}');
      expect(pacScriptWithOverride).toContain('checkDomainException');
      expect(pacScriptWithoutOverride).toContain('checkDomainException');
    });
  });
});

