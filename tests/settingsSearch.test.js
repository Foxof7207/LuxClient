// Prueft die Suche ueber die Einstellungen ohne Browser.
//
// applySettingsSearch braucht vom DOM nur wenige Faehigkeiten, die hier nachgebaut
// werden. Damit laesst sich pruefen, was im echten Fenster schwer zu greifen ist:
// findet die Suche eine einzelne Option tief in einer Kategorie, die im Namen der
// Kategorie gar nicht vorkommt?

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

// --- Minimaler DOM-Nachbau -------------------------------------------------
class Node {
    constructor(attrs = {}, text = '', children = []) {
        this.attrs = attrs;
        this.ownText = text;
        this.children = children;
        this.hidden = false;
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }

    get textContent() {
        if (this.children.length === 0) return this.ownText;
        return this.ownText + this.children.map((c) => c.textContent).join(' ');
    }

    matches(selector) {
        // Erlaubt sowohl [attr] als auch [attr="wert"].
        const m = /^\[([a-z-]+)(?:="?([^"\]]*)"?)?\]$/.exec(selector);
        if (!m) return false;
        const [, name, value] = m;
        const actual = this.getAttribute(name);
        return value ? actual === value : actual !== null;
    }

    descendants() {
        const out = [];
        for (const child of this.children) {
            out.push(child, ...child.descendants());
        }
        return out;
    }

    querySelectorAll(selector) {
        return this.descendants().filter((n) => n.matches(selector));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

const row = (text) => new Node({}, text);
const separator = () => new Node({}, '');
const card = (title, rows) => new Node({ 'data-slot': 'card' }, '', [
    new Node({ 'data-slot': 'card-header' }, title),
    new Node({ 'data-slot': 'card-content' }, '', rows)
]);
const panel = (id, cards) => new Node({ 'data-settings-section': id }, '', cards);

function buildTree() {
    return new Node({}, '', [
        panel('experience', [
            card('General', [
                row('Startup page  Which page opens first'),
                separator(),
                row('Language  Interface language')
            ]),
            card('Library', [
                row('Show Modrinth instances in the library  Imported external Modrinth instances'),
                row('Show CurseForge instances in the library')
            ])
        ]),
        panel('automation', [
            card('Auto install mods', [
                row('Add mods by entering their Modrinth ID or searching by name'),
                row('Check for updates on launch')
            ])
        ]),
        panel('advanced', [
            card('Maintenance', [
                row('Reset all settings'),
                row('Open log folder')
            ])
        ])
    ]);
}

function main() {
    // Die Quelle liegt als TypeScript vor; fuer diesen Test reicht es, die Typannotationen
    // grob zu entfernen - die Logik selbst ist reines JavaScript.
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'settingsSearch.ts'), 'utf8');
    const stripped = source
        .replace(/export type [\s\S]*?;\n/g, '')
        .replace(/type Searchable = \{[\s\S]*?\n\};\n/g, '')
        .replace(/: SettingsMatchCounts/g, '')
        .replace(/: Searchable \| null/g, '')
        .replace(/: string/g, '')
        .replace(/export default applySettingsSearch;/, '')
        .replace(/export function/, 'function');
    const applySettingsSearch = new Function(`${stripped}; return applySettingsSearch;`)();

    section('1) Leere Suche zeigt alles');
    let tree = buildTree();
    let counts = applySettingsSearch(tree, '');
    check('nichts ist ausgeblendet',
        tree.descendants().every((n) => n.hidden === false), null);
    check('keine Treffer gezaehlt',
        Object.values(counts).every((v) => v === 0), counts);

    section('2) Suche nach "modrinth" findet Optionen, nicht nur Kategorien');
    tree = buildTree();
    counts = applySettingsSearch(tree, 'modrinth');

    check('die Bibliotheks-Kategorie hat Treffer', counts.experience > 0, counts);
    check('die Automatisierung hat Treffer', counts.automation > 0, counts);
    check('die Wartung hat keine Treffer', counts.advanced === 0, counts);

    const libraryCard = tree.querySelectorAll('[data-slot="card"]')
        .find((c) => c.querySelector('[data-slot="card-header"]').textContent === 'Library');
    const libraryRows = libraryCard.querySelector('[data-slot="card-content"]').children;
    check('die Modrinth-Zeile bleibt sichtbar', libraryRows[0].hidden === false, null);
    check('die CurseForge-Zeile ist ausgeblendet', libraryRows[1].hidden === true, null);

    const generalCard = tree.querySelectorAll('[data-slot="card"]')
        .find((c) => c.querySelector('[data-slot="card-header"]').textContent === 'General');
    check('eine Karte ohne Treffer verschwindet ganz', generalCard.hidden === true, null);

    const maintenanceCard = tree.querySelectorAll('[data-slot="card"]')
        .find((c) => c.querySelector('[data-slot="card-header"]').textContent === 'Maintenance');
    check('auch in einer fremden Kategorie', maintenanceCard.hidden === true, null);

    section('3) Trennlinien schweben nicht allein herum');
    tree = buildTree();
    applySettingsSearch(tree, 'language');
    const genRows = tree.querySelectorAll('[data-slot="card"]')
        .find((c) => c.querySelector('[data-slot="card-header"]').textContent === 'General')
        .querySelector('[data-slot="card-content"]').children;
    check('die Sprachzeile bleibt', genRows[2].hidden === false, null);
    check('die Trennlinie davor ist weg', genRows[1].hidden === true, null);
    check('die Startseiten-Zeile ist weg', genRows[0].hidden === true, genRows[0].hidden);

    section('4) Treffer in der Kartenueberschrift behaelt den Zusammenhang');
    tree = buildTree();
    counts = applySettingsSearch(tree, 'maintenance');
    const maint = tree.querySelectorAll('[data-slot="card"]')
        .find((c) => c.querySelector('[data-slot="card-header"]').textContent === 'Maintenance');
    const maintRows = maint.querySelector('[data-slot="card-content"]').children;
    check('die Karte bleibt sichtbar', maint.hidden === false, null);
    check('und alle ihre Zeilen auch',
        maintRows.every((r) => r.hidden === false), maintRows.map((r) => r.hidden));

    section('5) Suche ohne Treffer');
    tree = buildTree();
    counts = applySettingsSearch(tree, 'zzz-gibt-es-nicht');
    check('keine Kategorie meldet Treffer',
        Object.values(counts).every((v) => v === 0), counts);
    check('alle Karten sind ausgeblendet',
        tree.querySelectorAll('[data-slot="card"]').every((c) => c.hidden === true), null);

    section('6) Zuruecksetzen macht alles wieder sichtbar');
    applySettingsSearch(tree, '');
    check('alle Karten sind wieder da',
        tree.querySelectorAll('[data-slot="card"]').every((c) => c.hidden === false), null);

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
