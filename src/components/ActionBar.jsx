import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ACTION_TYPES = [
    'external',
    'instance:start',
    'instance:stop',
    'server:start',
    'server:stop'
];

function ActionBar() {
    const { t } = useTranslation();
    const [actions, setActions] = useState([]);
    const [instances, setInstances] = useState([]);
    const [servers, setServers] = useState([]);
    const [isCustomizing, setIsCustomizing] = useState(false);

    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState('external');
    const [newPath, setNewPath] = useState('');
    const [newTarget, setNewTarget] = useState('');
    const [newIcon, setNewIcon] = useState('');

    useEffect(() => {
        loadInitialData();

        const removeSettingsListener = window.electronAPI?.onSettingsUpdated?.((newSettings) => {
            const nextActions = Array.isArray(newSettings?.actionBarActions) ? newSettings.actionBarActions : [];
            setActions(nextActions);
        });

        return () => {
            if (removeSettingsListener) removeSettingsListener();
        };
    }, []);

    const loadInitialData = async () => {
        try {
            const [settingsRes, instancesRes, serversRes] = await Promise.all([
                window.electronAPI.getSettings(),
                window.electronAPI.getInstances(),
                window.electronAPI.getServers()
            ]);

            if (settingsRes?.success) {
                const loadedActions = Array.isArray(settingsRes.settings?.actionBarActions)
                    ? settingsRes.settings.actionBarActions
                    : [];
                setActions(loadedActions);
            }

            setInstances(Array.isArray(instancesRes) ? instancesRes : []);

            if (serversRes?.success && Array.isArray(serversRes.servers)) {
                setServers(serversRes.servers);
            } else {
                setServers([]);
            }
        } catch (error) {
            console.error('[ActionBar] Failed to load initial data:', error);
        }
    };

    const persistActions = async (nextActions) => {
        setActions(nextActions);
        try {
            const settingsRes = await window.electronAPI.getSettings();
            if (!settingsRes?.success) return;
            await window.electronAPI.saveSettings({
                ...settingsRes.settings,
                actionBarActions: nextActions
            });
        } catch (error) {
            console.error('[ActionBar] Failed to save actions:', error);
        }
    };

    const targetOptions = useMemo(() => {
        if (newType.startsWith('instance:')) return instances.map(item => item.name);
        if (newType.startsWith('server:')) return servers.map(item => item.name);
        return [];
    }, [newType, instances, servers]);

    useEffect(() => {
        if ((newType.startsWith('instance:') || newType.startsWith('server:')) && targetOptions.length > 0 && !targetOptions.includes(newTarget)) {
            setNewTarget(targetOptions[0]);
        }
        if (newType === 'external') {
            setNewTarget('');
        }
    }, [newType, targetOptions, newTarget]);

    const getActionSummary = (action) => {
        switch (action.type) {
            case 'external':
                return `${t('action_bar.type_external')} · ${action.path || '-'}`;
            case 'instance:start':
                return `${t('action_bar.type_instance_start')} · ${action.target || '-'}`;
            case 'instance:stop':
                return `${t('action_bar.type_instance_stop')} · ${action.target || '-'}`;
            case 'server:start':
                return `${t('action_bar.type_server_start')} · ${action.target || '-'}`;
            case 'server:stop':
                return `${t('action_bar.type_server_stop')} · ${action.target || '-'}`;
            default:
                return action.type || '';
        }
    };

    const handlePickExternal = async () => {
        const result = await window.electronAPI.openFileDialog({
            properties: ['openFile'],
            filters: [
                { name: t('action_bar.programs'), extensions: ['exe', 'bat', 'cmd', 'com', 'ps1'] },
                { name: t('action_bar.all_files'), extensions: ['*'] }
            ]
        });
        if (!result?.canceled && result?.filePaths?.length > 0) {
            setNewPath(result.filePaths[0]);
        }
    };

    const handleIconUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                setNewIcon(reader.result);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleAddAction = async () => {
        const trimmedName = newName.trim();
        if (!trimmedName) return;
        if (newType === 'external' && !newPath.trim()) return;
        if (newType !== 'external' && !newTarget) return;

        const nextAction = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: trimmedName,
            type: newType,
            icon: newIcon || '',
            path: newType === 'external' ? newPath.trim() : '',
            target: newType !== 'external' ? newTarget : ''
        };

        await persistActions([...actions, nextAction]);

        setNewName('');
        setNewPath('');
        setNewIcon('');
    };

    const handleDelete = async (id) => {
        const nextActions = actions.filter(action => action.id !== id);
        await persistActions(nextActions);
    };

    const executeAction = async (action) => {
        try {
            if (action.type === 'external') {
                await window.electronAPI.runExternalFile(action.path);
                return;
            }
            if (action.type === 'instance:start') {
                await window.electronAPI.launchGame(action.target, false);
                return;
            }
            if (action.type === 'instance:stop') {
                await window.electronAPI.killGame(action.target);
                return;
            }
            if (action.type === 'server:start') {
                await window.electronAPI.startServer(action.target);
                return;
            }
            if (action.type === 'server:stop') {
                await window.electronAPI.stopServer(action.target);
            }
        } catch (error) {
            console.error('[ActionBar] Failed to execute action:', error);
        }
    };

    return (
        <div className="mt-2 bg-surface/40 border border-white/5 rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('action_bar.title')}</span>
                <button
                    onClick={() => setIsCustomizing(prev => !prev)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${isCustomizing ? 'bg-primary text-black' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                >
                    {isCustomizing ? t('action_bar.exit_customize') : t('action_bar.customize')}
                </button>
            </div>

            <div className="flex flex-col gap-2 max-h-[330px] overflow-y-auto custom-scrollbar pr-1">
                {actions.length === 0 && (
                    <div className="text-xs text-gray-500 italic p-2">{t('action_bar.empty')}</div>
                )}

                {actions.map((action) => (
                    <div key={action.id} className="bg-white/5 border border-white/5 rounded-xl p-2.5 flex flex-col gap-1.5">
                        <button
                            onClick={() => {
                                if (!isCustomizing) {
                                    executeAction(action);
                                }
                            }}
                            className="w-full flex items-center gap-2.5 text-left hover:bg-white/5 rounded-lg p-1.5 transition-colors"
                        >
                            <div className="w-9 h-9 rounded-lg bg-black/30 border border-white/10 overflow-hidden shrink-0">
                                {action.icon ? (
                                    <img src={action.icon} alt={action.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">+</div>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{action.name}</div>
                                {isCustomizing && (
                                    <div className="text-[10px] text-gray-400 truncate">{getActionSummary(action)}</div>
                                )}
                            </div>
                        </button>

                        {isCustomizing && (
                            <div className="flex justify-end">
                                <button
                                    onClick={() => handleDelete(action.id)}
                                    className="text-[10px] px-2 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors flex items-center gap-1"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    {t('action_bar.remove', t('common.delete'))}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {isCustomizing && (
                <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('action_bar.add_action')}</label>

                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('action_bar.name_placeholder')}
                        className="w-full bg-background-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-primary"
                    />

                    <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="w-full bg-background-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-primary"
                    >
                        {ACTION_TYPES.map((typeKey) => (
                            <option key={typeKey} value={typeKey}>
                                {t(`action_bar.type_${typeKey.replace(':', '_')}`)}
                            </option>
                        ))}
                    </select>

                    {newType === 'external' ? (
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newPath}
                                onChange={(e) => setNewPath(e.target.value)}
                                placeholder={t('action_bar.path_placeholder')}
                                className="flex-1 bg-background-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-primary"
                            />
                            <button
                                onClick={handlePickExternal}
                                className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/5 text-gray-200 hover:bg-white/10 transition-colors"
                            >
                                {t('action_bar.browse')}
                            </button>
                        </div>
                    ) : (
                        <select
                            value={newTarget}
                            onChange={(e) => setNewTarget(e.target.value)}
                            className="w-full bg-background-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-primary"
                        >
                            {targetOptions.length === 0 ? (
                                <option value="">{t('action_bar.no_targets')}</option>
                            ) : (
                                targetOptions.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))
                            )}
                        </select>
                    )}

                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-300">{t('action_bar.image')}</label>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleIconUpload}
                            className="text-[10px] text-gray-400 file:mr-2 file:px-2 file:py-1 file:rounded-md file:border-0 file:bg-white/10 file:text-gray-200"
                        />
                    </div>

                    <button
                        onClick={handleAddAction}
                        className="w-full bg-primary text-black text-xs font-bold py-2 rounded-lg hover:bg-primary-hover transition-colors"
                    >
                        {t('action_bar.add')}
                    </button>
                </div>
            )}
        </div>
    );
}

export default ActionBar;
