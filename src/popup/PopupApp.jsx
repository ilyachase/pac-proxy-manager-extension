import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import AboutTab from './tabs/AboutTab';
import ExceptionsTab from './tabs/ExceptionsTab';
import PacScriptsTab from './tabs/PacScriptsTab';
import ProxiesTab from './tabs/ProxiesTab';

const PopupApp = () => {
    const [messages, setMessages] = useState({});

    useEffect(() => {
        const loadMessages = () => {
            const msgs = {
                pacProxyManager: chrome.i18n.getMessage('pacProxyManager'),
                tabPacScript: chrome.i18n.getMessage('tabPacScript'),
                tabExceptions: chrome.i18n.getMessage('tabExceptions'),
                tabProxies: chrome.i18n.getMessage('tabProxies'),
                tabAbout: chrome.i18n.getMessage('tabAbout')
            };
            setMessages(msgs);
        };

        loadMessages();
    }, []);

    const categories = [
        {
            name: messages.tabExceptions,
            content: 'exceptions-tab'
        },
        {
            name: messages.tabPacScript,
            content: 'pac-scripts-tab'
        },
        {
            name: messages.tabProxies,
            content: 'proxies-tab'
        },
        {
            name: messages.tabAbout,
            content: 'about-tab'
        }
    ];

    return (
        <div className="w-[500px] bg-white p-4 h-auto">
            <Toaster
                position="top-center"
                toastOptions={{
                    duration: 3000,
                    style: {
                        background: '#ffffff',
                        color: '#374151',
                        border: '1px solid #d1d5db',
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                    },
                    success: {
                        iconTheme: {
                            primary: '#10b981',
                            secondary: '#ffffff'
                        }
                    },
                    error: {
                        iconTheme: {
                            primary: '#ef4444',
                            secondary: '#ffffff'
                        }
                    }
                }}
            />
            <div className="w-full">
                <TabGroup>
                    <TabList className="flex gap-2">
                        {categories.map(({ name }) => (
                            <Tab
                                key={name}
                                className="rounded-full px-3 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap focus:outline-none data-hover:bg-slate-100 data-hover:text-slate-600 data-selected:bg-slate-500 data-selected:text-white data-selected:data-hover:bg-slate-600"
                            >
                                {name}
                            </Tab>
                        ))}
                    </TabList>
                    <TabPanels className="mt-3 h-auto">
                        {categories.map(({ name, content }) => (
                            <TabPanel key={name} className="h-auto">
                                {content === 'about-tab' ? (
                                    <AboutTab />
                                ) : content === 'pac-scripts-tab' ? (
                                    <PacScriptsTab />
                                ) : content === 'exceptions-tab' ? (
                                    <ExceptionsTab />
                                ) : content === 'proxies-tab' ? (
                                    <ProxiesTab />
                                ) : null}
                            </TabPanel>
                        ))}
                    </TabPanels>
                </TabGroup>
            </div>
        </div>
    );
};

export default PopupApp;
