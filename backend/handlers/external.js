const { shell } = require('electron');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = (ipcMain) => {

    ipcMain.handle('open-external', async (_event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('external:run-file', async (_event, filePath) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                return { success: false, error: 'Invalid path' };
            }

            const normalizedPath = filePath.trim();
            if (!normalizedPath) {
                return { success: false, error: 'Path is empty' };
            }

            const exists = await fs.pathExists(normalizedPath);
            if (!exists) {
                return { success: false, error: 'File does not exist' };
            }

            const child = spawn(normalizedPath, [], {
                detached: true,
                shell: true,
                windowsHide: false,
                stdio: 'ignore'
            });
            child.unref();

            return { success: true };
        } catch (error) {
            console.error('Error running external file:', error);
            return { success: false, error: error.message };
        }
    });
};