const http = require('http');
const { spawn } = require('child_process');

function waitForDevServer(url, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkServer = () => {
            http.get(url, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    retry();
                }
            }).on('error', retry);
        };

        const retry = () => {
            if (Date.now() - startTime > timeout) {
                reject(new Error('Dev server timeout'));
                return;
            }
            setTimeout(checkServer, 100);
        };

        checkServer();
    });
}

// Start Vite dev server
const viteProcess = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: true
});

// Wait for server to be ready
waitForDevServer('http://localhost:5173')
    .then(() => {
        // Start Electron
        spawn('electron', ['.'], {
            stdio: 'inherit',
            shell: true
        });
    })
    .catch((err) => {
        console.error('Failed to start dev server:', err);
        process.exit(1);
    });

// Handle process termination
process.on('SIGTERM', () => {
    viteProcess.kill();
    process.exit();
});

process.on('SIGINT', () => {
    viteProcess.kill();
    process.exit();
}); 