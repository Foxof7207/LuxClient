interface CrashPattern {
    id: string;
    regex: RegExp;
    title: string;
    description: string | ((match: RegExpMatchArray) => string);
    fixText: string;
    fixAction: string;
    priority: number;
    fixUrl?: string;
    // Values the description/fixText placeholders need, pulled out of the match.
    values?: (match: RegExpMatchArray) => Record<string, any>;
    // Placeholder names the main description cannot do without. Several regexes
    // have alternatives that capture nothing, and rendering the raw "{{mod}}" at
    // the user is worse than a slightly vaguer sentence.
    requires?: string[];
    descriptionFallback?: string;
}

const CRASH_PATTERNS: CrashPattern[] = [
    {
        id: 'out_of_memory',
        regex: /java\.lang\.OutOfMemoryError/i,
        title: 'crash.patterns.out_of_memory.title',
        description: 'crash.patterns.out_of_memory.description',
        fixText: 'crash.patterns.out_of_memory.fix_text',
        fixAction: 'increase_memory',
        priority: 10
    },
    {
        id: 'unsupported_java_version',
        regex: /java\.lang\.UnsupportedClassVersionError|has\s+been\s+compiled\s+by\s+a\s+more\s+recent\s+version\s+of\s+the\s+Java\s+Runtime/i,
        title: 'crash.patterns.unsupported_java_version.title',
        description: 'crash.patterns.unsupported_java_version.description',
        fixText: 'crash.patterns.unsupported_java_version.fix_text',
        fixAction: 'fix_java_version',
        priority: 10
    },
    {
        id: 'java_requirement_mismatch',
        regex: /Java\s+([0-9]+)\s+or\s+higher\s+is\s+required/i,
        title: 'crash.patterns.java_requirement_mismatch.title',
        description: 'crash.patterns.java_requirement_mismatch.description',
        fixText: 'crash.patterns.java_requirement_mismatch.fix_text',
        fixAction: 'fix_java_version',
        priority: 10,
        values: (match) => ({ version: match[1] }),
        requires: ['version'],
        descriptionFallback: 'crash.patterns.java_requirement_mismatch.description_unknown'
    },
    {
        id: 'pixel_format_not_accelerated',
        regex: /org\.lwjgl\.LWJGLException:\s+Pixel\s+format\s+not\s+accelerated|GLFW\s+error\s+65542:\s+WGL:\s+The\s+driver\s+does\s+not\s+appear\s+to\s+support\s+OpenGL/i,
        title: 'crash.patterns.pixel_format_not_accelerated.title',
        description: 'crash.patterns.pixel_format_not_accelerated.description',
        fixText: 'crash.patterns.pixel_format_not_accelerated.fix_text',
        fixAction: 'open_url',
        fixUrl: 'https://www.intel.com/content/www/us/en/support/detect.html',
        priority: 15
    },
    {
        id: 'opengl_version_too_low',
        regex: /OpenGL\s+([0-9.]+)\s+or\s+higher\s+is\s+required/i,
        title: 'crash.patterns.opengl_version_too_low.title',
        description: 'crash.patterns.opengl_version_too_low.description',
        fixText: 'crash.patterns.opengl_version_too_low.fix_text',
        fixAction: 'open_url',
        fixUrl: 'https://help.minecraft.net/hc/en-us/articles/4409137344397-Minecraft-Java-Edition-System-Requirements',
        priority: 14,
        values: (match) => ({ version: match[1] }),
        requires: ['version'],
        descriptionFallback: 'crash.patterns.opengl_version_too_low.description_unknown'
    },
    {
        id: 'duplicate_mods',
        regex: /Duplicate\s+mod\s+id\s+'([^']+)'\s+found/i,
        title: 'crash.patterns.duplicate_mods.title',
        description: 'crash.patterns.duplicate_mods.description',
        fixText: 'crash.patterns.duplicate_mods.fix_text',
        fixAction: 'open_mods_folder',
        priority: 12,
        values: (match) => ({ mod: match[1] }),
        requires: ['mod'],
        descriptionFallback: 'crash.patterns.duplicate_mods.description_unknown'
    },
    {
        id: 'config_corruption',
        regex: /com\.google\.gson\.JsonSyntaxException|failed\s+to\s+parse\s+config\s+file/i,
        title: 'crash.patterns.config_corruption.title',
        description: 'crash.patterns.config_corruption.description',
        fixText: 'crash.patterns.config_corruption.fix_text',
        fixAction: 'reset_config',
        priority: 9
    },
    {
        id: 'mixin_transformer_error',
        regex: /org\.spongepowered\.asm\.mixin\.transformer\.throwables\.MixinTransformerError|Mixin\s+apply\s+failed\s+for\s+mod\s+([A-Za-z0-9_.\-]+)/i,
        title: 'crash.patterns.mixin_transformer_error.title',
        description: 'crash.patterns.mixin_transformer_error.description',
        fixText: 'crash.patterns.mixin_transformer_error.fix_text',
        fixAction: 'disable_mod',
        priority: 11,
        // The first alternative ("MixinTransformerError") captures nothing, so the
        // mod name is only known when the second one matched.
        values: (match) => ({ mod: match[1] }),
        requires: ['mod'],
        descriptionFallback: 'crash.patterns.mixin_transformer_error.description_unknown'
    },
    {
        id: 'incompatible_mod_set',
        regex: /incompatible\s+mods?\s+found|mod\s+resolution\s+encountered\s+an\s+incompatible\s+mod\s+set/i,
        title: 'crash.incompatible_mods_found',
        description: 'crash.mod_issues_detected',
        fixText: 'crash.labels.install_compatible',
        fixAction: 'install_compatible_mod',
        priority: 5
    },
    {
        id: 'outdated_loader',
        regex: /Outdated\s+(Fabric|Forge|NeoForge)\s+loader|Loader\s+version\s+([0-9.]+)\s+is\s+too\s+old/i,
        title: 'crash.patterns.outdated_loader.title',
        description: 'crash.patterns.outdated_loader.description',
        fixText: 'crash.patterns.outdated_loader.fix_text',
        fixAction: 'update_loader',
        priority: 12
    }
];

const COMPATIBILITY_LINE_PATTERNS = [
    // --- Fabric Patterns ---
    {
        type: 'missing_dependency_simple_versioned',
        // Example: - Install cloth-config, version 16.0.0 or later.
        regex: /Install\s+['"]?([A-Za-z0-9_.\-]+)['"]?,\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later/ig,
        mapMatch: (match) => ({
            modName: null,
            dependencyName: match[1].trim(),
            issueType: 'missing_dependency',
            requiredVersion: match[2].trim(),
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'missing_dependency_simple_any',
        // Example: - Install cloth-config, any version.
        regex: /Install\s+['"]?([A-Za-z0-9_.\-]+)['"]?,\s+any\s+version/ig,
        mapMatch: (match) => ({
            modName: null,
            dependencyName: match[1].trim(),
            issueType: 'missing_dependency',
            requiredVersion: null,
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'missing_dependency_detailed_versioned',
        // Example: Mod 'More Culling' (moreculling) 1.6.2 requires version 16.0.0 or later of cloth-config, which is missing!
        regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+['"]?([A-Za-z0-9_.\-]+)['"]?/ig,
        mapMatch: (match) => ({
            modName: match[1] || match[2],
            dependencyName: match[4].trim(),
            issueType: 'missing_dependency',
            requiredVersion: match[3].trim(),
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'missing_dependency_detailed_any',
        // Example: Mod 'FastQuit' (fastquit) 3.1.3+mc1.21.11 requires any version of cloth-config, which is missing!
        regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+any\s+version\s+of\s+['"]?([A-Za-z0-9_.\-]+)['"]?/ig,
        mapMatch: (match) => ({
            modName: match[1] || match[2],
            dependencyName: match[3].trim(),
            issueType: 'missing_dependency',
            requiredVersion: null,
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'outdated_dependency_fabric',
        // Example: Mod 'Mod A' (moda) 1.0.0 requires version 1.1.0 or later of mod 'Mod B' (modb), but only the wrong version is present: 1.0.0!
        regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([^\s]+)\s+(?:or\s+later\s+)?of\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\),\s+but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!\r\n]+)/ig,
        mapMatch: (match) => ({
            modName: match[1] || match[2],
            dependencyName: match[5] || match[6],
            issueType: 'outdated_dependency',
            requiredVersion: match[4] || null,
            foundVersion: match[7] || null,
            sourceLine: match[0]
        })
    },
    {
        type: 'replace_mod_fabric',
        // Example: - Replace mod 'Sodium' (sodium) 0.8.7+mc1.21.11 with version 0.8.4+mc1.21.11.
        regex: /Replace\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+with\s+version\s+([0-9A-Za-z.+\-]+)/ig,
        mapMatch: (match) => ({
            modName: 'System',
            dependencyName: match[2].trim(),
            issueType: 'outdated_dependency',
            requiredVersion: match[4].trim(),
            foundVersion: match[3].trim(),
            sourceLine: match[0]
        })
    },
    // --- Forge Patterns ---
    {
        type: 'forge_missing_dep',
        // Example: Mod modid requires dependency any version
        regex: /Mod\s+([A-Za-z0-9_.\-]+)\s+requires\s+([A-Za-z0-9_.\-]+)\s+([><=~^*0-9A-Za-z.+\-]+|any(?:\s+version)?)/ig,
        mapMatch: (match) => {
            const dep = match[2];
            const ver = match[3];
            // Filter out common false matches
            if (dep.toLowerCase() === 'version' || ver.toLowerCase() === 'version') return null;
            if (['minecraft', 'fabricloader', 'forge'].includes(dep.toLowerCase())) return null;

            return {
                modName: match[1],
                dependencyName: dep,
                issueType: ver.toLowerCase().includes('any') ? 'missing_dependency' : 'outdated_dependency',
                requiredVersion: ver,
                foundVersion: null,
                sourceLine: match[0]
            };
        }
    },
    {
        type: 'missing_required_mod_generic',
        regex: /Could\s+not\s+find\s+required\s+mod:\s*([A-Za-z0-9_.\-]+)/ig,
        mapMatch: (match) => ({
            modName: null,
            dependencyName: match[1],
            issueType: 'missing_dependency',
            requiredVersion: null,
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    // --- Loader Patterns ---
    {
        type: 'loader_outdated',
        // Example: fabric-loader 0.16.0 or later is required but 0.15.11 is present
        regex: /(fabric-loader|forge|neoforge|quilt\-loader)\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+is\s+required\s+but\s+([0-9A-Za-z.+\-]+)\s+is\s+present/ig,
        mapMatch: (match) => ({
            modName: 'System',
            dependencyName: match[1],
            issueType: 'loader_outdated',
            requiredVersion: match[2],
            foundVersion: match[3],
            sourceLine: match[0]
        })
    },
    {
        type: 'loader_requirement_detailed',
        // Example: Mod 'Sodium' (sodium) 0.6.0 requires version 0.16.0 or later of fabric-loader, which is missing!
        regex: /Mod\s+'([^']+)'\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+(fabric-loader|forge|neoforge|quilt\-loader)/ig,
        mapMatch: (match) => ({
            modName: match[1] || match[2],
            dependencyName: match[5],
            issueType: 'loader_outdated',
            requiredVersion: match[4],
            foundVersion: null,
            sourceLine: match[0]
        })
    }
];

const cleanToken = (value) => {
    if (typeof value !== 'string') return '';
    return value
        .replace(/^['"\s]+|['"\s]+$/g, '')
        .replace(/[\]\[()]/g, '')
        .trim();
};

const stripColors = (text) => {
    if (typeof text !== 'string') return '';
    // Strip ANSI codes and Minecraft section symbols (§ + color code)
    return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '');
};

const normalizeToken = (value) => cleanToken(value).toLowerCase();

// Picks the phrasing that fits the values we actually have. Every returned key must
// only reference placeholders that are non-empty here, otherwise i18next renders the
// literal "{{modName}}" into the crash report.
const buildCompatibilityDescription = (values) => {
    const modName = values.modName;
    const dependencyName = values.dependencyName;
    const requiredVersion = values.requiredVersion;
    const foundVersion = values.foundVersion;

    if (!dependencyName) return 'crash.compatibility.generic_conflict';

    if (requiredVersion && foundVersion) {
        return modName
            ? 'crash.compatibility.needs_version_installed'
            : 'crash.compatibility.needs_version_installed_no_mod';
    }

    if (requiredVersion) {
        return modName
            ? 'crash.compatibility.needs_version'
            : 'crash.compatibility.needs_version_no_mod';
    }

    return modName
        ? 'crash.compatibility.missing_dependency'
        : 'crash.compatibility.missing_dependency_no_mod';
};

const toCompatibilityIssue = (group, index) => {
    const { targetMod, entries } = group;
    const isOutdated = entries.some(e => e.issueType === 'outdated_dependency' || e.issueType === 'loader_outdated');
    const isLoader = entries.some(e => ['fabric-loader', 'forge', 'neoforge', 'quilt-loader'].includes(normalizeToken(e.dependencyName)));

    const requiredVersion = entries.find(e => e.requiredVersion)?.requiredVersion;
    const foundVersion = entries.find(e => e.foundVersion)?.foundVersion;

    // Collate affected mods
    const affectedMods = Array.from(new Set(entries.map(e => e.modName).filter(n => n && n !== 'System')));

    // These are the placeholder values the description and the fix button need. They
    // used to be missing entirely, which left "{{modName}}" and "{{targetMod}}" in the
    // rendered text.
    const values = {
        modName: cleanToken(entries[0].modName),
        dependencyName: cleanToken(entries[0].dependencyName),
        requiredVersion: cleanToken(requiredVersion),
        foundVersion: cleanToken(foundVersion),
        targetMod: cleanToken(targetMod),
        affectedMods: affectedMods.join(', ')
    };

    return {
        id: `compat_${normalizeToken(targetMod) || index}`,
        title: isLoader ? 'crash.patterns.outdated_loader.title' : (isOutdated ? 'crash.compatibility.outdated_dependency_title' : 'crash.compatibility.missing_dependency_title'),
        description: buildCompatibilityDescription(values),
        // Rendered as a separate line so the description stays a plain, translatable key.
        // Appending English prose to the key itself produced a lookup miss, and i18next
        // then printed the raw key at the user.
        requiredBy: affectedMods.length > 0 ? 'crash.compatibility.required_by' : null,
        fixText: isLoader ? 'crash.patterns.outdated_loader.fix_text' : 'crash.compatibility.install_fix_text',
        fixAction: isLoader ? 'update_loader' : 'install_compatible_mod',
        priority: isLoader ? 20 : (isOutdated ? 17 : 18),
        values,
        compatibility: {
            issueType: isOutdated ? 'outdated_dependency' : 'missing_dependency',
            targetMod: cleanToken(targetMod),
            requiredVersion: requiredVersion || null,
            foundVersion: foundVersion || null,
            affectedMods,
            details: entries.map(e => e.sourceLine)
        }
    };
};

const groupCompatibilityIssues = (entries) => {
    const groups = new Map();

    for (const entry of entries) {
        const targetMod = normalizeToken(entry.dependencyName || entry.modName);
        if (!targetMod) continue;

        if (!groups.has(targetMod)) {
            groups.set(targetMod, {
                targetMod: entry.dependencyName || entry.modName,
                entries: []
            });
        }
        groups.get(targetMod).entries.push(entry);
    }

    return Array.from(groups.values());
};

const extractCompatibilityIssuesFromLog = (logContent) => {
    if (!logContent || typeof logContent !== 'string') return [];
    
    const cleanLog = stripColors(logContent);
    const found = [];

    for (const rule of COMPATIBILITY_LINE_PATTERNS) {
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(cleanLog)) !== null) {
            const candidate = rule.mapMatch(match);
            if (!candidate) continue;
            found.push(candidate);
        }
    }

    const deduped = [];
    const seen = new Set();

    for (const entry of found) {
        const key = [
            normalizeToken(entry.issueType),
            normalizeToken(entry.modName),
            normalizeToken(entry.dependencyName),
            normalizeToken(entry.requiredVersion),
            normalizeToken(entry.foundVersion)
        ].join('|');

        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }

    return deduped;
};

const mergeCompatibilityIssues = (existingIssues, compatibilityEntries) => {
    const groups = groupCompatibilityIssues(compatibilityEntries);
    const compatibilityIssues = groups.map((group, index) => toCompatibilityIssue(group, index));
    
    const alreadyCovered = new Set(
        existingIssues
            .filter((issue) => issue.fixAction === 'install_compatible_mod' || issue.fixAction === 'update_loader')
            .map((issue) => normalizeToken(issue?.compatibility?.targetMod || ''))
    );

    const nextCompatibility = compatibilityIssues.filter((issue) => {
        const key = normalizeToken(issue?.compatibility?.targetMod || '');
        if (!key) return true;
        if (alreadyCovered.has(key)) return false;
        alreadyCovered.add(key);
        return true;
    });

    return [...existingIssues, ...nextCompatibility];
};

/**
 * Analyzes the provided log content for known crash patterns.
 * @param {string} logContent - The log content or crash report text.
 * @returns {Array} - A list of identified issues.
 */
export function analyzeLog(logContent: string | null | undefined, options: any = {}) {
    const rawLog = typeof logContent === 'string' ? logContent : '';
    const safeLog = stripColors(rawLog);
    const externalCompatibilityIssues = Array.isArray(options.compatibilityIssues)
        ? options.compatibilityIssues
        : [];

    if (!safeLog && externalCompatibilityIssues.length === 0) return [];

    const issues = [];

    for (const pattern of CRASH_PATTERNS) {
        const match = safeLog.match(pattern.regex);
        if (match) {
            const rawValues = typeof pattern.values === 'function' ? pattern.values(match) : {};
            const values: Record<string, any> = {};
            for (const [key, value] of Object.entries(rawValues)) {
                const cleaned = cleanToken(value);
                if (cleaned) values[key] = cleaned;
            }

            // A regex alternative that captured nothing must not leave a raw
            // "{{mod}}" in the sentence shown to the user.
            const missing = (pattern.requires || []).some((key) => !values[key]);
            const description = missing && pattern.descriptionFallback
                ? pattern.descriptionFallback
                : (typeof pattern.description === 'function' ? pattern.description(match) : pattern.description);

            const issue = {
                id: pattern.id,
                title: pattern.title,
                description,
                fixText: pattern.fixText,
                fixAction: pattern.fixAction,
                priority: pattern.priority,
                match: match[0],
                capturedGroups: match.slice(1),
                values
            };
            issues.push(issue);
        }
    }

    const inlineCompatibilityIssues = extractCompatibilityIssuesFromLog(safeLog);
    const mergedCompatibility = [...inlineCompatibilityIssues, ...externalCompatibilityIssues];

    const allIssues = mergeCompatibilityIssues(issues, mergedCompatibility);

    // DEDUPLICATION: If we found specific mod dependencies (priority >= 17),
    // suppress the generic "Incompatible Mod Set" (priority 5) to keep only the functional card.
    const specificIssues = allIssues.filter(i => i.priority >= 17);
    const hasSpecific = specificIssues.length > 0;

    const filteredIssues = hasSpecific
        ? allIssues.filter(i => i.id !== 'incompatible_mod_set')
        : allIssues;

    return filteredIssues.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns a user-friendly summary of the exit code.
 * @param {number} code - The process exit code.
 * @returns {string}
 */
export function getExitCodeDescription(code) {
    switch (code) {
        case 0: return 'crash.exit_codes.success';
        case 1: return 'crash.exit_codes.general';
        case -1: return 'crash.exit_codes.killed';
        case 130: return 'crash.exit_codes.interrupted';
        case 137: return 'crash.exit_codes.oom_linux';
        case 139: return 'crash.exit_codes.segfault';
        case 255: return 'crash.exit_codes.vanilla';
        default: return 'crash.exit_codes.unknown';
    }
}
