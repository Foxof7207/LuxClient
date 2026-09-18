// Buchfuehrung ueber laufende Cloud-Transfers, damit sie sich abbrechen lassen.
//
// Ohne das lief ein Sync bis zum bitteren Ende durch: der Nutzer konnte nur zusehen, und
// wenn unterwegs etwas schiefging, blieb die Anzeige auf "wird synchronisiert" stehen,
// weil niemand einen Schlusspunkt gesetzt hat.

const api = require('./api');

const active = new Map();

class CancelledError extends Error {
    constructor(instanceName) {
        super(`The transfer for ${instanceName} was cancelled`);
        this.name = 'CancelledError';
        this.code = 'cancelled';
    }
}

function begin(instanceName, kind) {
    // Ein frueherer Abbruch darf den neuen Transfer nicht sofort wieder als abgebrochen
    // erscheinen lassen.
    api.resetAbortReason();

    const entry = { instanceName, kind, cancelled: false, startedAt: Date.now() };
    active.set(instanceName, entry);
    return entry;
}

function end(instanceName) {
    return active.delete(instanceName);
}

function cancel(instanceName) {
    const entry = active.get(instanceName);
    if (!entry) return false;

    entry.cancelled = true;

    // Laufende HTTP-Anfragen wirklich abschneiden, statt auf das Ende der aktuellen Datei
    // zu warten. abortAll trifft alle Anfragen, deshalb nur, wenn dieser Transfer der
    // einzige ist - sonst wuerde der Abbruch einer Instanz eine andere mitreissen.
    if (active.size === 1) {
        api.abortAll('cancelled');
    }
    return true;
}

function cancelAll() {
    let count = 0;
    for (const entry of active.values()) {
        entry.cancelled = true;
        count += 1;
    }
    if (count > 0) api.abortAll('cancelled');
    return count;
}

function isCancelled(instanceName) {
    const entry = active.get(instanceName);
    return Boolean(entry && entry.cancelled);
}

// Wirft, wenn der Transfer abgebrochen wurde. Gedacht fuer die Stellen zwischen zwei
// Dateien, an denen ein Abbruch nichts Halbfertiges hinterlaesst.
function throwIfCancelled(instanceName) {
    if (isCancelled(instanceName)) throw new CancelledError(instanceName);
}

function list() {
    return [...active.values()].map((entry) => ({
        instanceName: entry.instanceName,
        kind: entry.kind,
        startedAt: entry.startedAt,
        cancelled: entry.cancelled
    }));
}

function reset() {
    active.clear();
}

module.exports = {
    CancelledError,
    begin,
    cancel,
    cancelAll,
    end,
    isCancelled,
    list,
    reset,
    throwIfCancelled
};
