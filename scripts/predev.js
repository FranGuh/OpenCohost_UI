import { execSync } from 'node:child_process';

try {
  if (process.platform === 'win32') {
    execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 1420,8765,8770 -State Listen -ErrorAction SilentlyContinue | Select -Expand OwningProcess -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; exit 0"',
      { stdio: 'ignore' }
    );
  } else {
    // Linux / macOS: kill ports 1420, 8765, 8770 if already in use
    execSync('fuser -k 1420/tcp 8765/tcp 8770/tcp 2>/dev/null || (lsof -ti:1420,8765,8770 | xargs kill -9 2>/dev/null) || true', {
      stdio: 'ignore',
    });
  }
} catch {
  // Fail-open: ignore errors
}
